import { pgSchema, serial, varchar } from 'drizzle-orm/pg-core';

const nextGenLinkage = pgSchema('next_gen_linkage');

export const nglQueryTable = nextGenLinkage.table('ngl_query_table', {
  nglKey: serial('ngl_key').primaryKey(),
  interfaceId: varchar('interface_id', { length: 10 }).notNull(),
  interfaceNm: varchar('interface_nm', { length: 200 }),
  rprsTxmCd: varchar('rprs_txm_cd', { length: 6 }).notNull(),
  rprsTxmNm: varchar('rprs_txm_nm', { length: 100 }),
  spacBizCd: varchar('spac_biz_cd', { length: 4 }),
  actSeCd: varchar('act_se_cd', { length: 2 }).notNull(),
  isActive: varchar('is_active', { length: 1 }).default('Y'),
  ifId: varchar('if_id', { length: 50 }),
  dptCd: varchar('dpt_cd', { length: 7 }),
});

export type NglQueryTable = typeof nglQueryTable.$inferSelect;
