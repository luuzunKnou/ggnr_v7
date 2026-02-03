import { pgTable, serial, integer, varchar } from 'drizzle-orm/pg-core';
import { sys } from './sys';
import { ser } from './ser';

export const sysserMap = pgTable('sysser_map', {
  sysserKey: serial('sysser_key').primaryKey().notNull(),
  sysKey: integer('sys_key').references(() => sys.sysKey, { onDelete: 'cascade' }),
  serEng: varchar('ser_eng').references(() => ser.serEng, { onDelete: 'cascade' }),
});

/** 테이블 코멘트 (동기화·DB COMMENT ON TABLE 에 사용) */
export const sysserMapTableComment = '시스템별 서비스 목록';

/** 필드별 코멘트. 키 = DB 컬럼명 */
export const sysserMapColumnComments: Record<string, string> = {
  sysser_key: '시스템별 서비스 목록 키',
  sys_key: '시스템 키',
  ser_eng: '서비스 영문명',
};

export type SysserMap = typeof sysserMap.$inferSelect;
export type NewSysserMap = typeof sysserMap.$inferInsert;
