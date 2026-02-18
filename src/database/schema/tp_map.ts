import { pgTable, serial, varchar, integer } from 'drizzle-orm/pg-core';
import { ut } from './ut';
import { perm } from './perm';

export const tpMap = pgTable('tp_map', {
  tpKey: serial('tp_key').primaryKey().notNull(),
  utName: varchar('ut_name').references(() => ut.utName, { onDelete: 'cascade' }),
  permKey: integer('perm_key').references(() => perm.permKey, { onDelete: 'cascade' }),
});

/** 테이블 코멘트 (동기화·DB COMMENT ON TABLE 에 사용) */
export const tpMapTableComment = '팀 권한 설정';

/** 필드별 코멘트. 키 = DB 컬럼명 */
export const tpMapColumnComments: Record<string, string> = {
  tp_key: '팀 권한 설정 키',
  ut_name: '팀 한글명',
  perm_key: '권한 키',
};

export type TpMap = typeof tpMap.$inferSelect;
export type NewTpMap = typeof tpMap.$inferInsert;
