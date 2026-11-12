import { describe, expect, it } from 'vitest';
import { expectedFlow } from '../server/analytics';
import { demoReadings, SITES } from '../server/demo';
import { planRecovery, type PlanInput, type RecoveryPlan } from '../server/planner';
import type { Reading } from '../server/types';
import { HttpError } from '../server/validation';

const DEFAULT: PlanInput = { budgetInr: 12000, crewHours: 12, tariffInrM3: 65, horizonDays: 30 };
function telemetry(excess: number, hours = 24, apply: (index: number) => boolean = () => true): Reading[] {
  return SITES.flatMap(site => demoReadings().filter(reading => reading.siteId === site.id).slice(-hours).map((reading, index) => ({
    ...reading,
    flowM3h: expectedFlow(reading) + (apply(index) ? excess : 0),
    conductivityUsCm: 1200,
    ph: 7.3,
  })));
}
function assertFeasible(plan: RecoveryPlan) {
  const chosen = plan.candidates.filter(action => plan.selectedIds.includes(action.id));
  expect(new Set(chosen.map(action => action.exclusiveGroup)).size).toBe(chosen.length);
  expect(chosen.reduce((sum, action) => sum + action.costInr, 0)).toBeLessThanOrEqual(plan.parameters.budgetInr);
  expect(chosen.reduce((sum, action) => sum + action.crewHours, 0)).toBeLessThanOrEqual(plan.parameters.crewHours);
}

