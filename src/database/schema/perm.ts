import { pgTable, serial, varchar, boolean } from 'drizzle-orm/pg-core';

export const perm = pgTable('perm', {
  permKey: serial('perm_key').primaryKey().notNull(),
  permName: varchar('perm_name'),
  permIsHidden: boolean('perm_is_hidden'),
  permEtc: varchar('perm_etc'),
  permEtc2: varchar('perm_etc'),
});

/** 테이블 코멘트 (동기화·DB COMMENT ON TABLE 에 사용) */
export const permTableComment = '권한';

/** 필드별 코멘트. 키 = DB 컬럼명 (동기화·COMMENT ON COLUMN 에 사용) */
export const permColumnComments: Record<string, string> = {
  perm_key: '권한 키',
  perm_name: '권한명',
  perm_is_hidden: '숨김여부',
  perm_etc: '비고',
  perm_etc2: '비고2',
};

export type Perm = typeof perm.$inferSelect;
export type NewPerm = typeof perm.$inferInsert;
