import { bigserial, doublePrecision, integer, pgSchema, text } from 'drizzle-orm/pg-core';

/**
 * 소규모 공공시설 — 정비계획 목록.
 * 시설명·위치는 cons_code → 유형별 후보지 조인.
 */
const layer = pgSchema('layer');

export const spfPlanFac = layer.table('spf_plan_fac', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  planId: integer('plan_id').notNull(),
  consCode: text('cons_code'),
  finalRank: integer('final_rank'),
  workloadM: doublePrecision('workload_m'),
  costMil: doublePrecision('cost_mil'),
  doneRate: doublePrecision('done_rate'),
  after5Qty: doublePrecision('after5_qty'),
  after5CostMil: doublePrecision('after5_cost_mil'),
  y1Qty: doublePrecision('y1_qty'),
  y1CostMil: doublePrecision('y1_cost_mil'),
  y2Qty: doublePrecision('y2_qty'),
  y2CostMil: doublePrecision('y2_cost_mil'),
  y3Qty: doublePrecision('y3_qty'),
  y3CostMil: doublePrecision('y3_cost_mil'),
  y4Qty: doublePrecision('y4_qty'),
  y4CostMil: doublePrecision('y4_cost_mil'),
  y5Qty: doublePrecision('y5_qty'),
  y5CostMil: doublePrecision('y5_cost_mil'),
  effectPeople: text('effect_people'),
  effectFarmHa: text('effect_farm_ha'),
  effectBuilding: text('effect_building'),
  status: text('status'),
});

export type SpfPlanFac = typeof spfPlanFac.$inferSelect;
export type NewSpfPlanFac = typeof spfPlanFac.$inferInsert;
