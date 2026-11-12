import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import reference from '../ml/reference.json';
import { expectedFlow } from '../server/analytics';
import { inspectTelemetry } from '../server/insights';
import type { Reading } from '../server/types';

const hour = 3_600_000;
const end = Date.parse('2026-11-12T18:00:00Z');
/** Construct matching marginal histograms without reading test/calibration labels. */
function aligned(count = 100): Reading[] {
  const features = reference.bySite['BLR-01'].features;
  return Array.from({ length: count }, (_, i) => {
    const values = Object.fromEntries(features.map(feature => {
      const bin = i % feature.proportions.length;
      const low = feature.edges[bin], high = feature.edges[bin + 1];
      const value = low === null ? high! - .25 * (feature.edges[2]! - high!) : high === null ? low + .25 * (low - feature.edges[bin - 1]!) : (low + high) / 2;
      return [feature.name, value];
    }));
    const row: Reading = { timestamp: new Date(end - (count - 1 - i) * hour).toISOString(), siteId: 'BLR-01', assetId: 'blr-ct-01', flowM3h: 0, conductivityUsCm: values.conductivityUsCm, temperatureC: values.temperatureC, ph: values.ph, productionIndex: values.productionIndex };
    row.flowM3h = expectedFlow(row) + values.flowResidualRatio * 42;
    return row;
  });
}

describe('frozen-reference distribution monitoring', () => {
  it('reports stable aligned marginals and complete actual hourly coverage', () => {
    const report = inspectTelemetry(aligned(), { siteId: 'BLR-01', hours: 100 });
    expect(report.drift.status).toBe('stable');
    expect(report.drift.features.every(feature => feature.psi !== null && feature.psi < .01 && feature.samples === 100)).toBe(true);
    expect(report.quality.completenessPercent).toBe(100);
    expect(report.quality.missingHours).toBe(0);
    expect(report.quality.expectedRows).toBe(100);
    expect(report.quality.scorePercent).toBe(100);
    expect(report.drift.referenceRows).toBe(504);
    for (const feature of report.drift.features) {
      expect(feature.bins.reduce((sum, bin) => sum + bin.currentPercent, 0)).toBeCloseTo(100, 10);
      expect(feature.bins[0].from).toBeNull();
      expect(feature.bins.at(-1)!.to).toBeNull();
    }
  });
  it('detects actual feature shifts while leaving unchanged features stable', () => {
    const shifted = aligned().map(row => ({ ...row, conductivityUsCm: row.conductivityUsCm + 1500 }));
    const report = inspectTelemetry(shifted, { siteId: 'BLR-01', hours: 100 });
    expect(report.drift.status).toBe('shifted');
    expect(report.drift.features.find(f => f.name === 'conductivityUsCm')!.psi).toBeGreaterThan(.25);
    expect(report.drift.features.find(f => f.name === 'ph')!.status).toBe('stable');
    expect(report.interpretation.some(text => text.includes('not statistical confidence'))).toBe(true);
  });
  it('never calls empty or short populations stable', () => {
    const empty = inspectTelemetry([], { siteId: 'all', hours: 24 });
    expect(empty.drift.status).toBe('insufficient_data');
    expect(empty.drift.features.every(f => f.psi === null && f.currentMean === null)).toBe(true);
    expect(empty.quality.scorePercent).toBe(0);
    expect(empty.quality.missingHours).toBe(72);
    expect(empty.quality.staleSites).toHaveLength(3);
    const short = inspectTelemetry(aligned(29), { siteId: 'BLR-01', hours: 100 });
    expect(short.drift.status).toBe('insufficient_data');
    expect(short.drift.features.every(f => f.samples === 29 && f.psi === null)).toBe(true);
    const enough = inspectTelemetry(aligned(30), { siteId: 'BLR-01', hours: 100 });
    expect(enough.drift.features.every(f => f.samples === 30 && Number.isFinite(f.psi))).toBe(true);
  });
  it('fingerprints the exact frozen model artifact bytes', () => {
    const digest = createHash('sha256').update(readFileSync(new URL('../ml/model.json', import.meta.url))).digest('hex');
    const report = inspectTelemetry(aligned(), { siteId: 'BLR-01', hours: 100 });
    expect(report.model.fingerprint).toBe(digest);
    expect(report.model.trainingRows).toBe(1512);
    expect(report.model.source).toContain('training data only');
  });
});

