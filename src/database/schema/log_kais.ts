import { pgTable, serial, varchar, timestamp, text } from 'drizzle-orm/pg-core';

export const logKais = pgTable('log_kais', {
  logKaisKey: serial('log_kais_key').primaryKey(),
  logKaisCntcCd: varchar('log_kais_cntc_cd', { length: 20 }),
  logKaisName: varchar('log_kais_name', { length: 200 }).notNull(),
  logKaisDate: varchar('log_kais_date', { length: 8 }).notNull(),
  logKaisRequestDate: timestamp('log_kais_request_date', { withTimezone: false }).defaultNow().notNull(),
  logKaisResultCode: varchar('log_kais_result_code', { length: 50 }),
  logKaisResponseCode: varchar('log_kais_response_code', { length: 50 }),
  logKaisResponseMsg: text('log_kais_response_msg'),
  logKaisStatus: varchar('log_kais_status', { length: 200 }).notNull(),
});

