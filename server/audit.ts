export const GENESIS_HASH = '0'.repeat(64);
export interface AuditEvent {
  schemaVersion: 1; id: string; sequence: number; at: string; type: string; entityId: string;
  note: string; metadata: Record<string, unknown>; previousHash: string; hash: string;
}
export interface AuditIntegrity { valid: boolean; checkedEvents: number; headHash: string; message: string }
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => JSON.stringify(key) + ':' + canonicalJson(item)).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}
export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function createAuditEvent(input: Omit<AuditEvent, 'id' | 'at' | 'hash' | 'schemaVersion'>): Promise<AuditEvent> {
  const event = { ...input, schemaVersion: 1 as const, id: crypto.randomUUID(), at: new Date().toISOString() };
  return { ...event, hash: await sha256(canonicalJson(event)) };
}
export async function verifyAudit(events: AuditEvent[], expectedHead: string, expectedCount: number): Promise<AuditIntegrity> {
  let previous = GENESIS_HASH;
  for (let i = 0; i < events.length; i++) {
    const { hash, ...event } = events[i];
    if (event.schemaVersion !== 1 || event.sequence !== i + 1 || event.previousHash !== previous || hash !== await sha256(canonicalJson(event))) {
      return { valid: false, checkedEvents: i, headHash: previous, message: 'An event was modified, removed, or reordered.' };
    }
    previous = hash;
  }
  const valid = events.length === expectedCount && previous === expectedHead;
  return { valid, checkedEvents: events.length, headHash: previous,
    message: valid ? 'Every recorded event matches the chain and the workspace head.' : 'The event history does not match the workspace head.' };
}
