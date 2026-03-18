import { pgTable, serial, varchar, integer, timestamp, boolean, jsonb } from 'drizzle-orm/pg-core';
import { eh } from './excel_upload_history';

export const esl = pgTable('excel_sync_log', {
  eslKey: serial('esl_key').primaryKey().notNull(),
  eslEhKey: integer('esl_eh_key').references(() => eh.ehKey),
  eslTableName: varchar('esl_table_name').notNull(),
  eslKeyField: varchar('esl_key_field').notNull(),
  eslKeyValue: varchar('esl_key_value').notNull(),
  eslOperation: varchar('esl_operation'),
  eslOldData: jsonb('esl_old_data'),
  eslNewData: jsonb('esl_new_data'),
  eslAppliedAt: timestamp('esl_applied_at'),
  eslRolledBack: boolean('esl_rolled_back').default(false),
  eslRolledBackAt: timestamp('esl_rolled_back_at'),
  eslCreatedAt: timestamp('esl_created_at').defaultNow(),
});

export const eslTableComment = 'Excel 동기화 변경 로그';

export const eslColumnComments: Record<string, string> = {
  esl_key: '로그 키',
  esl_eh_key: 'Excel 이력 키',
  esl_table_name: '테이블명',
  esl_key_field: '키 필드명',
  esl_key_value: '키 값',
  esl_operation: '작업 결과 (NULL=미결, append/conflict/kept/remove 등)',
  esl_old_data: 'DB 기존 데이터',
  esl_new_data: 'Excel/신규 데이터',
  esl_applied_at: '반영 일시',
  esl_rolled_back: '롤백 여부',
  esl_rolled_back_at: '롤백 일시',
  esl_created_at: '생성 일시',
};

export type Esl = typeof esl.$inferSelect;
export type NewEsl = typeof esl.$inferInsert;
