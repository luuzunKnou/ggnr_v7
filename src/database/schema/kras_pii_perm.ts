import { pgTable, varchar, boolean, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * 사용자별 KRAS 개인정보 원문 열람 권한.
 * 행 없음 = 허용(기존 동작 유지). 회수 시 allowed=false 행을 둔다.
 */
export const kpp = pgTable(
  'kras_pii_perm',
  {
    kppUsrId: varchar('kpp_usr_id').primaryKey().notNull(),
    kppAllowed: boolean('kpp_allowed').notNull().default(true),
    kppAt: timestamp('kpp_at', { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    kppBy: varchar('kpp_by'),
  },
  (t) => [index('kpp_allowed_idx').on(t.kppAllowed)]
);

export const kppTableComment = 'KRAS 개인정보 원문 열람 권한';

export const kppColumnComments: Record<string, string> = {
  kpp_usr_id: '사용자 아이디',
  kpp_allowed: 'KRAS 개인정보 원문 열람 허용',
  kpp_at: '변경 시각',
  kpp_by: '작업자',
};

export type Kpp = typeof kpp.$inferSelect;
export type NewKpp = typeof kpp.$inferInsert;
