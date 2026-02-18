import { pgTable, varchar, boolean } from 'drizzle-orm/pg-core';
import { ug } from './ug';

export const ut = pgTable('ut', {
  utName: varchar('ut_name').primaryKey().notNull(),
  ugName: varchar('ug_name')
    .references(() => ug.ugName, { onDelete: 'cascade' })
    .notNull(),
  utIsDel: boolean('ut_is_del'),
  utIsHidden: boolean('ut_is_hidden'),
  utEtc: varchar('ut_etc'),
});

/** 테이블 코멘트 (동기화·DB COMMENT ON TABLE 에 사용) */
export const utTableComment = '팀';

/** 필드별 코멘트. 키 = DB 컬럼명 */
export const utColumnComments: Record<string, string> = {
  ut_name: '팀 한글명',
  ug_name: '부서 한글명',
  ut_is_del: '삭제여부',
  ut_is_hidden: '숨김여부',
  ut_etc: '비고',
};

export type Ut = typeof ut.$inferSelect;
export type NewUt = typeof ut.$inferInsert;
