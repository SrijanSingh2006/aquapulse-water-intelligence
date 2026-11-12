import artifact from '../ml/model.json';
import metrics from '../ml/metrics.json';
import type { Analysis, ForecastPoint, Reading } from './types';

/** Frozen sklearn export; inference does not fit or update on incoming readings. */
export const modelInfo = {
  ...metrics,
  version: artifact.version,
  source: artifact.source,
  limitations: [
    'All evaluation data is synthetic; no Ecolab or customer data is used.',
    'Future production and temperature use the latest available same-hour profile.',
    'The displayed band is a calibration residual band, not a guaranteed future confidence interval.',
    'Drivers are transparent domain heuristics, not model feature attributions.',
  ],
};

function baseline(siteId: string): number {
  const site = artifact.sites.find(s => s.id === siteId);
  if (!site) throw new Error(`Unknown site: ${siteId}`);
  return site.baselineFlow;
}

function regressionFeatures(r: Reading): number[] {
  const date = new Date(r.timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid reading timestamp');
  const phase = 2 * Math.PI * date.getUTCHours() / 24;
  const base = baseline(r.siteId);
  return [base, base * r.productionIndex, base * Math.sin(phase), base * Math.cos(phase), base * (r.temperatureC - 28)];
}

export function expectedFlow(reading: Reading): number {
  return Math.max(0, artifact.forecast.intercept + regressionFeatures(reading).reduce((sum, x, i) => sum + x * artifact.forecast.coefficients[i], 0));
}

// sklearn's average isolation-tree path length uses this exact approximation.
function averagePathLength(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2 * (Math.log(n - 1) + 0.5772156649015329) - 2 * (n - 1) / n;
}

function isolationScore(features: number[]): number {
  // sklearn tree prediction converts inputs to float32 before traversing.
  const x = features.map(Math.fround);
  const paths = artifact.anomaly.trees.reduce((sum, tree) => {
    let node = 0;
    let depth = 0;
    while (tree.left[node] !== -1) {
      node = x[tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
      depth += 1;
    }
    return sum + depth + averagePathLength(tree.samples[node]);
  }, 0);
  return Math.pow(2, -paths / (artifact.anomaly.trees.length * averagePathLength(artifact.anomaly.maxSamples)));
}

export function analyzeReading(reading: Reading): Analysis {
  const expected = expectedFlow(reading);
  const excess = Math.max(0, reading.flowM3h - expected);
  const score = isolationScore([(reading.flowM3h - expected) / baseline(reading.siteId), reading.conductivityUsCm, reading.ph]);
  const isAnomaly = score > artifact.anomaly.threshold;
  const drivers: string[] = [];
  if (excess > Math.max(3, expected * .12)) drivers.push(`Flow is ${Math.round(excess / expected * 100)}% above the healthy-demand estimate`);
  if (reading.conductivityUsCm > 1500) drivers.push('Conductivity exceeds the demo operating envelope (1,500 µS/cm)');
  if (reading.ph < 6.8 || reading.ph > 8) drivers.push('pH is outside the demo operating envelope (6.8–8.0)');
  if (isAnomaly && drivers.length === 0) drivers.push('The sensor combination differs from learned healthy operation');
  if (!isAnomaly && drivers.length === 0) drivers.push('Telemetry is consistent with learned healthy operation');
  const critical = excess / Math.max(expected, 1) > .25 || reading.conductivityUsCm > 1800 || reading.ph < 6.6;
  return { anomalyScore: score, isAnomaly, expectedFlowM3h: expected, excessFlowM3h: excess, drivers, severity: isAnomaly ? (critical ? 'critical' : 'warning') : 'normal' };
}

/** Project healthy demand. The caller must supply one site's time series. */
export function forecast(readings: Reading[], hours = 24): ForecastPoint[] {
  if (!Number.isInteger(hours) || hours < 1 || hours > 72) throw new Error('Forecast horizon must be an integer from 1 to 72');
  if (readings.length === 0) return [];
  if (new Set(readings.map(r => r.siteId)).size !== 1) throw new Error('Forecast requires a single site');
  const sorted = [...readings].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const latest = sorted.at(-1)!;
  const lastTime = new Date(latest.timestamp).getTime();
  const profile = new Map<number, Reading>();
  for (const reading of sorted) profile.set(new Date(reading.timestamp).getUTCHours(), reading);
  return Array.from({ length: hours }, (_, i) => {
    const timestamp = new Date(lastTime + (i + 1) * 3_600_000).toISOString();
    const source = profile.get(new Date(timestamp).getUTCHours()) ?? latest;
    const predicted = expectedFlow({ ...source, timestamp });
    const radius = artifact.forecast.intervalRadiusM3h;
    return { timestamp, predictedM3h: predicted, lowerM3h: Math.max(0, predicted - radius), upperM3h: predicted + radius };
  });
}
