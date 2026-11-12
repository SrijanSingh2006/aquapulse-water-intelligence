import type { Incident, Reading } from './types';
import { HttpError } from './validation';
import { createAuditEvent, GENESIS_HASH, type AuditEvent } from './audit';
export interface Workspace {
  readings: Reading[]; incidents: Incident[]; source: 'synthetic' | 'uploaded' | 'replay';
  auditHead?: string; auditSequence?: number;
}
export interface Receipt { key: string; requestHash: string; response: unknown }
interface Stored { payload: string; revision: number }
export async function loadWorkspace(db: D1Database, id: string, seed: () => Workspace): Promise<{state:Workspace;revision:number}> {
  let row = await db.prepare('SELECT payload, revision FROM workspaces WHERE id = ?').bind(id).first<Stored>();
  if (!row) {
    await db.prepare('INSERT OR IGNORE INTO workspaces (id,payload,revision,updated_at) VALUES (?,?,0,?)')
      .bind(id, JSON.stringify(seed()), new Date().toISOString()).run();
    row = await db.prepare('SELECT payload, revision FROM workspaces WHERE id = ?').bind(id).first<Stored>();
  }
  if (!row) throw new HttpError(503, 'Workspace could not be initialized.');
  return { state: JSON.parse(row.payload) as Workspace, revision: row.revision };
}
export async function readReceipt(db: D1Database, workspaceId: string, key: string, requestHash: string): Promise<unknown | undefined> {
  const existing = await db.prepare('SELECT request_hash, response_json FROM request_receipts WHERE workspace_id = ? AND key = ?')
    .bind(workspaceId, key).first<{request_hash:string;response_json:string}>();
  if (!existing) return undefined;
  if (existing.request_hash !== requestHash) throw new HttpError(409, 'This Idempotency-Key was already used for a different request.');
  return JSON.parse(existing.response_json);
}
/** One D1 transaction commits snapshot, audit event, and optional request receipt. */
export async function commitWorkspace(
  db: D1Database, id: string, state: Workspace, revision: number,
  action: {type:string;entityId:string;note:string;metadata:Record<string,unknown>}, receipt?: Receipt,
): Promise<void> {
  const sequence = (state.auditSequence ?? 0) + 1;
  if (sequence > 1000) throw new HttpError(409, 'This demo workspace has reached its limit of 1,000 audited writes.');
  const event = await createAuditEvent({ ...action, sequence, previousHash: state.auditHead ?? GENESIS_HASH });
  const writeId = crypto.randomUUID();
  const next = { ...state, auditHead: event.hash, auditSequence: sequence };
  const statements = [
    db.prepare('UPDATE workspaces SET payload = ?, revision = revision + 1, updated_at = ?, last_write_id = ? WHERE id = ? AND revision = ?')
      .bind(JSON.stringify(next), event.at, writeId, id, revision),
    db.prepare('INSERT INTO audit_events (workspace_id, sequence, event_json) SELECT id, ?, ? FROM workspaces WHERE id = ? AND last_write_id = ?')
      .bind(sequence, JSON.stringify(event), id, writeId),
  ];
  if (receipt) statements.push(db.prepare('INSERT INTO request_receipts (workspace_id, key, request_hash, response_json, created_at) SELECT id, ?, ?, ?, ? FROM workspaces WHERE id = ? AND last_write_id = ?')
    .bind(receipt.key, receipt.requestHash, JSON.stringify(receipt.response), event.at, id, writeId));
  const result = await db.batch(statements);
  if (!result[0].meta.changes) throw new HttpError(409, 'Workspace changed in another tab. Refresh and try again.');
}
export async function readAuditSnapshot(db: D1Database, id: string): Promise<{events:AuditEvent[];head:string;count:number}> {
  // Read the events and expected head in one transaction to avoid false tamper alarms
  // when another tab commits between two independent SELECT statements.
  const result = await db.batch([
    db.prepare('SELECT payload FROM workspaces WHERE id = ?').bind(id),
    db.prepare('SELECT event_json FROM audit_events WHERE workspace_id = ? ORDER BY sequence LIMIT 1001').bind(id),
  ]);
  const row = result[0].results[0] as {payload:string} | undefined;
  if (!row) throw new HttpError(404, 'Workspace not found.');
  const state = JSON.parse(row.payload) as Workspace;
  return { events: result[1].results.map(row => JSON.parse((row as {event_json:string}).event_json) as AuditEvent),
    head: state.auditHead ?? GENESIS_HASH, count: state.auditSequence ?? 0 };
}
