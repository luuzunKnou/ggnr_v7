import { bigserial, integer, pgSchema, unique } from 'drizzle-orm/pg-core';

/** 소규모 공공시설 — 정비계획 연도구간 */
const layer = pgSchema('layer');

export const spfPlan = layer.table(
  'spf_plan',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    startYear: integer('start_year').notNull(),
    endYear: integer('end_year').notNull(),
  },
  (t) => [unique('spf_plan_years_key').on(t.startYear, t.endYear)]
);

export type SpfPlan = typeof spfPlan.$inferSelect;
export type NewSpfPlan = typeof spfPlan.$inferInsert;
