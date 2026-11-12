import { analyzeReading } from './analytics';
import { SITES } from './demo';
import type { Reading, Site } from './types';
import { HttpError, validateReadings } from './validation';

export interface PlanInput {
  budgetInr: number;
  crewHours: number;
  tariffInrM3: number;
  horizonDays: number;
  siteId?: string;
}

export interface RecoveryAction {
  id: string;
  siteId: string;
  title: string;
  description: string;
  costInr: number;
  crewHours: number;
  dailyWaterM3: number;
  recoveryFraction: number;
  exclusiveGroup: string;
}

export interface RecoveryPlan {
  parameters: PlanInput;
  candidates: RecoveryAction[];
  selectedIds: string[];
  summary: {
    costInr: number;
    crewHours: number;
    dailyWaterM3: number;
    periodWaterM3: number;
    periodValueInr: number;
    netValueInr: number;
    paybackDays: number | null;
  };
  frontier: {
    costInr: number;
    dailyWaterM3: number;
    crewHours: number;
    selectedIds: string[];
  }[];
  algorithm: {
    name: string;
    feasiblePlans: number;
    evaluatedPlans: number;
    objective: string;
  };
  assumptions: string[];
}

interface FeasiblePlan {
  selectedIds: string[];
  costInr: number;
  crewHours: number;
  dailyWaterM3: number;
  netValueInr: number;
}

const HOUR = 3_600_000;
const EPSILON = 1e-8;
const round = (value: number, digits = 2): number => Number(value.toFixed(digits));
const lexical = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const planKey = (plan: FeasiblePlan): string => plan.selectedIds.join('|');

// Illustrative intervention assumptions, not estimated costs or learned treatment effects.
const OPTIONS: Record<string, { inspection: [number, number]; repair: [number, number] }> = {
  'BLR-01': { inspection: [3200, 2], repair: [9800, 6] },
  'PUN-02': { inspection: [2600, 2], repair: [7800, 5] },
  'CHE-03': { inspection: [2400, 1.5], repair: [7200, 4] },
};

function parameters(input: PlanInput): Required<PlanInput> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'Provide recovery-planner parameters as an object.');
  }
  for (const [name, min, max] of [
    ['budgetInr', 0, 1_000_000], ['crewHours', 0, 100],
    ['tariffInrM3', 0, 10_000], ['horizonDays', 1, 365],
  ] as const) {
    const value = input[name];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw new HttpError(400, `${name} must be a finite number between ${min} and ${max}.`);
    }
  }
  if (!Number.isInteger(input.horizonDays)) throw new HttpError(400, 'horizonDays must be an integer.');
  const siteId = input.siteId === undefined ? 'all' : input.siteId;
  if (siteId !== 'all' && !SITES.some(site => site.id === siteId)) {
    throw new HttpError(400, 'Unknown planner siteId.');
  }
  return { budgetInr: input.budgetInr, crewHours: input.crewHours, tariffInrM3: input.tariffInrM3, horizonDays: input.horizonDays, siteId };
}

function candidatesFor(site: Site, readings: Reading[]): RecoveryAction[] {
  const rows = readings.filter(reading => reading.siteId === site.id);
  if (!rows.length) return [];
  const last = Math.max(...rows.map(reading => Date.parse(reading.timestamp)));
  const window = rows.filter(reading => Date.parse(reading.timestamp) > last - 24 * HOUR);
  let excessVolumeM3 = 0;
  for (const reading of window) {
    const result = analyzeReading(reading);
    // Chemistry-only outliers and ordinary residual noise have no claimed water benefit.
    if (result.isAnomaly && result.excessFlowM3h > Math.max(3, result.expectedFlowM3h * 0.12)) {
      excessVolumeM3 += result.excessFlowM3h; // Each validated reading is one hourly average.
    }
  }
  if (excessVolumeM3 <= 0) return [];
  // Include healthy hours in the denominator: a single fault hour is not a whole-day fault.
  const dailyExcessM3 = excessVolumeM3 / window.length * 24;
  const option = OPTIONS[site.id];
  const observation = `Based on ${window.length} observed hourly samples ending ${new Date(last).toISOString()}.`;
  return [
    { id: `${site.id}:inspect`, siteId: site.id, title: 'Inspect and correct minor losses', description: `${observation} Demo assumption: recover 35% of materially excessive flow after inspection and minor corrections.`, costInr: option.inspection[0], crewHours: option.inspection[1], dailyWaterM3: dailyExcessM3 * 0.35, recoveryFraction: 0.35, exclusiveGroup: site.id },
    { id: `${site.id}:repair`, siteId: site.id, title: 'Investigate and repair the loss source', description: `${observation} Demo assumption: recover 75% after a larger repair. Requires an operator to verify the fault and estimate.`, costInr: option.repair[0], crewHours: option.repair[1], dailyWaterM3: dailyExcessM3 * 0.75, recoveryFraction: 0.75, exclusiveGroup: site.id },
  ];
}

function better(a: FeasiblePlan, b: FeasiblePlan): boolean {
  if (Math.abs(a.netValueInr - b.netValueInr) > EPSILON) return a.netValueInr > b.netValueInr;
  if (Math.abs(a.costInr - b.costInr) > EPSILON) return a.costInr < b.costInr;
  return lexical(planKey(a), planKey(b)) < 0;
}

