import { pgTable, serial, integer, varchar } from 'drizzle-orm/pg-core';
import { ser } from './ser';

export const serd = pgTable('serd', {
  serdKey: serial('serd_key').primaryKey().notNull(),
  serEng: varchar('ser_eng').references(() => ser.serEng, { onDelete: 'cascade' }),
  serdJoinKey: varchar('serd_join_key'),
  serdType: varchar('serd_type'),
  serdKor: varchar('serd_kor'),
  serdUrl: varchar('serd_url'),
});

/** 테이블 코멘트 (동기화·DB COMMENT ON TABLE 에 사용) */
export const serdTableComment = '하위기능';

/** 필드별 코멘트. 키 = DB 컬럼명 */
export const serdColumnComments: Record<string, string> = {
  serd_key: '하위기능 키',
  ser_eng: '서비스 영문명',
  serd_join_key: 'Join 키',
  serd_type: '타입',
  serd_kor: '하위기능명',
  serd_url: 'URL',
};

export type Serd = typeof serd.$inferSelect;
export type NewSerd = typeof serd.$inferInsert;
