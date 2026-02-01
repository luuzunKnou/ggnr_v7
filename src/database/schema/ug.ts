import { pgTable, serial, varchar, boolean } from 'drizzle-orm/pg-core';

export const ug = pgTable('ug', {
  ugKey: serial('ug_key').primaryKey().notNull(),
  ugName: varchar('ug_name'),
  ugIsDel: boolean('ug_is_del'),
  ugIsHidden: boolean('ug_is_hidden'),
  ugEtc: varchar('ug_etc'),
});

/** 테이블 코멘트 (동기화·DB COMMENT ON TABLE 에 사용) */
export const ugTableComment = '사용자그룹';

/** 필드별 코멘트. 키 = DB 컬럼명 */
export const ugColumnComments: Record<string, string> = {
  ug_key: '사용자 그룹 키',
  ug_name: '그룹명',
  ug_is_del: '삭제여부',
  ug_is_hidden: '숨김여부',
  ug_etc: '비고',
};

export type Ug = typeof ug.$inferSelect;
export type NewUg = typeof ug.$inferInsert;
