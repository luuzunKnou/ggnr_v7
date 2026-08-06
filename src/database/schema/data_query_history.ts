import { pgTable, serial, varchar, date, text, index } from 'drizzle-orm/pg-core';

/** 데이터 조회 상세 — 피처(행)별 점검·보수 등 이력 */
export const dqh = pgTable(
  'data_query_history',
  {
    dqhKey: serial('dqh_key').primaryKey().notNull(),
    dqhTable: varchar('dqh_table').notNull(),
    dqhRowKey: varchar('dqh_row_key').notNull(),
    dqhDate: date('dqh_date'),
    dqhType: varchar('dqh_type'),
    dqhTitle: varchar('dqh_title'),
    dqhContents: text('dqh_contents'),
    dqhAuthor: varchar('dqh_author'),
    dqhCreateUser: varchar('dqh_create_user'),
    dqhCreateDate: date('dqh_create_date'),
  },
  (t) => [
    index('data_query_history_table_row_idx').on(t.dqhTable, t.dqhRowKey),
  ]
);

export const dqhTableComment = '데이터조회 행 이력';

export const dqhColumnComments: Record<string, string> = {
  dqh_key: '이력 키',
  dqh_table: '물리 테이블명',
  dqh_row_key: '행 키',
  dqh_date: '이력 일자',
  dqh_type: '유형(점검·보수·이상발생·준공)',
  dqh_title: '제목',
  dqh_contents: '내용',
  dqh_author: '담당',
  dqh_create_user: '등록 사용자',
  dqh_create_date: '등록일',
};

export type Dqh = typeof dqh.$inferSelect;
export type NewDqh = typeof dqh.$inferInsert;
