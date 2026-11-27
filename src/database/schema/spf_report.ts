import { bigserial, integer, pgSchema, text, unique } from 'drizzle-orm/pg-core';

/** 소규모 공공시설 — 안전점검 보고서 */
const layer = pgSchema('layer');

export const spfReport = layer.table(
  'spf_report',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    year: integer('year').notNull(),
    writeDate: text('write_date'),
    title: text('title'),
    agency: text('agency'),
    author: text('author'),
    targetCount: integer('target_count'),
    /** 보고서 개요(본문) */
    summary: text('summary'),
  },
  (t) => [unique('spf_report_year_key').on(t.year)]
);

export type SpfReport = typeof spfReport.$inferSelect;
export type NewSpfReport = typeof spfReport.$inferInsert;
