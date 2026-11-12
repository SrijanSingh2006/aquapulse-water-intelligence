import {sqliteTable,text,integer,index,primaryKey} from 'drizzle-orm/sqlite-core';
export const workspaces=sqliteTable('workspaces',{
 id:text('id').primaryKey().notNull(),
 payload:text('payload').notNull(),
 revision:integer('revision').notNull().default(0),
 updatedAt:text('updated_at').notNull(),
 lastWriteId:text('last_write_id').notNull().default(''),
},table=>[index('workspaces_updated_at').on(table.updatedAt)]);

export const auditEvents=sqliteTable('audit_events',{
 workspaceId:text('workspace_id').notNull(),
 sequence:integer('sequence').notNull(),
 eventJson:text('event_json').notNull(),
},table=>[primaryKey({columns:[table.workspaceId,table.sequence]})]);
export const requestReceipts=sqliteTable('request_receipts',{
 workspaceId:text('workspace_id').notNull(),
 key:text('key').notNull(),
 requestHash:text('request_hash').notNull(),
 responseJson:text('response_json').notNull(),
 createdAt:text('created_at').notNull(),
},table=>[primaryKey({columns:[table.workspaceId,table.key]})]);
