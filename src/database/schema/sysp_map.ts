import { pgTable, serial, integer, uniqueIndex, text } from 'drizzle-orm/pg-core';
import { perm } from './perm';

export const syspMap = pgTable(
  'sysp_map',
  {
    syspKey: serial('sysp_key').primaryKey().notNull(),
    permKey: integer('perm_key').references(() => perm.permKey, { onDelete: 'cascade' }),
    /** DB serial 또는 systemList.config 의 sys_key 문자열 */
    sysKey: text('sys_key'),
  },
  (t) => [uniqueIndex('sysp_map_perm_sys_uq').on(t.permKey, t.sysKey)]
);

/** 테이블 코멘트 (동기화·DB COMMENT ON TABLE 에 사용) */
export const syspMapTableComment = '시스템 접근권한';

/** 필드별 코멘트. 키 = DB 컬럼명 */
export const syspMapColumnComments: Record<string, string> = {
  sysp_key: '시스템 접근권한 키',
  perm_key: '권한 키',
  sys_key: '시스템 키',
};

export type SyspMap = typeof syspMap.$inferSelect;
export type NewSyspMap = typeof syspMap.$inferInsert;
