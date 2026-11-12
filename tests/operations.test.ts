import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { api, type Env } from '../server/service';
import { demoReadings } from '../server/demo';
import { makeReplay } from '../server/replay';
import { commitWorkspace, type Workspace } from '../server/store';
import { applyMigrations, sqliteAdapter } from './db';
let sql: DatabaseSync, env: Env;
function request(path: string, data?: unknown, cookie?: string, headers: Record<string,string> = {}): Request {
  return new Request('https://aquapulse.test' + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { ...(cookie ? { cookie } : {}), ...(data === undefined ? {} : {'Content-Type':'application/json'}), ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
}
async function init(): Promise<string> {
  const response = await api(request('/api/dashboard'), env);
  expect(response.status).toBe(200);
  return response.headers.get('set-cookie')!.split(';')[0];
}
async function get(path: string, cookie: string): Promise<any> { return (await api(request(path, undefined, cookie), env)).json(); }
const validRows = () => demoReadings().filter(row => row.siteId === 'BLR-01').slice(-24);
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  sql = new DatabaseSync(':memory:'); applyMigrations(sql); env = { DB: sqliteAdapter(sql) };
});
afterEach(() => { sql.close(); vi.restoreAllMocks(); });
describe('Operations workflows with transactional SQLite', () => {
  it('preserves the data from v1 when the append-only migration is applied', async () => {
    const old = new DatabaseSync(':memory:');
    try {
      old.exec(readFileSync('drizzle/0000_workspaces.sql','utf8'));
      const id = crypto.randomUUID(), state = { readings: validRows(), incidents: [], source: 'uploaded' };
      old.prepare('INSERT INTO workspaces(id,payload,updated_at) VALUES (?,?,?)').run(id, JSON.stringify(state), new Date().toISOString());
      old.exec(readFileSync('drizzle/0001_audited_operations.sql','utf8'));
      const result = await api(request('/api/dashboard', undefined, 'aquapulse_workspace=' + id), { DB: sqliteAdapter(old) });
      expect((await result.json() as any).dataset).toMatchObject({ source:'uploaded', count:24 });
    } finally { old.close(); }
  });
  it('appends incident notes, preserves the chain across reset, and isolates workspaces', async () => {
    const cookie = await init(), other = await init();
    const incident = (await get('/api/dashboard', cookie)).incidents[0];
    expect((await api(request('/api/incidents/' + incident.id, {status:'acknowledged',note:'Investigating the seal'}, cookie),env)).status).toBe(200);
    expect((await api(request('/api/incidents/' + incident.id, {status:'resolved',note:'Seal inspected and adjusted'}, cookie),env)).status).toBe(200);
    expect((await api(request('/api/reset', {}, cookie),env)).status).toBe(200);
    const audit = await get('/api/audit',cookie);
    expect(audit.events.map((event:any)=>event.sequence)).toEqual([1,2,3]);
    expect(audit.events[0].note).toBe('Investigating the seal');
    expect(audit.events[1].note).toBe('Seal inspected and adjusted');
    expect(audit.events[2].type).toBe('workspace.reset');
    expect(audit.integrity).toMatchObject({valid:true,checkedEvents:3});
    expect((await get('/api/audit',other)).events).toHaveLength(0);
  });
  it('detects tampering rather than silently trusting stored event hashes', async () => {
    const cookie=await init();await api(request('/api/reset',{},cookie),env);
    const audit=await get('/api/audit',cookie),event={...audit.events[0],note:'modified after hashing'};
    sql.prepare('UPDATE audit_events SET event_json=?').run(JSON.stringify(event));
    expect((await get('/api/audit',cookie)).integrity.valid).toBe(false);
  });
  it('deduplicates identical uploads and rejects a changed payload using the same key', async () => {
    const cookie=await init(),data={readings:validRows()},headers={'Idempotency-Key':'upload-retry-001'};
    expect((await api(request('/api/ingest',data,cookie,headers),env)).status).toBe(200);
    const retry=await api(request('/api/ingest',data,cookie,headers),env);
    expect(retry.status).toBe(200);expect(retry.headers.get('Idempotency-Replayed')).toBe('true');
    expect((await get('/api/audit',cookie)).events).toHaveLength(1);
    const changed={readings:data.readings.map((row,i)=>i?row:{...row,flowM3h:row.flowM3h+1})};
    expect((await api(request('/api/ingest',changed,cookie,headers),env)).status).toBe(409);
    expect((await get('/api/audit',cookie)).events).toHaveLength(1);
  });
  it('makes concurrent retries create exactly one dataset write and one audit event', async () => {
    const cookie=await init(),data={readings:validRows()},headers={'Idempotency-Key':'parallel-retry-001'};
    const responses=await Promise.all([api(request('/api/ingest',data,cookie,headers),env),api(request('/api/ingest',data,cookie,headers),env)]);
    expect(responses.map(response=>response.status)).toEqual([200,200]);
    expect((await get('/api/audit',cookie)).events).toHaveLength(1);
    expect(sql.prepare('SELECT COUNT(*) AS n FROM request_receipts').get()!.n).toBe(1);
  });
  it('rolls back the snapshot and receipt if the audit insertion fails', async () => {
    const cookie=await init();
    sql.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
    const result=await api(request('/api/ingest',{readings:validRows()},cookie,{'Idempotency-Key':'rollback-retry-01'}),env);
    expect(result.status).toBe(500);
    expect((await get('/api/dashboard',cookie)).dataset.count).toBe(504);
    expect(sql.prepare('SELECT COUNT(*) AS n FROM request_receipts').get()!.n).toBe(0);
    expect((await get('/api/audit',cookie)).events).toHaveLength(0);
  });
  it('keeps failed optimistic writes from appending orphan events', async () => {
    const cookie=await init(),row=sql.prepare('SELECT id,payload,revision FROM workspaces').get()!;
    const state=JSON.parse(row.payload as string) as Workspace,action={type:'test',entityId:'test',note:'Concurrent change',metadata:{}};
    await commitWorkspace(env.DB,row.id as string,state,0,action);
    await expect(commitWorkspace(env.DB,row.id as string,state,0,action)).rejects.toMatchObject({status:409});
    expect((await get('/api/audit',cookie)).integrity).toMatchObject({valid:true,checkedEvents:1});
  });
  it('streams synthetic readings without changing stored data, then commits idempotently', async () => {
    const cookie=await init();
    const response=await api(request('/api/replay?siteId=BLR-01&scenario=leak&steps=3',undefined,cookie),env);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const text=await response.text(),chunks=text.split('\n\n').filter(Boolean);
    const frames=chunks.filter(chunk=>chunk.includes('event: reading')).map(chunk=>JSON.parse(chunk.split('data: ')[1]));
    expect(frames).toHaveLength(3);expect(text).toContain('event: complete');
    expect((await get('/api/dashboard',cookie)).dataset.count).toBe(504);
    const data={scenario:'leak',readings:frames.map(frame=>frame.reading)};
    expect((await api(request('/api/replay/commit',data,cookie),env)).status).toBe(400);
    const headers={'Idempotency-Key':'replay-save-001'};
    expect((await api(request('/api/replay/commit',data,cookie,headers),env)).status).toBe(200);
    expect((await api(request('/api/replay/commit',data,cookie,headers),env)).headers.get('Idempotency-Replayed')).toBe('true');
    expect((await get('/api/dashboard',cookie)).dataset).toMatchObject({source:'replay',count:3});
    expect((await get('/api/audit',cookie)).events).toHaveLength(1);
  });
  it('rejects malformed replay settings and supports receiver cancellation', async () => {
    const cookie=await init();
    for(const query of ['steps=100','scenario=unknown','siteId=unknown'])expect((await api(request('/api/replay?'+query,undefined,cookie),env)).status).toBe(400);
    const response=await api(request('/api/replay?siteId=BLR-01&steps=24',undefined,cookie),env),reader=response.body!.getReader();
    expect((await reader.read()).value!.length).toBeGreaterThan(0);await reader.cancel();
    expect((await get('/api/audit',cookie)).events).toHaveLength(0);
  });
  it('exposes actual model assurance and a resource-constrained planning result', async () => {
    const cookie=await init(),assurance=await get('/api/assurance?hours=168',cookie);
    expect(assurance.model.fingerprint).toMatch(/^[a-f0-9]{64}$/);expect(assurance.drift.features).toHaveLength(5);
    const plan=await api(request('/api/planner',{budgetInr:12000,crewHours:8,tariffInrM3:65,horizonDays:30},cookie),env);
    expect(plan.status).toBe(200);const result=await plan.json() as any;
    expect(result.summary.costInr).toBeLessThanOrEqual(12000);expect(result.summary.crewHours).toBeLessThanOrEqual(8);
    expect(result.algorithm.feasiblePlans).toBeGreaterThan(0);
  });
  it('returns a machine-readable API contract and trace context even for errors', async () => {
    const parent='00-1234567890abcdef1234567890abcdef-1234567890abcdef-01';
    const response=await api(request('/api/openapi.json',undefined,undefined,{traceparent:parent}),{} as Env);
    expect(response.headers.get('traceparent')).toMatch(/^00-1234567890abcdef1234567890abcdef-[a-f0-9]{16}-01$/);
    expect(response.headers.get('server-timing')).toMatch(/^app;dur=/);
    const spec=await response.json() as any;expect(spec.openapi).toBe('3.1.0');expect(spec.paths['/api/replay/commit']).toBeTruthy();
    const cookie=await init(),missing=await api(request('/api/no-such-route',undefined,cookie),env);
    expect(missing.status).toBe(404);expect(missing.headers.get('X-Request-Id')).toMatch(/^[a-f0-9-]{36}$/);
  });
  it('generates deterministic forward-only fault scenarios with valid hourly records', () => {
    const a=makeReplay(demoReadings(),'all','sensor_drift',24),b=makeReplay(demoReadings(),'all','sensor_drift',24);
    expect(a).toEqual(b);expect(a).toHaveLength(72);expect(a.at(-1)!.analysis.isAnomaly).toBe(true);
    expect(Date.parse(a[0].reading.timestamp)).toBeGreaterThan(Date.parse(demoReadings().at(-1)!.timestamp));
    const healthy=makeReplay(demoReadings(),'BLR-01','healthy',24);expect(healthy.filter(frame=>frame.analysis.isAnomaly)).toHaveLength(0);
  });
});
