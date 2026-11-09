import { pgTable, serial, varchar, text, timestamp, index, jsonb } from 'drizzle-orm/pg-core';

/** 시설 이력 (재난대응·방사선대피소·물놀이표지 등) */
export const dataHistory = pgTable(
  'data_history',
  {
    historyKey: serial('history_key').primaryKey().notNull(),
    /** 시설물 종류 — 레이어(테이블)명 */
    hisGubun: varchar('his_gubun').notNull(),
    /** 관리번호 — 레이어 define PK 필드 값 */
    ftrIdn: varchar('ftr_idn').notNull(),
    hisContents: text('his_contents').notNull(),
    /** 업체 */
    agency: varchar('agency'),
    /** 확장 속성 (저수조 용량·재질 등) */
    hisExtra: jsonb('his_extra').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    createdBy: varchar('created_by').notNull(),
  },
  (t) => [index('data_history_gubun_ftr_idx').on(t.hisGubun, t.ftrIdn)]
);

export const dataHistoryTableComment = '시설 이력';

export const dataHistoryColumnComments: Record<string, string> = {
  history_key: '이력 키',
  his_gubun: '시설물 종류(레이어명)',
  ftr_idn: '관리번호(레이어 PK 값)',
  his_contents: '내용',
  agency: '업체',
  his_extra: '확장 속성(JSONB)',
  created_at: '작성일시',
  created_by: '작성자명',
};

export type DataHistory = typeof dataHistory.$inferSelect;
export type NewDataHistory = typeof dataHistory.$inferInsert;
