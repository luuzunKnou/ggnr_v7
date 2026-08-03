import { pgTable, serial, varchar, integer, text, index } from 'drizzle-orm/pg-core';
import { dl } from './data_log';

/**
 * 통합 데이터 상세 로그 (v6 data_detail_log).
 * 필드별 변경 전·후 — 상세보기·되돌리기 근거.
 */
export const dd = pgTable(
  'data_detail_log',
  {
    ddKey: serial('dd_key').primaryKey().notNull(),
    ddDlKey: integer('dd_dl_key')
      .notNull()
      .references(() => dl.dlKey, { onDelete: 'cascade' }),
    /** 항목 표시명(한글 등) */
    ddItem: varchar('dd_item'),
    ddBefore: text('dd_before'),
    ddAfter: text('dd_after'),
    /** UPDATE 대상 DB 컬럼명 */
    ddColName: varchar('dd_col_name'),
    /** WHERE용 키 값 */
    ddKeyValue: varchar('dd_key_value'),
  },
  (t) => [index('data_detail_log_dl_idx').on(t.ddDlKey)]
);

export const ddTableComment = '통합 데이터 상세 로그';

export const ddColumnComments: Record<string, string> = {
  dd_key: '상세 로그 키',
  dd_dl_key: '데이터 로그 키',
  dd_item: '항목명',
  dd_before: '변경 전',
  dd_after: '변경 후',
  dd_col_name: '컬럼 영문명',
  dd_key_value: '키 값',
};

export type Dd = typeof dd.$inferSelect;
export type NewDd = typeof dd.$inferInsert;
