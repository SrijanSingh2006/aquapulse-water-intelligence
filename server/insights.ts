import reference from '../ml/reference.json';
import { expectedFlow } from './analytics';
import { SITES } from './demo';
import type { Reading } from './types';

export type MonitorStatus = 'insufficient_data' | 'stable' | 'watch' | 'shifted';
export interface AssuranceScope { siteId: string; hours: number; datasetClock?: string }
export interface DriftFeature {
  name: string;
  label: string;
  psi: number | null;
  status: MonitorStatus;
  referenceMean: number;
  currentMean: number | null;
  samples: number;
  bins: { from: number | null; to: number | null; referencePercent: number; currentPercent: number }[];
}
export interface AssuranceReport {
  scope: { siteId: string; hours: number; datasetClock: string | null };
  totalRows: number;
  model: { version: string; fingerprint: string; trainingRows: number; source: string };
  quality: {
    scorePercent: number;
    duplicateRows: number;
    invalidRows: number;
    misalignedRows: number;
    missingHours: number;
    staleSites: string[];
    stuckSensors: { siteId: string; metric: string; runHours: number; epsilon: number; start: string; end: string }[];
    issues: { severity: string; title: string; detail: string }[];
    expectedRows: number;
    completenessPercent: number;
    lastTimestamp: string | null;
    windowStart: string | null;
    scoreMethod: string;
    gaps: { siteId: string; missingHours: number; longestGapHours: number }[];
  };
  drift: { status: MonitorStatus; referenceLabel: string; minSamples: number; referenceRows: number; features: DriftFeature[] };
  interpretation: string[];
}

type SensorMetric = 'flowM3h' | 'conductivityUsCm' | 'temperatureC' | 'ph' | 'productionIndex';
const sensorEpsilon: Record<SensorMetric, number> = { flowM3h: .01, conductivityUsCm: 1, temperatureC: .01, ph: .001, productionIndex: .001 };
const HOUR = 3_600_000;
const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const featureValues = (row: Reading): Record<string, number> => {
  const site = SITES.find(s => s.id === row.siteId)!;
  return { flowResidualRatio: (row.flowM3h - expectedFlow(row)) / site.baselineFlow, conductivityUsCm: row.conductivityUsCm, ph: row.ph, productionIndex: row.productionIndex, temperatureC: row.temperatureC };
};
const statusForPsi = (psi: number): MonitorStatus => psi < reference.psiThresholds.stable ? 'stable' : psi < reference.psiThresholds.watch ? 'watch' : 'shifted';

/**
 * Inspect actual observations against a frozen training reference. Never fills gaps,
 * retrains on uploads, or compares historical replay timestamps with wall-clock time.
 */
