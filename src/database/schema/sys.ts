import { pgTable, serial, varchar, integer } from 'drizzle-orm/pg-core';

export const sys = pgTable('sys', {
  sysKey: serial('sys_key').primaryKey().notNull(),
  sysKor: varchar('sys_kor'),
  sysEng: varchar('sys_eng'),
  sysImg: varchar('sys_img'),
  sysIdx: integer('sys_idx'),
  sysCol: varchar('sys_col'),
  sysLink: varchar('sys_link'),
  sysDetail: varchar('sys_detail'),
});

/** 테이블 코멘트 (동기화·DB COMMENT ON TABLE 에 사용) */
export const sysTableComment = '시스템';

/** 필드별 코멘트. 키 = DB 컬럼명 */
export const sysColumnComments: Record<string, string> = {
  sys_key: '시스템 키',
  sys_kor: '시스템 한글명',
  sys_eng: '시스템 영문명',
  sys_img: '시스템 이미지',
  sys_idx: '시스템 순서',
  sys_col: '시스템 색상',
  sys_link: '바로가기 주소',
  sys_detail: '시스템 상세',
};

export type Sys = typeof sys.$inferSelect;
export type NewSys = typeof sys.$inferInsert;
