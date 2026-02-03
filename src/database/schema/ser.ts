import { pgTable, varchar, boolean, integer } from 'drizzle-orm/pg-core';

export const ser = pgTable('ser', {
  serEng: varchar('ser_eng').primaryKey().notNull(),
  serKor: varchar('ser_kor'),
  serType: varchar('ser_type'),
  serMenu: varchar('ser_menu'),
  serCat: varchar('ser_cat'),
  serIdx: integer('ser_idx'),
  serWorkType: varchar('ser_work_type'),
  serIsPrivate: boolean('ser_is_private'),
  serHasContents: boolean('ser_has_contents').default(true),
  serHasFile: boolean('ser_has_file').default(true),
  serDataTable: varchar('ser_data_table'),
  serDataQuery: varchar('ser_data_query'),
  serUrl: varchar('ser_url'),
  serIsDel: boolean('ser_is_del'),
});

/** 테이블 코멘트 (동기화·DB COMMENT ON TABLE 에 사용) */
export const serTableComment = '서비스';

/** 필드별 코멘트. 키 = DB 컬럼명 */
export const serColumnComments: Record<string, string> = {
  ser_eng: '서비스 영문명',
  ser_kor: '서비스 한글명',
  ser_type: '서비스 유형',
  ser_menu: '메뉴',
  ser_cat: '카테고리',
  ser_idx: '순서',
  ser_work_type: '동작방식',
  ser_is_private: '비공개여부',
  ser_has_contents: '속성보기 여부',
  ser_has_file: '첨부파일 여부',
  ser_data_table: '데이터 테이블',
  ser_data_query: '데이터 쿼리',
  ser_url: 'URL',
  ser_is_del: '삭제여부',
};

export type Ser = typeof ser.$inferSelect;
export type NewSer = typeof ser.$inferInsert;
