import { pgTable, varchar } from 'drizzle-orm/pg-core';

/** V6 통합제어 — 항목명(sc_name)별 값(sc_value, 'true'/'false') */
export const systemControl = pgTable('system_control', {
  scName: varchar('sc_name').primaryKey().notNull(),
  scValue: varchar('sc_value'),
});

export const systemControlTableComment = '시스템 통합제어';

export const systemControlColumnComments: Record<string, string> = {
  sc_name: '항목명',
  sc_value: '값(true/false)',
};

export type SystemControl = typeof systemControl.$inferSelect;
export type NewSystemControl = typeof systemControl.$inferInsert;
