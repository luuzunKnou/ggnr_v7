import { pgTable, serial, varchar, integer, date } from 'drizzle-orm/pg-core';

export const lh = pgTable('layer_history', {
  lhKey: serial('lh_key').primaryKey().notNull(),
  lhContents: varchar('lh_contents'),
  lhSuccessCount: integer('lh_success_count'),
  lhFailCount: integer('lh_fail_count'),
  /** 작업자 표시 문자열 — `usrId(usrName)` 형식 */
  lhCreateUser: varchar('lh_create_user'),
  lhCreateDate: date('lh_create_date'),
});

/** 테이블 코멘트 (동기화·DB COMMENT ON TABLE 에 사용) */
export const lhTableComment = '레이어 이력';

/** 필드별 코멘트. 키 = DB 컬럼명 */
export const lhColumnComments: Record<string, string> = {
  lh_key: '레이어 이력 키',
  lh_contents: '내용',
  lh_success_count: '업로드 성공 레이어 수',
  lh_fail_count: '업로드 실패 레이어 수',
  lh_create_user: '작업자',
  lh_create_date: '작업일',
};

export type Lh = typeof lh.$inferSelect;
export type NewLh = typeof lh.$inferInsert;
