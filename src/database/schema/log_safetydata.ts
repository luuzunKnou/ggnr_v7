import { pgTable, serial, varchar, timestamp, text } from 'drizzle-orm/pg-core';

export const logSafetydata = pgTable('log_safetydata', {
  logSafetydataKey: serial('log_safetydata_key').primaryKey(),
  logSafetydataDatasetId: varchar('log_safetydata_dataset_id', { length: 80 }).notNull(),
  logSafetydataName: varchar('log_safetydata_name', { length: 500 }).notNull(),
  logSafetydataDate: varchar('log_safetydata_date', { length: 8 }).notNull(),
  logSafetydataRequestDate: timestamp('log_safetydata_request_date', { withTimezone: false })
    .defaultNow()
    .notNull(),
  logSafetydataResultCode: varchar('log_safetydata_result_code', { length: 50 }),
  logSafetydataResponseCode: varchar('log_safetydata_response_code', { length: 50 }),
  logSafetydataResponseMsg: text('log_safetydata_response_msg'),
  logSafetydataStatus: varchar('log_safetydata_status', { length: 500 }).notNull(),
});
