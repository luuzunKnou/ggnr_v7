import { pgTable, serial, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';

/** 재난대응시설 이력 */
export const safedataHistory = pgTable(
  'safedata_history',
  {
    historyKey: serial('history_key').primaryKey().notNull(),
    /** 시설물 종류 — 레이어(테이블)명 */
    hisGubun: varchar('his_gubun').notNull(),
    /** 관리번호 — 레이어 define PK 필드 값 */
    ftrIdn: varchar('ftr_idn').notNull(),
    hisContents: text('his_contents').notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    createdBy: varchar('created_by').notNull(),
  },
  (t) => [index('safedata_history_gubun_ftr_idx').on(t.hisGubun, t.ftrIdn)]
);

export const safedataHistoryTableComment = '재난대응시설 이력';

export const safedataHistoryColumnComments: Record<string, string> = {
  history_key: '이력 키',
  his_gubun: '시설물 종류(레이어명)',
  ftr_idn: '관리번호(레이어 PK 값)',
  his_contents: '내용',
  created_at: '작성일시',
  created_by: '작성자명',
};

export type SafedataHistory = typeof safedataHistory.$inferSelect;
export type NewSafedataHistory = typeof safedataHistory.$inferInsert;
