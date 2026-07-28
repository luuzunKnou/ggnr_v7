import { pgSchema, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

const nextGenLinkage = pgSchema('next_gen_linkage');

export const nglErrorLog = nextGenLinkage.table('ngl_error_log', {
  id: serial('id').primaryKey(),
  lvyNo: varchar('lvy_no', { length: 64 }),
  itmSn: varchar('itm_sn', { length: 16 }),
  interfaceId: varchar('interface_id', { length: 64 }),
  rprsTxmCd: varchar('rprs_txm_cd', { length: 64 }),
  rprsTxmNm: varchar('rprs_txm_nm', { length: 128 }),
  errorCode: varchar('error_code', { length: 64 }),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { mode: 'string' }),
});

export type NglErrorLog = typeof nglErrorLog.$inferSelect;
