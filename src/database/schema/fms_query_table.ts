import { integer, pgSchema, text } from 'drizzle-orm/pg-core';

const fmsLinkage = pgSchema('fms_linkage');

export const fmsQueryTable = fmsLinkage.table('fms_query_table', {
  fqKey: integer('fq_key').primaryKey(),
  interfaceName: text('interface_name'),
  identifier: text('identifier'),
  isActive: text('is_active'),
});

export type FmsQueryTable = typeof fmsQueryTable.$inferSelect;
