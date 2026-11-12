import {sqliteTable,text,integer,index} from 'drizzle-orm/sqlite-core';
export const workspaces=sqliteTable('workspaces',{
 id:text('id').primaryKey().notNull(),
 payload:text('payload').notNull(),
 revision:integer('revision').notNull().default(0),
 updatedAt:text('updated_at').notNull(),
},table=>[index('workspaces_updated_at').on(table.updatedAt)]);
