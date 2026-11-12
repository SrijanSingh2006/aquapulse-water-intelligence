import { analyzeReading, expectedFlow } from './analytics';
import { SITES } from './demo';
import { HttpError } from './validation';
import type { Analysis, Reading } from './types';
export const SCENARIOS = ['healthy', 'leak', 'sensor_drift'] as const;
export type ReplayScenario = typeof SCENARIOS[number];
export interface ReplayFrame { sequence: number; reading: Reading; analysis: Analysis }
export function makeReplay(readings: Reading[], siteId: string, scenario: string, steps: number): ReplayFrame[] {
  if (!SCENARIOS.includes(scenario as ReplayScenario)) throw new HttpError(400, 'Choose healthy, leak, or sensor_drift.');
  if (!Number.isInteger(steps) || steps < 1 || steps > 48) throw new HttpError(400, 'steps must be an integer from 1 to 48.');
  const sites = SITES.filter(site => siteId === 'all' || site.id === siteId);
  if (!sites.length) throw new HttpError(400, 'Unknown siteId.');
  const selected = readings.filter(row => sites.some(site => site.id === row.siteId));
  if (!selected.length || sites.some(site => !selected.some(row => row.siteId === site.id))) {
    throw new HttpError(400, 'Import data for every selected site, or choose a site with readings.');
  }
  const latest = Math.max(...selected.map(row => Date.parse(row.timestamp)));
  const frames: ReplayFrame[] = [];
  for (let step = 1; step <= steps; step++) {
    const timestamp = new Date(latest + step * 3_600_000).toISOString();
    for (const site of sites) {
      const profile = selected.filter(row => row.siteId === site.id).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const template = [...profile].reverse().find(row => new Date(row.timestamp).getUTCHours() === new Date(timestamp).getUTCHours()) ?? profile.at(-1)!;
      const reading: Reading = { ...template, timestamp,
        flowM3h: 0, conductivityUsCm: 1200 + 40 * Math.sin(step * .4), ph: 7.3 + .04 * Math.cos(step * .3) };
      reading.flowM3h = expectedFlow(reading) + .25 * Math.sin(step * 1.2);
      if (scenario === 'leak' && step > Math.floor(steps / 3)) reading.flowM3h += site.baselineFlow * .4;
      if (scenario === 'sensor_drift') {
        reading.conductivityUsCm += 1000 * step / steps;
        reading.ph -= .8 * step / steps;
      }
      for (const key of ['flowM3h', 'conductivityUsCm', 'ph'] as const) reading[key] = Math.round(reading[key] * 1000) / 1000;
      frames.push({ sequence: frames.length + 1, reading, analysis: analyzeReading(reading) });
    }
  }
  return frames;
}
export function replayStream(frames: ReplayFrame[], scenario: string, signal: AbortSignal, cookie?: string): Response {
  let closed = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown, id?: number) => controller.enqueue(encoder.encode(
        `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        for (const frame of frames) {
          if (closed || signal.aborted) break;
          send('reading', frame, frame.sequence);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!closed && !signal.aborted) send('complete', { count: frames.length, scenario });
      } catch { /* The receiver may close the stream between enqueue and cancellation. */ }
      finally { if (!closed) { closed = true; try { controller.close(); } catch { /* already cancelled */ } } }
    },
    cancel() { closed = true; },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
}
