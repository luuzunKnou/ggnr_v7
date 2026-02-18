import { pgTable, serial, varchar, timestamp, json } from 'drizzle-orm/pg-core';

export const comp = pgTable('comp', {
  compKey: serial('comp_key').primaryKey().notNull(),
  compDate: timestamp('comp_date', { mode: 'string' }),
  compCu: varchar('comp_cu'),
  compCt: varchar('comp_ct'),
  compCg: varchar('comp_cg'),
  compAdr: varchar('comp_adr'),
  compName: varchar('comp_name'),
  compTel: varchar('comp_tel'),
  compContent: varchar('comp_content'),
  compExtra: json('comp_extra').$type<Record<string, unknown>>(),
});

/** 테이블 코멘트 (동기화·DB COMMENT ON TABLE 에 사용) */
export const compTableComment = '민원 접수';

/** 필드별 코멘트. 키 = DB 컬럼명 */
export const compColumnComments: Record<string, string> = {
  comp_key: '접수번호',
  comp_date: '접수일자',
  comp_cu: '접수자',
  comp_ct: '접수팀',
  comp_cg: '접수부서',
  comp_adr: '주소',
  comp_name: '민원인',
  comp_tel: '연락처',
  comp_content: '민원내용',
  comp_extra: '확장컬럼',
};

export type Comp = typeof comp.$inferSelect;
export type NewComp = typeof comp.$inferInsert;