export function inspectTelemetry(readings: Reading[], scope: AssuranceScope = { siteId: 'all', hours: 168 }): AssuranceReport {
  const { siteId, hours } = scope;
  if (siteId !== 'all' && !SITES.some(s => s.id === siteId)) throw new Error('Unknown assurance site');
  if (!Number.isInteger(hours) || hours < 1 || hours > 8760) throw new Error('Assurance hours must be an integer from 1 to 8760');
  const sites = SITES.filter(s => siteId === 'all' || s.id === siteId);
  const inputTimes = readings.map(r => Date.parse(r.timestamp)).filter(Number.isFinite);
  const suppliedClock = scope.datasetClock === undefined ? NaN : Date.parse(scope.datasetClock);
  if (scope.datasetClock !== undefined && !Number.isFinite(suppliedClock)) throw new Error('Invalid dataset clock');
  const clock = Number.isFinite(suppliedClock) ? suppliedClock : inputTimes.length ? Math.max(...inputTimes) : null;
  const windowStart = clock === null ? null : clock - hours * HOUR;
  const scoped = readings.filter(r => (siteId === 'all' || r.siteId === siteId) && (!Number.isFinite(Date.parse(r.timestamp)) || (clock !== null && Date.parse(r.timestamp) > windowStart! && Date.parse(r.timestamp) <= clock)));
  const issues: AssuranceReport['quality']['issues'] = [];
  let duplicateRows = 0, invalidRows = 0, misalignedRows = 0;
  const seen = new Set<string>();
  const unique: Reading[] = [];
  for (const row of scoped) {
    const time = Date.parse(row.timestamp);
    const site = sites.find(s => s.id === row.siteId);
    if (!Number.isFinite(time) || !site || row.assetId !== site.assetId || !Object.keys(sensorEpsilon).every(metric => Number.isFinite(row[metric as SensorMetric]))) { invalidRows++; continue; }
    const key = `${row.siteId}|${time}`;
    if (seen.has(key)) { duplicateRows++; continue; }
    seen.add(key);
    if (time % HOUR !== 0) { misalignedRows++; continue; }
    unique.push(row);
  }
  unique.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.siteId.localeCompare(b.siteId));
  const slots = clock === null ? [] : Array.from({ length: hours }, (_, i) => Math.floor(clock / HOUR) * HOUR - (hours - 1 - i) * HOUR);
  const expectedRows = hours * sites.length;
  const gaps: AssuranceReport['quality']['gaps'] = [];
  const staleSites: string[] = [];
  const stuckSensors: AssuranceReport['quality']['stuckSensors'] = [];
  let observedSlots = 0;
  for (const site of sites) {
    const rows = unique.filter(r => r.siteId === site.id);
    const actual = new Set(rows.map(r => Date.parse(r.timestamp)));
    let missing = 0, gap = 0, longestGap = 0;
    for (const slot of slots) {
      if (actual.has(slot)) { observedSlots++; gap = 0; }
      else { missing++; gap++; longestGap = Math.max(longestGap, gap); }
    }
    if (clock === null) { missing = hours; longestGap = hours; }
    gaps.push({ siteId: site.id, missingHours: missing, longestGapHours: longestGap });
    const latest = rows.at(-1);
    if (!latest || (clock !== null && clock - Date.parse(latest.timestamp) > HOUR)) staleSites.push(site.id);
    for (const [metric, epsilon] of Object.entries(sensorEpsilon) as [SensorMetric, number][]) {
      let start = 0, bestStart = 0, bestEnd = 0, bestHours = 0;
      // Monotone queues retain overlapping candidate runs in linear time.
      // A stuck run's full max-minus-min sensor range must stay within epsilon.
      const maxima: number[] = [], minima: number[] = [];
      let maxHead = 0, minHead = 0;
      for (let i = 0; i < rows.length; i++) {
        if (i && Date.parse(rows[i].timestamp) - Date.parse(rows[i - 1].timestamp) !== HOUR) {
          start = i; maxima.length = 0; minima.length = 0; maxHead = 0; minHead = 0;
        }
        while (maxima.length > maxHead && rows[maxima.at(-1)!][metric] <= rows[i][metric]) maxima.pop();
        while (minima.length > minHead && rows[minima.at(-1)!][metric] >= rows[i][metric]) minima.pop();
        maxima.push(i); minima.push(i);
        while (rows[maxima[maxHead]][metric] - rows[minima[minHead]][metric] > epsilon + Number.EPSILON * Math.max(1, Math.abs(rows[maxima[maxHead]][metric]), Math.abs(rows[minima[minHead]][metric])) * 8) {
          start++;
          if (maxima[maxHead] < start) maxHead++;
          if (minima[minHead] < start) minHead++;
        }
        const runHours = (Date.parse(rows[i].timestamp) - Date.parse(rows[start].timestamp)) / HOUR;
        if (runHours > bestHours) { bestStart = start; bestEnd = i; bestHours = runHours; }
      }
      if (bestHours >= 6) stuckSensors.push({ siteId: site.id, metric, runHours: bestHours, epsilon, start: rows[bestStart].timestamp, end: rows[bestEnd].timestamp });
    }
  }
  const missingHours = Math.max(0, expectedRows - observedSlots);
  const completenessPercent = expectedRows ? 100 * observedSlots / expectedRows : 0;
  const badRowPenalty = scoped.length ? 100 * (duplicateRows + invalidRows + misalignedRows) / scoped.length : 0;
  const stuckPenalty = 20 * stuckSensors.length / Math.max(1, sites.length * Object.keys(sensorEpsilon).length);
  const scorePercent = round(Math.max(0, completenessPercent - badRowPenalty - stuckPenalty));
  if (!unique.length) issues.push({ severity: 'critical', title: 'No usable hourly telemetry', detail: 'No valid, distinct hourly observations are available in the requested scope. Monitoring cannot establish stability.' });
  if (missingHours) issues.push({ severity: 'warning', title: 'Hourly coverage has gaps', detail: `${missingHours} of ${expectedRows} expected site-hour observations are missing. Missing observations are not filled or scored as healthy.` });
  if (duplicateRows) issues.push({ severity: 'warning', title: 'Duplicate observations', detail: `${duplicateRows} repeated site/timestamp rows were excluded from distribution and completeness calculations.` });
  if (invalidRows) issues.push({ severity: 'warning', title: 'Invalid observations', detail: `${invalidRows} rows have invalid timestamps, unknown site/asset identity, or non-finite sensor values and were excluded.` });
  if (misalignedRows) issues.push({ severity: 'warning', title: 'Observations are off the hourly grid', detail: `${misalignedRows} rows do not align with a UTC hour and were excluded; the expected sampling interval is one hour.` });
  if (staleSites.length) issues.push({ severity: 'warning', title: 'Sites lag the dataset clock', detail: `${staleSites.join(', ')} have no usable sample or a latest sample more than one hour behind the dataset clock. Historical replay is not compared with today's clock.` });
  if (stuckSensors.length) issues.push({ severity: 'warning', title: 'Possible stuck sensor signals', detail: `${stuckSensors.length} sensor/site combinations stay within their tolerance for at least six elapsed consecutive hours. Steady operations can also produce constant values; investigate before treating this as a failure.` });

  const perSite = reference.bySite as Record<string, { rows: number; features: typeof reference.features }>;
  const population = siteId === 'all' ? { rows: reference.trainingRows, features: reference.features } : perSite[siteId];
  const extracted = unique.map(featureValues);
  const driftFeatures: DriftFeature[] = population.features.map(feature => {
    const values = extracted.map(row => row[feature.name]).filter(Number.isFinite);
    const count = values.length;
    const bins = feature.proportions.map((proportion, i) => {
      const from = feature.edges[i], to = feature.edges[i + 1];
      const binCount = values.filter(v => (from === null || v >= from) && (to === null || v < to)).length;
      return { from, to, referencePercent: 100 * proportion, currentPercent: count ? 100 * binCount / count : 0 };
    });
    const epsilon = reference.smoothingEpsilon;
    const denominator = 1 + epsilon * bins.length;
    const psi = count < reference.minSamples ? null : bins.reduce((sum, bin) => {
      const p = (bin.referencePercent / 100 + epsilon) / denominator;
      const q = (bin.currentPercent / 100 + epsilon) / denominator;
      return sum + (q - p) * Math.log(q / p);
    }, 0);
    return { name: feature.name, label: feature.label, psi, status: psi === null ? 'insufficient_data' : statusForPsi(psi), referenceMean: feature.mean, currentMean: count ? values.reduce((a, b) => a + b, 0) / count : null, samples: count, bins };
  });
  const driftStatus: MonitorStatus = driftFeatures.some(f => f.status === 'insufficient_data') ? 'insufficient_data' : driftFeatures.some(f => f.status === 'shifted') ? 'shifted' : driftFeatures.some(f => f.status === 'watch') ? 'watch' : 'stable';
  if (driftStatus === 'insufficient_data') issues.push({ severity: 'info', title: 'More samples needed for drift assessment', detail: `Each feature needs at least ${reference.minSamples} distinct, usable observations. A short or empty window is insufficient data, not evidence of stability.` });
  if (driftStatus === 'shifted' || driftStatus === 'watch') issues.push({ severity: 'warning', title: 'Input distribution differs from training', detail: 'PSI is a distribution-monitoring heuristic. A shift can indicate operating changes, site differences, synthetic faults, or sensor problems; it does not establish model accuracy or failure.' });
  const interpretation = [
    'The reference is frozen healthy synthetic training telemetry. Monitoring does not retrain the model or use fault labels from uploaded data.',
    'PSI uses ten training-quantile bins with open-ended tails and additive smoothing (ε = 0.0001). Thresholds <0.10 stable, <0.25 watch, otherwise shifted are heuristics, not statistical confidence levels.',
    `A minimum of ${reference.minSamples} distinct observations per feature is required. Small windows and seasonal or production changes can produce noisy PSI values; compare like operating periods.`,
    'Completeness counts actual UTC-hour observations in the requested window for configured sites. Missing site-hours, duplicates, and invalid rows are excluded; no observations are silently filled.',
    'The quality score is a transparent operational heuristic: completeness percentage minus invalid/duplicate/off-grid row percentage minus a maximum 20-point stuck-sensor penalty. It is not a probability or certified data-quality rating.',
    'Stuck-sensor checks require at least six elapsed hours (seven consecutive hourly samples) within a metric-specific tolerance; normal steady operation can trigger a check.',
    'Dataset freshness is relative to the supplied dataset clock, or the latest available input timestamp. It does not prove a connection to live sensors.',
  ];
  return {
    scope: { siteId, hours, datasetClock: clock === null ? null : new Date(clock).toISOString() }, totalRows: scoped.length,
    model: { version: reference.modelVersion, fingerprint: reference.modelSha256, trainingRows: reference.trainingRows, source: reference.source },
    quality: { scorePercent, duplicateRows, invalidRows, misalignedRows, missingHours, staleSites, stuckSensors, issues, expectedRows, completenessPercent: round(completenessPercent), lastTimestamp: unique.at(-1)?.timestamp ?? null, windowStart: windowStart === null ? null : new Date(windowStart).toISOString(), scoreMethod: 'Completeness % − bad-row % − 20 × stuck sensor/site fraction; clamped to [0,100].', gaps },
    drift: { status: driftStatus, referenceLabel: `Healthy synthetic training · ${siteId === 'all' ? 'all configured sites' : siteId} · ${reference.trainingStart} to ${reference.trainingEnd}`, minSamples: reference.minSamples, referenceRows: population.rows, features: driftFeatures }, interpretation,
  };
}
