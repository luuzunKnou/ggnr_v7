import { bigserial, pgSchema, text } from 'drizzle-orm/pg-core';

/** 소규모 공공시설 — 후보지평가 (선정 이상은 cons_code, 제외는 비울 수 있음) */
const layer = pgSchema('layer');

export const spfEval = layer.table('spf_eval', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  consCode: text('cons_code'),
  evalDate: text('eval_date'),
  evaluator: text('evaluator'),
  result: text('result'),
  remark: text('remark'),
});

export type SpfEval = typeof spfEval.$inferSelect;
export type NewSpfEval = typeof spfEval.$inferInsert;
