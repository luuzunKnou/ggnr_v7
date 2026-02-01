import { pgTable, serial, integer } from 'drizzle-orm/pg-core';
import { usr } from './usr';
import { perm } from './perm';

export const upMap = pgTable('up_map', {
  upKey: serial('up_key').primaryKey().notNull(),
  usrKey: integer('usr_key').references(() => usr.usrKey, { onDelete: 'cascade' }),
  permKey: integer('perm_key').references(() => perm.permKey, { onDelete: 'cascade' }),
});

/** 테이블 코멘트 (동기화·DB COMMENT ON TABLE 에 사용) */
export const upMapTableComment = '사용자 권한 설정';

/** 필드별 코멘트. 키 = DB 컬럼명 */
export const upMapColumnComments: Record<string, string> = {
  up_key: '사용자 권한 설정 키',
  usr_key: '사용자 키',
  perm_key: '권한 키',
};

export type UpMap = typeof upMap.$inferSelect;
export type NewUpMap = typeof upMap.$inferInsert;
