import { pgTable, serial, integer, varchar, uniqueIndex, smallint } from 'drizzle-orm/pg-core';
import { perm } from './perm';

/** 0=없음 1=버튼보기 2=읽기 3=쓰기 */
export const SERP_TYPE_NONE = 0;
export const SERP_TYPE_LIST = 1;
export const SERP_TYPE_READ = 2;
export const SERP_TYPE_WRITE = 3;

export const SERP_TYPE_LABELS: Record<number, string> = {
  0: '없음',
  1: '버튼보기',
  2: '읽기',
  3: '쓰기',
};

export const serpMap = pgTable(
  'serp_map',
  {
    serpKey: serial('serp_key').primaryKey().notNull(),
    permKey: integer('perm_key').references(() => perm.permKey, { onDelete: 'cascade' }),
    /** serviceList.config 의 ser_eng 와 맞출 수 있도록 ser 테이블 FK 없음 */
    serEng: varchar('ser_eng'),
    serpType: smallint('serp_type').notNull().default(SERP_TYPE_WRITE),
  },
  (t) => [uniqueIndex('serp_map_perm_ser_uq').on(t.permKey, t.serEng)]
);

/** 테이블 코멘트 (동기화·DB COMMENT ON TABLE 에 사용) */
export const serpMapTableComment = '서비스 접근권한';

/** 필드별 코멘트. 키 = DB 컬럼명 */
export const serpMapColumnComments: Record<string, string> = {
  serp_key: '서비스 접근권한 키',
  perm_key: '권한 키',
  ser_eng: '서비스 영문명',
  serp_type: '접근단계',
};

export type SerpMap = typeof serpMap.$inferSelect;
export type NewSerpMap = typeof serpMap.$inferInsert;
