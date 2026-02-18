import { pgTable, serial, varchar, integer } from 'drizzle-orm/pg-core';
import { ug } from './ug';
import { perm } from './perm';

export const gpMap = pgTable('gp_map', {
  gpKey: serial('gp_key').primaryKey().notNull(),
  ugName: varchar('ug_name').references(() => ug.ugName, { onDelete: 'cascade' }),
  permKey: integer('perm_key').references(() => perm.permKey, { onDelete: 'cascade' }),
});

/** 테이블 코멘트 (동기화·DB COMMENT ON TABLE 에 사용) */
export const gpMapTableComment = '부서 권한 설정';

/** 필드별 코멘트. 키 = DB 컬럼명 */
export const gpMapColumnComments: Record<string, string> = {
  gp_key: '부서 권한 설정 키',
  ug_name: '부서 한글명',
  perm_key: '권한 키',
};

export type GpMap = typeof gpMap.$inferSelect;
export type NewGpMap = typeof gpMap.$inferInsert;