describe('telemetry quality and scope integrity', () => {
  it('counts duplicates and real gaps without filling them or inflating drift sample size', () => {
    const rows = aligned(40).filter((_, i) => i !== 15);
    const input = [...rows, { ...rows[3] }, { ...rows[3] }];
    const before = structuredClone(input);
    const report = inspectTelemetry(input, { siteId: 'BLR-01', hours: 40 });
    expect(report.totalRows).toBe(41);
    expect(report.quality.duplicateRows).toBe(2);
    expect(report.quality.missingHours).toBe(1);
    expect(report.quality.completenessPercent).toBe(97.5);
    expect(report.quality.gaps).toEqual([{ siteId: 'BLR-01', missingHours: 1, longestGapHours: 1 }]);
    expect(report.drift.features.every(f => f.samples === 39)).toBe(true);
    expect(input).toEqual(before);
  });
  it('does not let duplicate rows satisfy the minimum-sample rule', () => {
    const rows = aligned(29);
    const report = inspectTelemetry([...rows, ...rows], { siteId: 'BLR-01', hours: 29 });
    expect(report.quality.duplicateRows).toBe(29);
    expect(report.drift.status).toBe('insufficient_data');
  });
  it('detects missing/stale sites relative to the dataset clock, including selected-site scopes', () => {
    const clock = new Date(end + 5 * hour).toISOString();
    const all = inspectTelemetry(aligned(40), { siteId: 'all', hours: 40, datasetClock: clock });
    expect(all.quality.staleSites).toEqual(['BLR-01', 'PUN-02', 'CHE-03']);
    expect(all.quality.expectedRows).toBe(120);
    expect(all.quality.missingHours).toBe(85);
    const selected = inspectTelemetry(aligned(40), { siteId: 'BLR-01', hours: 40, datasetClock: clock });
    expect(selected.quality.staleSites).toEqual(['BLR-01']);
    expect(selected.quality.missingHours).toBe(5);
    expect(selected.scope.datasetClock).toBe(clock);
    expect(selected.quality.lastTimestamp).toBe(new Date(end).toISOString());
    const replay = inspectTelemetry(aligned(40), { siteId: 'BLR-01', hours: 40 });
    expect(replay.quality.staleSites).toEqual([]);
  });
  it('detects six elapsed consecutive hours within tolerance and breaks runs at gaps', () => {
    const stuck = aligned(7).map(row => ({ ...row, ph: 7.3 }));
    const report = inspectTelemetry(stuck, { siteId: 'BLR-01', hours: 7 });
    expect(report.quality.stuckSensors.find(s => s.metric === 'ph')).toMatchObject({ siteId: 'BLR-01', runHours: 6, epsilon: .001 });
    const onlySixSamples = inspectTelemetry(stuck.slice(1), { siteId: 'BLR-01', hours: 7 });
    expect(onlySixSamples.quality.stuckSensors.find(s => s.metric === 'ph')).toBeUndefined();
    const gapped = inspectTelemetry(stuck.filter((_, i) => i !== 3), { siteId: 'BLR-01', hours: 7 });
    expect(gapped.quality.stuckSensors.find(s => s.metric === 'ph')).toBeUndefined();
    expect(gapped.quality.missingHours).toBe(1);
  });
  it('retains overlapping near-constant windows and rejects gradual drift beyond tolerance', () => {
    const values = [7.3000, 7.3009, 7.3018, 7.3018, 7.3018, 7.3018, 7.3018, 7.3018];
    const rows = aligned(8).map((row, i) => ({ ...row, ph: values[i] }));
    const report = inspectTelemetry(rows, { siteId: 'BLR-01', hours: 8 });
    expect(report.quality.stuckSensors.find(sensor => sensor.metric === 'ph')).toMatchObject({ runHours: 6, start: rows[1].timestamp });
    const atTolerance = aligned(7).map((row, i) => ({ ...row, ph: i % 2 ? 7.301 : 7.3 }));
    expect(inspectTelemetry(atTolerance, { siteId: 'BLR-01', hours: 7 }).quality.stuckSensors.find(sensor => sensor.metric === 'ph')!.runHours).toBe(6);
    const gradual = rows.map((row, i) => ({ ...row, ph: 7.3 + i * .0005 }));
    expect(inspectTelemetry(gradual, { siteId: 'BLR-01', hours: 8 }).quality.stuckSensors.find(sensor => sensor.metric === 'ph')).toBeUndefined();
  });
  it('excludes off-grid and non-finite input rather than inventing observations', () => {
    const rows = aligned(40);
    rows[4] = { ...rows[4], timestamp: new Date(Date.parse(rows[4].timestamp) + 30 * 60_000).toISOString() };
    rows[7] = { ...rows[7], ph: Number.NaN };
    const report = inspectTelemetry(rows, { siteId: 'BLR-01', hours: 40 });
    expect(report.quality.misalignedRows).toBe(1);
    expect(report.quality.invalidRows).toBe(1);
    expect(report.quality.missingHours).toBe(2);
    expect(report.drift.features.every(f => f.samples === 38)).toBe(true);
    expect(report.quality.scorePercent).toBeLessThan(95);
  });
  it('filters the requested scope/window and rejects invalid scope controls', () => {
    const rows = aligned(100);
    const report = inspectTelemetry(rows, { siteId: 'BLR-01', hours: 24 });
    expect(report.totalRows).toBe(24);
    expect(report.drift.status).toBe('insufficient_data');
    expect(report.quality.windowStart).toBe(new Date(end - 24 * hour).toISOString());
    expect(() => inspectTelemetry(rows, { siteId: 'unknown', hours: 24 })).toThrow('site');
    expect(() => inspectTelemetry(rows, { siteId: 'all', hours: 0 })).toThrow('hours');
    expect(() => inspectTelemetry(rows, { siteId: 'all', hours: 24, datasetClock: 'invalid' })).toThrow('clock');
  });
});
