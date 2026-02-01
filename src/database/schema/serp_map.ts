import { pgTable, serial, integer } from 'drizzle-orm/pg-core';
import { perm } from './perm';
import { ser } from './ser';

export const serpMap = pgTable('serp_map', {
  serpKey: serial('serp_key').primaryKey().notNull(),
  permKey: integer('perm_key').references(() => perm.permKey, { onDelete: 'cascade' }),
  serKey: integer('ser_key').references(() => ser.serKey, { onDelete: 'cascade' }),
});

/** 테이블 코멘트 (동기화·DB COMMENT ON TABLE 에 사용) */
export const serpMapTableComment = '서비스 접근권한';

/** 필드별 코멘트. 키 = DB 컬럼명 */
export const serpMapColumnComments: Record<string, string> = {
  serp_key: '서비스 접근권한 키',
  perm_key: '권한 키',
  ser_key: '서비스 키',
};

export type SerpMap = typeof serpMap.$inferSelect;
export type NewSerpMap = typeof serpMap.$inferInsert;
