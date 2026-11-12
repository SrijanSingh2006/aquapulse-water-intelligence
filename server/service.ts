import { SITES, demoReadings } from './demo';
import { analyzeReading, forecast, modelInfo } from './analytics';
import { inspectTelemetry } from './insights';
import { planRecovery, type PlanInput } from './planner';
import { canonicalJson, sha256, verifyAudit } from './audit';
import { loadWorkspace, readAuditSnapshot, readReceipt, commitWorkspace, type Workspace, type Receipt } from './store';
import { makeReplay, replayStream, SCENARIOS } from './replay';
import { openApi } from './openapi';
import type { Reading, Incident } from './types';
import { HttpError, queryScope, validateReadings } from './validation';
export interface Env { DB: D1Database }
const round = (value: number) => Math.round(value * 100) / 100;
function incidentsFor(readings: Reading[]): Incident[] {
  const incidents: Incident[] = [];
  for (const site of SITES) {
    const rows = readings.filter(row => row.siteId === site.id).slice(-24);
    const flagged = rows.map(reading => ({ reading, analysis: analyzeReading(reading) })).filter(row => row.analysis.isAnomaly);
    if (!flagged.length) continue;
    const last = flagged.at(-1)!, first = flagged[0];
    incidents.push({ id: crypto.randomUUID(), siteId: site.id, assetId: site.assetId,
      title: last.analysis.drivers[0] || 'Unusual water-system telemetry',
      severity: flagged.some(row => row.analysis.severity === 'critical') ? 'critical' : 'warning', status: 'open',
      createdAt: first.reading.timestamp, updatedAt: last.reading.timestamp, note: '' });
  }
  return incidents;
}
function seed(): Workspace {
  const readings = demoReadings();
  return { readings, incidents: incidentsFor(readings), source: 'synthetic' };
}
async function identity(request: Request): Promise<{id:string;cookie?:string}> {
  const user = request.headers.get('oai-authenticated-user-id');
  if (user) return { id: 'user-' + await sha256(user) };
  const candidate = request.headers.get('cookie')?.match(/(?:^|;\s*)aquapulse_workspace=([a-f0-9-]{36})(?:;|$)/)?.[1];
  const valid = candidate && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(candidate);
  const id = valid ? candidate : crypto.randomUUID();
  return { id, cookie: valid ? undefined : `aquapulse_workspace=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}` };
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new HttpError(415, 'Send application/json.');
  if (Number(request.headers.get('content-length') || 0) > 2_000_000) throw new HttpError(413, 'Upload must be under 2 MB.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'A JSON body is required.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2_000_000) { await reader.cancel(); throw new HttpError(413, 'Upload must be under 2 MB.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let data: unknown;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400, 'Invalid JSON.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Send a JSON object.');
  return data as Record<string, unknown>;
}
function filtered(readings: Reading[], siteId: string, hours: number): Reading[] {
  const selected = readings.filter(reading => siteId === 'all' || reading.siteId === siteId);
  const last = Math.max(...selected.map(reading => Date.parse(reading.timestamp)));
  return selected.filter(reading => Date.parse(reading.timestamp) > last - hours * 3_600_000);
}
function csv(readings: Reading[]): string {
  const columns: (keyof Reading)[] = ['timestamp', 'siteId', 'assetId', 'flowM3h', 'conductivityUsCm', 'temperatureC', 'ph', 'productionIndex'];
  return [columns.join(','), ...readings.map(reading => columns.map(column => reading[column]).join(','))].join('\n') + '\n';
}
async function receiptFor(request: Request, data: Record<string, unknown>, required: boolean): Promise<Omit<Receipt, 'response'> | undefined> {
  const key = request.headers.get('Idempotency-Key');
  if (!key) { if (required) throw new HttpError(400, 'An Idempotency-Key is required for replay commits.'); return undefined; }
  if (!/^[A-Za-z0-9:_-]{8,100}$/.test(key)) throw new HttpError(400, 'Idempotency-Key must contain 8–100 letters, numbers, colons, underscores, or hyphens.');
  return { key, requestHash: await sha256(new URL(request.url).pathname + '\n' + canonicalJson(data)) };
}
async function handle(request: Request, env: Env): Promise<Response> {
  let cookie: string | undefined;
  const respond = (data: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(data, {
    status, headers: { 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}), ...extra },
  });
  try {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    if (method === 'GET' && path === '/api/openapi.json') return respond(openApi);
    if (method === 'GET' && path === '/api/health') {
      if (!env.DB) return respond({ ok: false, database: 'binding_unavailable' }, 503);
      try {
        await env.DB.batch(['SELECT id FROM workspaces LIMIT 1', 'SELECT sequence FROM audit_events LIMIT 1', 'SELECT key FROM request_receipts LIMIT 1']
          .map(query => env.DB.prepare(query)));
        return respond({ ok: true, service: 'aquapulse', version: '2.0.0', modelVersion: '1.0.0', database: 'ready' });
      } catch { return respond({ ok: false, database: 'schema_unavailable' }, 503); }
    }
    if (!env.DB) throw new HttpError(503, 'Database binding is unavailable.');
    if (!['GET', 'POST'].includes(method)) throw new HttpError(405, 'Method not allowed.');
    if (method === 'POST') {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) throw new HttpError(403, 'Cross-origin write requests are not allowed.');
      if (request.headers.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'Cross-site write requests are not allowed.');
    }
    const session = await identity(request);
    cookie = session.cookie;
    if (method === 'GET' && path === '/api/model') return respond(modelInfo);
    const { state, revision } = await loadWorkspace(env.DB, session.id, seed);
    if (method === 'GET' && path === '/api/assurance') {
      const scope = queryScope(url);
      const datasetClock = state.readings.at(-1)?.timestamp;
      return respond(inspectTelemetry(state.readings, { ...scope, datasetClock }));
    }
    if (method === 'POST' && path === '/api/planner') return respond(planRecovery(state.readings, await body(request) as unknown as PlanInput));
    if (method === 'GET' && path === '/api/audit') {
      const snapshot = await readAuditSnapshot(env.DB, session.id);
      const events = snapshot.events;
      const integrity = await verifyAudit(events, snapshot.head, snapshot.count);
      return respond({ events, integrity, legacyNote: 'Only actions after the operations upgrade are recorded. The chain is checked against the workspace head, not an external trust anchor.' });
    }
    if (method === 'GET' && path === '/api/replay') {
      const { siteId } = queryScope(url), scenario = url.searchParams.get('scenario') || 'healthy';
      const steps = Number(url.searchParams.get('steps') || 24);
      return replayStream(makeReplay(state.readings, siteId, scenario, steps), scenario, request.signal, cookie);
    }
    if (method === 'GET' && (path === '/api/dashboard' || path === '/api/export')) {
      const { siteId, hours } = queryScope(url), readings = filtered(state.readings, siteId, hours);
      if (path === '/api/export') return new Response(csv(readings), { headers: {
        'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="aquapulse-telemetry.csv"',
        'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}),
      } });
      const analyzed = readings.map(reading => ({ ...reading, analysis: analyzeReading(reading) }));
      const incidents = state.incidents.filter(incident => siteId === 'all' || incident.siteId === siteId);
      const forecasts = SITES.filter(site => siteId === 'all' || site.id === siteId).flatMap(site =>
        forecast(state.readings.filter(reading => reading.siteId === site.id), 24).map(point => ({ ...point, siteId: site.id })));
      const total = readings.reduce((sum, row) => sum + row.flowM3h, 0);
      const expected = analyzed.reduce((sum, row) => sum + row.analysis.expectedFlowM3h, 0);
      const excess = analyzed.reduce((sum, row) => sum + row.analysis.excessFlowM3h, 0);
      return respond({ sites: SITES, readings: analyzed, incidents, model: modelInfo,
        dataset: { source: state.source, label: state.source === 'synthetic' ? 'Synthetic replay · hourly samples' : state.source === 'replay' ? 'Synthetic fault replay · hourly samples' : 'Uploaded hourly telemetry', lastTimestamp: readings.at(-1)?.timestamp || '', count: state.readings.length },
        summary: { totalWaterM3: round(total), expectedWaterM3: round(expected), excessWaterM3: round(excess),
          activeAlerts: incidents.filter(incident => incident.status !== 'resolved').length,
          healthPercent: analyzed.length ? round(100 * analyzed.filter(row => !row.analysis.isAnomaly).length / analyzed.length) : 100,
          waterCostInr: round(total * 65) }, forecasts });
    }
    if (method === 'POST' && (path === '/api/ingest' || path === '/api/replay/commit')) {
      const data = await body(request), replay = path === '/api/replay/commit';
      const receipt = await receiptFor(request, data, replay);
      if (receipt) {
        const cached = await readReceipt(env.DB, session.id, receipt.key, receipt.requestHash);
        if (cached !== undefined) return respond(cached, 200, { 'Idempotency-Replayed': 'true' });
      }
      const readings = validateReadings(data.readings);
      if (replay && !SCENARIOS.includes(data.scenario as typeof SCENARIOS[number])) throw new HttpError(400, 'Choose healthy, leak, or sensor_drift.');
      const response = { accepted: readings.length };
      const next: Workspace = { ...state, readings, incidents: incidentsFor(readings), source: replay ? 'replay' : 'uploaded' };
      try {
        await commitWorkspace(env.DB, session.id, next, revision, {
          type: replay ? 'replay.committed' : 'telemetry.imported', entityId: 'dataset',
          note: replay ? `Applied the synthetic ${data.scenario} scenario` : 'Replaced the workspace telemetry dataset',
          metadata: { accepted: readings.length, source: next.source, ...(replay ? { scenario: data.scenario } : {}) },
        }, receipt ? { ...receipt, response } : undefined);
      } catch (error) {
        // Concurrent retries may reach the CAS guard before seeing the first request's receipt.
        if (error instanceof HttpError && error.status === 409 && receipt) {
          const cached = await readReceipt(env.DB, session.id, receipt.key, receipt.requestHash);
          if (cached !== undefined) return respond(cached, 200, { 'Idempotency-Replayed': 'true' });
        }
        throw error;
      }
      return respond(response);
    }
    if (method === 'POST' && path === '/api/reset') {
      await body(request);
      await commitWorkspace(env.DB, session.id, { ...state, ...seed() }, revision, {
        type: 'workspace.reset', entityId: 'dataset', note: 'Restored the original synthetic dataset', metadata: { accepted: 504 },
      });
      return respond({ ok: true });
    }
    if (method === 'POST' && /^\/api\/incidents\/[^/]+$/.test(path)) {
      const data = await body(request);
      let id: string;
      try { id = decodeURIComponent(path.split('/').at(-1)!); } catch { throw new HttpError(400, 'Invalid incident identifier.'); }
      const incident = state.incidents.find(item => item.id === id);
      if (!incident) throw new HttpError(404, 'Incident not found.');
      if (!['acknowledged', 'resolved'].includes(data.status as string)) throw new HttpError(400, 'status must be acknowledged or resolved.');
      if (incident.status === 'resolved') throw new HttpError(409, 'Resolved incidents cannot be changed.');
      if (typeof data.note !== 'string' || data.note.trim().length < 3 || data.note.length > 1000) throw new HttpError(400, 'Add an operator note between 3 and 1,000 characters.');
      const previousStatus = incident.status;
      incident.status = data.status as Incident['status']; incident.note = data.note.trim(); incident.updatedAt = new Date().toISOString();
      await commitWorkspace(env.DB, session.id, state, revision, { type: 'incident.' + incident.status,
        entityId: incident.id, note: incident.note, metadata: { siteId: incident.siteId, previousStatus, status: incident.status } });
      return respond(incident);
    }
    throw new HttpError(404, 'API endpoint not found.');
  } catch (error) {
    if (!(error instanceof HttpError)) console.error(JSON.stringify({ event: 'api.error', message: error instanceof Error ? error.message : 'Unknown failure' }));
    return respond({ error: error instanceof HttpError ? error.message : 'Unable to process this request. Please retry.' }, error instanceof HttpError ? error.status : 500);
  }
}
/** W3C trace context and request timing without logging telemetry, notes, or identities. */
export async function api(request: Request, env: Env): Promise<Response> {
  const started = performance.now(), requestId = crypto.randomUUID();
  const parent = request.headers.get('traceparent')?.match(/^00-([a-f0-9]{32})-([a-f0-9]{16})-0[01]$/);
  const traceId = parent && parent[1] !== '0'.repeat(32) && parent[2] !== '0'.repeat(16) ? parent[1] : crypto.randomUUID().replaceAll('-', '');
  const spanId = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
  const response = await handle(request, env);
  const duration = performance.now() - started, headers = new Headers(response.headers);
  headers.set('X-Request-Id', requestId); headers.set('traceparent', `00-${traceId}-${spanId}-01`);
  headers.set('Server-Timing', `app;dur=${duration.toFixed(2)}`);
  console.info(JSON.stringify({ event: 'http.request', requestId, traceId, method: request.method,
    path: new URL(request.url).pathname, status: response.status, durationMs: Math.round(duration * 100) / 100 }));
  return new Response(response.body, { status: response.status, headers });
}
