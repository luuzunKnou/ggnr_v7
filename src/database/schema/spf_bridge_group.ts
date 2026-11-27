import { bigserial, pgSchema, text, unique } from 'drizzle-orm/pg-core';

/**
 * 소규모 공공시설 — 소교량 리 묶음 매핑.
 * 정비계획은 위험 소교량을 리 단위로 묶어 1건으로 다룬다.
 * group_code(묶음 관리번호, 예: 고성리_소교량_통합)를 spf_plan_fac.cons_code 에 넣고,
 * 개별 소교량 관리번호(spf_bridge.cons_code)는 이 테이블로 연결한다.
 */
const layer = pgSchema('layer');

export const spfBridgeGroup = layer.table(
  'spf_bridge_group',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    groupCode: text('group_code').notNull(),
    ri: text('ri').notNull(),
    consCode: text('cons_code').notNull(),
  },
  (t) => [unique('spf_bridge_group_cons_key').on(t.consCode)]
);

export type SpfBridgeGroup = typeof spfBridgeGroup.$inferSelect;
export type NewSpfBridgeGroup = typeof spfBridgeGroup.$inferInsert;
