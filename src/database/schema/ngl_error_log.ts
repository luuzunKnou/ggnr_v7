import { pgSchema, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

const nextGenLinkage = pgSchema('next_gen_linkage');

export const nglErrorLog = nextGenLinkage.table('ngl_error_log', {
  id: serial('id').primaryKey(),
  lvyNo: varchar('lvy_no', { length: 6 }),
  itmSn: varchar('itm_sn', { length: 2 }),
  interfaceId: varchar('interface_id', { length: 100 }),
  rprsTxmCd: varchar('rprs_txm_cd', { length: 6 }),
  rprsTxmNm: varchar('rprs_txm_nm', { length: 100 }),
  errorCode: varchar('error_code', { length: 20 }),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
});

export type NglErrorLog = typeof nglErrorLog.$inferSelect;
