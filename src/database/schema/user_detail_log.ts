import { pgTable, serial, varchar, text, integer, index } from 'drizzle-orm/pg-core';
import { userLog } from './user_log';

/** 사용자·권한 이력 상세 (v6 user_detail_log) — 권한 변경 등 */
export const userDetailLog = pgTable(
  'user_detail_log',
  {
    udKey: serial('ud_key').primaryKey().notNull(),
    udUlKey: integer('ud_ul_key')
      .notNull()
      .references(() => userLog.ulKey, { onDelete: 'cascade' }),
    udItem: varchar('ud_item'),
    udBefore: text('ud_before'),
    udAfter: text('ud_after'),
    udColName: varchar('ud_col_name'),
  },
  (t) => [index('user_detail_log_ul_idx').on(t.udUlKey)]
);

export const userDetailLogTableComment = '사용자·권한 이력 상세';

export const userDetailLogColumnComments: Record<string, string> = {
  ud_key: '상세 키',
  ud_ul_key: '이력 키',
  ud_item: '항목명',
  ud_before: '변경 전',
  ud_after: '변경 후',
  ud_col_name: '컬럼명',
};

export type UserDetailLog = typeof userDetailLog.$inferSelect;
export type NewUserDetailLog = typeof userDetailLog.$inferInsert;
