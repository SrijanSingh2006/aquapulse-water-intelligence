import { describe, expect, it } from 'vitest';
import fixtures from '../ml/parity-fixtures.json';
import { analyzeReading, expectedFlow, forecast, modelInfo } from '../server/analytics';
import { demoReadings, SITES } from '../server/demo';

describe('Python-to-TypeScript inference parity', () => {
  for (const [index, fixture] of fixtures.entries()) {
    it(`matches sklearn fixture ${index + 1}`, () => {
      const result = analyzeReading(fixture.reading);
      expect(result.expectedFlowM3h).toBeCloseTo(fixture.expectedFlowM3h, 9);
      expect(result.anomalyScore).toBeCloseTo(fixture.anomalyScore, 12);
      expect(result.isAnomaly).toBe(fixture.isAnomaly);
    });
  }
});

describe('operational analysis and demand projection', () => {
  it('flags the injected leak and water-quality faults while leaving Pune healthy', () => {
    for (const site of SITES) {
      const reading = demoReadings().filter(r => r.siteId === site.id).at(-1)!;
      const result = analyzeReading(reading);
      expect(result.isAnomaly).toBe(site.id !== 'PUN-02');
      expect(result.severity).toBe(site.id !== 'PUN-02' ? 'critical' : 'normal');
      if (site.id === 'BLR-01') expect(result.excessFlowM3h).toBeGreaterThan(15);
      if (site.id === 'CHE-03') expect(result.drivers.some(d => d.includes('Conductivity'))).toBe(true);
    }
  });
  it('creates ordered, nonnegative, bounded projections without consuming fault flow', () => {
    const readings = demoReadings().filter(r => r.siteId === 'BLR-01');
    const original = structuredClone(readings);
    const points = forecast(readings, 24);
    expect(points).toHaveLength(24);
    expect(points[0].timestamp).toBe(new Date(Date.parse(readings.at(-1)!.timestamp) + 3_600_000).toISOString());
    for (let i = 0; i < points.length; i++) {
      expect(points[i].lowerM3h).toBeGreaterThanOrEqual(0);
      expect(points[i].lowerM3h).toBeLessThan(points[i].predictedM3h);
      expect(points[i].upperM3h).toBeGreaterThan(points[i].predictedM3h);
      if (i) expect(points[i].timestamp > points[i - 1].timestamp).toBe(true);
    }
    const corrupted = readings.map(r => ({ ...r, flowM3h: r.flowM3h + 1000 }));
    expect(forecast(corrupted)).toEqual(points);
    expect(readings).toEqual(original);
  });
  it('handles empty history and rejects mixed sites or invalid horizons', () => {
    expect(forecast([])).toEqual([]);
    expect(() => forecast(demoReadings())).toThrow('single site');
    expect(() => forecast([], 73)).toThrow('horizon');
    expect(() => forecast([], 1.5)).toThrow('horizon');
    expect(() => expectedFlow({ ...fixtures[0].reading, siteId: 'unknown' })).toThrow('Unknown site');
  });
  it('publishes honest synthetic provenance and strictly ordered chronological splits', () => {
    expect(modelInfo.dataset).toBe('Synthetic benchmark only');
    expect(modelInfo.split.trainEnd < modelInfo.split.calibrationStart).toBe(true);
    expect(modelInfo.split.calibrationEnd < modelInfo.split.testStart).toBe(true);
    expect(modelInfo.forecast.evaluatedRows).toBeGreaterThan(0);
  });
});
