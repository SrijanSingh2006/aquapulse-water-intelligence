import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
export function applyMigrations(database: DatabaseSync): void {
  for (const file of readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) database.exec(readFileSync('drizzle/' + file, 'utf8'));
}
export function sqliteAdapter(database: DatabaseSync): D1Database {
  function statement(query: string, values: unknown[] = []): unknown {
    const execute = () => {
      if (/^\s*SELECT\b/i.test(query)) return { success: true, results: database.prepare(query).all(...values as never[]), meta: { changes: 0 } };
      const result = database.prepare(query).run(...values as never[]);
      return { success: true, results: [], meta: { changes: Number(result.changes) } };
    };
    return { bind: (...next: unknown[]) => statement(query, next),
      first: async () => database.prepare(query).get(...values as never[]) || null,
      all: async () => ({ success: true, results: database.prepare(query).all(...values as never[]), meta: {} }),
      run: async () => execute(), __execute: execute };
  }
  return { prepare: (query: string) => statement(query), batch: async (statements: unknown[]) => {
    database.exec('BEGIN');
    try { const result = statements.map(item => (item as {__execute:()=>unknown}).__execute()); database.exec('COMMIT'); return result; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
}
