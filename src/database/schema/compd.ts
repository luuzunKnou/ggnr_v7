import { pgTable, serial, integer, varchar, timestamp, json } from 'drizzle-orm/pg-core';
import { comp } from './comp';

export const compd = pgTable('compd', {
  compdKey: serial('compd_key').primaryKey().notNull(),
  compKey: integer('comp_key')
    .references(() => comp.compKey, { onDelete: 'cascade' })
    .notNull(),
  compdDate: timestamp('compd_date', { mode: 'string' }),
  compdCu: varchar('compd_cu'),
  compdCt: varchar('compd_ct'),
  compdCg: varchar('compd_cg'),
  compdState: varchar('compd_state'),
  compdContents: varchar('compd_contents'),
  compdExtra: json('compd_extra').$type<Record<string, unknown>>(),
});

/** 테이블 코멘트 (동기화·DB COMMENT ON TABLE 에 사용) */
export const compdTableComment = '민원 처리내역';

/** 필드별 코멘트. 키 = DB 컬럼명 */
export const compdColumnComments: Record<string, string> = {
  compd_key: '처리내역 번호',
  comp_key: '접수번호',
  compd_date: '처리일',
  compd_cu: '처리자',
  compd_ct: '처리팀',
  compd_cg: '처리부서',
  compd_state: '처리상태',
  compd_contents: '처리내용',
  compd_extra: '확장컬럼',
};

export type Compd = typeof compd.$inferSelect;
export type NewCompd = typeof compd.$inferInsert;
