import { pgTable, serial, varchar, integer, timestamp, boolean, jsonb, index } from 'drizzle-orm/pg-core';
import { dh } from './layer_detail_history';

export const sl = pgTable('sync_log', {
  slKey: serial('sl_key').primaryKey().notNull(),
  slDhKey: integer('sl_dh_key').references(() => dh.dhKey),
  slTableName: varchar('sl_table_name').notNull(),
  slKeyField: varchar('sl_key_field').notNull(),
  slKeyValue: varchar('sl_key_value').notNull(),
  slOperation: varchar('sl_operation'),
  slOldData: jsonb('sl_old_data'),
  slNewData: jsonb('sl_new_data'),
  slAppliedAt: timestamp('sl_applied_at'),
  slRolledBack: boolean('sl_rolled_back').default(false),
  slRolledBackAt: timestamp('sl_rolled_back_at'),
  slCreatedAt: timestamp('sl_created_at').defaultNow(),
}, (t) => [
  index('sync_log_table_key_idx').on(t.slTableName, t.slKeyValue),
  index('sync_log_table_op_idx').on(t.slTableName, t.slOperation),
]);

export const slTableComment = '동기화 변경 로그';

export const slColumnComments: Record<string, string> = {
  sl_key: '동기화 로그 키',
  sl_dh_key: '상세이력 키',
  sl_table_name: '테이블명',
  sl_key_field: '키 필드명',
  sl_key_value: '키 값',
  sl_operation: '작업 결과 (NULL=미결, append/conflict/kept/remove)',
  sl_old_data: 'DB 데이터 (JSONB)',
  sl_new_data: 'SHP 데이터 (JSONB)',
  sl_applied_at: '반영 일시',
  sl_rolled_back: '롤백 여부',
  sl_rolled_back_at: '롤백 일시',
  sl_created_at: '생성 일시',
};

export type Sl = typeof sl.$inferSelect;
export type NewSl = typeof sl.$inferInsert;
