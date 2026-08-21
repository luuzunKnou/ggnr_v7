import { integer, pgSchema, serial, text, timestamp } from 'drizzle-orm/pg-core';

const fmsLinkage = pgSchema('fms_linkage');

export const fmsErrorLog = fmsLinkage.table('fms_error_log', {
  id: serial('id').primaryKey(),
  identifier: text('identifier'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { mode: 'string' }),
});

export type FmsErrorLog = typeof fmsErrorLog.$inferSelect;