function pareto(plans: FeasiblePlan[]): FeasiblePlan[] {
  // First deduplicate equal cost/water points, preferring less crew time then stable IDs.
  const points: FeasiblePlan[] = [];
  for (const plan of [...plans].sort((a, b) => a.costInr - b.costInr || b.dailyWaterM3 - a.dailyWaterM3 || a.crewHours - b.crewHours || lexical(planKey(a), planKey(b)))) {
    if (!points.some(other => Math.abs(other.costInr - plan.costInr) <= EPSILON && Math.abs(other.dailyWaterM3 - plan.dailyWaterM3) <= EPSILON)) points.push(plan);
  }
  return points.filter(plan => !points.some(other =>
    other.costInr <= plan.costInr + EPSILON && other.dailyWaterM3 >= plan.dailyWaterM3 - EPSILON &&
    (other.costInr < plan.costInr - EPSILON || other.dailyWaterM3 > plan.dailyWaterM3 + EPSILON)
  ));
}

/** Exhaustive, exact selection over at most six illustrative, mutually exclusive actions. */
export function planRecovery(readings: Reading[], input: PlanInput): RecoveryPlan {
  const params = parameters(input);
  if (!Array.isArray(readings)) throw new HttpError(400, 'Planner readings must be an array.');
  // This also protects unit integration from duplicate, missing, or non-hourly samples.
  const validated = readings.length ? validateReadings(readings) : [];
  const candidates = SITES.filter(site => params.siteId === 'all' || site.id === params.siteId)
    .flatMap(site => candidatesFor(site, validated)).sort((a, b) => lexical(a.id, b.id));
  const evaluatedPlans = 2 ** candidates.length;
  const feasible: FeasiblePlan[] = [];
  for (let mask = 0; mask < evaluatedPlans; mask++) {
    const selected = candidates.filter((_, index) => (mask & (1 << index)) !== 0);
    if (new Set(selected.map(action => action.exclusiveGroup)).size !== selected.length) continue;
    const costInr = selected.reduce((sum, action) => sum + action.costInr, 0);
    const crewHours = selected.reduce((sum, action) => sum + action.crewHours, 0);
    if (costInr > params.budgetInr || crewHours > params.crewHours) continue;
    const dailyWaterM3 = selected.reduce((sum, action) => sum + action.dailyWaterM3, 0);
    feasible.push({ selectedIds: selected.map(action => action.id), costInr, crewHours, dailyWaterM3, netValueInr: dailyWaterM3 * params.horizonDays * params.tariffInrM3 - costInr });
  }
  // The empty subset is always feasible and has zero value, so a losing project is never forced.
  const best = feasible.reduce((winner, plan) => better(plan, winner) ? plan : winner, feasible[0]);
  const periodWaterM3 = best.dailyWaterM3 * params.horizonDays;
  const periodValueInr = periodWaterM3 * params.tariffInrM3;
  const dailyValueInr = best.dailyWaterM3 * params.tariffInrM3;
  return {
    parameters: params,
    candidates,
    selectedIds: best.selectedIds,
    summary: { costInr: round(best.costInr), crewHours: best.crewHours, dailyWaterM3: round(best.dailyWaterM3, 3), periodWaterM3: round(periodWaterM3, 3), periodValueInr: round(periodValueInr), netValueInr: round(best.netValueInr), paybackDays: dailyValueInr > 0 ? round(best.costInr / dailyValueInr) : null },
    frontier: pareto(feasible).map(plan => ({ costInr: plan.costInr, dailyWaterM3: plan.dailyWaterM3, crewHours: plan.crewHours, selectedIds: plan.selectedIds })),
    algorithm: { name: 'Exact bounded subset enumeration', evaluatedPlans, feasiblePlans: feasible.length, objective: 'Maximize estimated water value over the chosen horizon minus upfront intervention cost, subject to budget, crew hours and one action per site.' },
    assumptions: [
      'All intervention costs, crew hours and recovery fractions are illustrative scenario inputs, not field quotations, learned effects or treatment recommendations.',
      'Only ML-flagged hours whose excess flow exceeds both 3 m³/h and 12% of expected demand create recovery candidates. Chemistry-only anomalies create no claimed water saving.',
      'Each validated hourly sample contributes one hour of volume. Each site uses its own latest 24-hour window, including healthy hours in its average.',
      'For a partial window, observed average excess is extrapolated to 24 hours. The estimate assumes the observed fault frequency, operating conditions and recovered share persist throughout the horizon.',
      'Inspection and repair are alternatives for the same site. Their benefits cannot be stacked. The planner never actuates equipment or schedules work.',
      'Net value excludes discounting, recurring maintenance, energy, downtime, taxes and changing tariffs. Forecasts and scenario estimates are not measured savings.',
      'The frontier shows feasible plans with no other feasible plan costing less or equal while recovering more or equal water, with at least one strict improvement. The economic optimum may differ from the greatest-water plan.',
      'An empty plan is always feasible. Zero budget, insufficient resources, or non-positive economic value can correctly result in no selected actions.',
    ],
  };
}
