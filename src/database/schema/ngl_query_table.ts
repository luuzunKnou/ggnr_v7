import { integer, pgSchema, text } from 'drizzle-orm/pg-core';

const nextGenLinkage = pgSchema('next_gen_linkage');

export const nglQueryTable = nextGenLinkage.table('ngl_query_table', {
  nglKey: integer('ngl_key').primaryKey(),
  interfaceId: text('interface_id'),
  interfaceNm: text('interface_nm'),
  rprsTxmCd: text('rprs_txm_cd'),
  rprsTxmNm: text('rprs_txm_nm'),
  spacBizCd: text('spac_biz_cd'),
  actSeCd: text('act_se_cd'),
  isActive: text('is_active'),
  ifId: text('if_id'),
  dptCd: text('dpt_cd'),
});

export type NglQueryTable = typeof nglQueryTable.$inferSelect;
