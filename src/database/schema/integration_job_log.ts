import { pgTable, serial, varchar, timestamp, text } from 'drizzle-orm/pg-core';

export const ijl = pgTable('integration_job_log', {
  ijlKey: serial('ijl_key').primaryKey().notNull(),
  ijlSystem: varchar('ijl_system', { length: 30 }).notNull(),
  ijlStartedAt: timestamp('ijl_started_at').defaultNow().notNull(),
  ijlFinishedAt: timestamp('ijl_finished_at'),
  ijlStatus: varchar('ijl_status', { length: 20 }).notNull(), // STARTED|SUCCESS|FAILED|NO_DATA|NOT_PROD
  ijlMessage: text('ijl_message'),
});

export type Ijl = typeof ijl.$inferSelect;
export type NewIjl = typeof ijl.$inferInsert;