describe('exact constrained recovery planner', () => {
  it('keeps an empty feasible plan when budget or crew time is zero', () => {
    for (const constraints of [{budgetInr: 0}, {crewHours: 0}]) {
      const result = planRecovery(telemetry(20), {...DEFAULT, ...constraints});
      expect(result.candidates).toHaveLength(6);
      expect(result.selectedIds).toEqual([]);
      expect(result.summary).toMatchObject({costInr: 0, crewHours: 0, dailyWaterM3: 0, netValueInr: 0, paybackDays: null});
      expect(result.algorithm.evaluatedPlans).toBe(64);
      expect(result.algorithm.feasiblePlans).toBe(1);
      expect(result.frontier).toEqual([{costInr: 0, dailyWaterM3: 0, crewHours: 0, selectedIds: []}]);
    }
  });

  it('chooses none when every action loses money over the selected horizon', () => {
    const result = planRecovery(telemetry(20), {...DEFAULT, budgetInr: 100000, tariffInrM3: .01, horizonDays: 1});
    expect(result.selectedIds).toEqual([]);
    expect(result.summary.netValueInr).toBe(0);
    expect(result.frontier.some(point => point.dailyWaterM3 > 0)).toBe(true);
  });

  it('finds a better combination than value-per-cost greedy allocation', () => {
    const result = planRecovery(telemetry(20), {...DEFAULT, budgetInr: 10000, crewHours: 20});
    // A density-greedy planner buys all three inspections for ₹8,200: 504 m³/day.
    // The exact optimum buys Chennai repair + Pune inspection for ₹9,800: 528 m³/day.
    expect(result.selectedIds).toEqual(['CHE-03:repair', 'PUN-02:inspect']);
    expect(result.summary.costInr).toBe(9800);
    expect(result.summary.dailyWaterM3).toBe(528);
    expect(result.summary.netValueInr).toBe(1_019_800);
    const greedyWater = result.candidates.filter(action => action.id.endsWith(':inspect')).reduce((sum, action) => sum + action.dailyWaterM3, 0);
    expect(greedyWater).toBeCloseTo(504, 8);
    expect(result.summary.dailyWaterM3).toBeGreaterThan(greedyWater);
    assertFeasible(result);
  });

  it('enforces crew constraints and never combines alternatives for one site', () => {
    const data = telemetry(20);
    const limited = planRecovery(data, {...DEFAULT, crewHours: 1.49});
    expect(limited.selectedIds).toEqual([]);
    const one = planRecovery(data, {...DEFAULT, crewHours: 2});
    expect(one.selectedIds).toEqual(['CHE-03:inspect']);
    const unconstrained = planRecovery(data, {...DEFAULT, budgetInr: 1_000_000, crewHours: 100});
    expect(unconstrained.selectedIds).toEqual(['BLR-01:repair', 'CHE-03:repair', 'PUN-02:repair']);
    for (const plan of [limited, one, unconstrained]) assertFeasible(plan);
  });

  it('never relaxes hard resource constraints by a floating-point tolerance', () => {
    const readings = telemetry(20);
    expect(planRecovery(readings, {...DEFAULT, budgetInr: 2400 - 1e-9}).selectedIds).toEqual([]);
    expect(planRecovery(readings, {...DEFAULT, crewHours: 1.5 - 1e-9}).selectedIds).toEqual([]);
    expect(planRecovery(readings, {...DEFAULT, budgetInr: 2400, crewHours: 1.5}).selectedIds).toEqual(['CHE-03:inspect']);
  });

  it('provides a cost/water Pareto frontier containing only nondominated feasible plans', () => {
    const result = planRecovery(telemetry(20), {...DEFAULT, budgetInr: 10000, crewHours: 20});
    expect(result.frontier[0].selectedIds).toEqual([]);
    expect(new Set(result.frontier.map(point => `${point.costInr}/${point.dailyWaterM3}`)).size).toBe(result.frontier.length);
    for (const point of result.frontier) {
      expect(point.costInr).toBeLessThanOrEqual(10000);
      expect(point.crewHours).toBeLessThanOrEqual(20);
      expect(result.frontier.some(other => other.costInr <= point.costInr && other.dailyWaterM3 >= point.dailyWaterM3 && (other.costInr < point.costInr || other.dailyWaterM3 > point.dailyWaterM3))).toBe(false);
    }
    expect(result.algorithm.feasiblePlans).toBeGreaterThan(result.frontier.length);
  });

  it('creates no water benefit for healthy telemetry, normal residual noise or chemistry-only faults', () => {
    expect(planRecovery(telemetry(0), DEFAULT).candidates).toEqual([]);
    const chemistry = telemetry(.2).map(reading => ({...reading, conductivityUsCm: 2100, ph: 6.5}));
    expect(planRecovery(chemistry, DEFAULT).candidates).toEqual([]);
    expect(planRecovery(demoReadings(), {...DEFAULT, siteId: 'PUN-02'}).candidates).toEqual([]);
    expect(planRecovery(demoReadings(), {...DEFAULT, siteId: 'CHE-03'}).candidates).toEqual([]);
  });

  it('normalizes over all observed hours instead of inflating a single fault to a full day', () => {
    const oneFault = planRecovery(telemetry(20, 24, index => index === 23), {...DEFAULT, siteId: 'BLR-01'});
    const fullDay = planRecovery(telemetry(20), {...DEFAULT, siteId: 'BLR-01'});
    expect(oneFault.candidates[0].dailyWaterM3).toBeCloseTo(7, 8);
    expect(fullDay.candidates[0].dailyWaterM3 / oneFault.candidates[0].dailyWaterM3).toBeCloseTo(24, 8);
    const short = planRecovery(telemetry(20, 1), {...DEFAULT, siteId: 'BLR-01'});
    expect(short.candidates[0].dailyWaterM3).toBeCloseTo(fullDay.candidates[0].dailyWaterM3, 8);
    expect(short.assumptions.some(text => text.includes('partial window'))).toBe(true);
  });

  it('uses each site’s latest 24-hour window and a requested site scope', () => {
    const oldFault = telemetry(20, 48, index => index < 24);
    expect(planRecovery(oldFault, DEFAULT).candidates).toEqual([]);
    const scoped = planRecovery(telemetry(20), {...DEFAULT, siteId: 'BLR-01'});
    expect(scoped.candidates).toHaveLength(2);
    expect(scoped.candidates.every(action => action.siteId === 'BLR-01')).toBe(true);
    expect(planRecovery([], DEFAULT).summary.dailyWaterM3).toBe(0);
  });

  it('returns identical candidates, tie outcomes and frontier after input permutation', () => {
    const readings = telemetry(20);
    expect(planRecovery([...readings].reverse(), DEFAULT)).toEqual(planRecovery(readings, DEFAULT));
  });

  it.each([
    {budgetInr: -1}, {budgetInr: 1_000_001}, {budgetInr: Number.NaN},
    {crewHours: Number.POSITIVE_INFINITY}, {crewHours: 101},
    {tariffInrM3: -1}, {tariffInrM3: 10001},
    {horizonDays: 0}, {horizonDays: 366}, {horizonDays: 1.5},
    {siteId: 'unknown'}, {siteId: ''}, {budgetInr: '12000'},
  ])('rejects invalid planner inputs: %j', overrides => {
    expect(() => planRecovery([], {...DEFAULT, ...overrides} as PlanInput)).toThrow(HttpError);
    try { planRecovery([], {...DEFAULT, ...overrides} as PlanInput); } catch (error) { expect((error as HttpError).status).toBe(400); }
  });

  it('rejects invalid or duplicate hourly telemetry before integrating volumes', () => {
    const readings = telemetry(20);
    expect(() => planRecovery([...readings, readings[0]], DEFAULT)).toThrow('duplicate');
    expect(() => planRecovery(readings.filter((_, index) => index !== 1), DEFAULT)).toThrow('no gaps');
  });
});
