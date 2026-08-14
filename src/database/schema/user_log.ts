import { pgTable, serial, varchar, timestamp, text, index } from 'drizzle-orm/pg-core';

/**
 * 사용자·권한 관리 이력 (v6 user_log).
 * ul_cat: user=사용자관리 이력 · auth=권한 관리 이력
 */
export const userLog = pgTable(
  'user_log',
  {
    ulKey: serial('ul_key').primaryKey().notNull(),
    /** user | auth */
    ulCat: varchar('ul_cat').notNull(),
    ulContents: varchar('ul_contents'),
    ulDetail: text('ul_detail'),
    /** 추가 | 수정 | 삭제 | 변경 등 */
    ulType: varchar('ul_type'),
    /** 대상 사용자 아이디 */
    ulUser: varchar('ul_user'),
    /** 대상 부서(그룹)명 */
    ulGroup: varchar('ul_group'),
    /** 작업자 아이디 */
    ulWorkUser: varchar('ul_work_user'),
    /** auth 하위: system 등 */
    ulSubCat: varchar('ul_sub_cat'),
    ulDate: timestamp('ul_date', { mode: 'string' }).defaultNow(),
  },
  (t) => [
    index('user_log_cat_date_idx').on(t.ulCat, t.ulDate),
    index('user_log_user_idx').on(t.ulUser),
    index('user_log_work_user_idx').on(t.ulWorkUser),
  ]
);

export const userLogTableComment = '사용자·권한 관리 이력';

export const userLogColumnComments: Record<string, string> = {
  ul_key: '이력 키',
  ul_cat: '분류(user|auth)',
  ul_contents: '내용',
  ul_detail: '상세',
  ul_type: '작업 분류',
  ul_user: '대상 사용자',
  ul_group: '대상 부서',
  ul_work_user: '작업자',
  ul_sub_cat: '하위 분류',
  ul_date: '일시',
};

export type UserLog = typeof userLog.$inferSelect;
export type NewUserLog = typeof userLog.$inferInsert;
