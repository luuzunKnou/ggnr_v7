import { bigserial, integer, pgSchema, text, unique } from 'drizzle-orm/pg-core';

/**
 * 소규모 공공시설 — 점검결과.
 * 시설은 cons_code → 유형별 후보지 테이블.
 */
const layer = pgSchema('layer');

export const spfCheck = layer.table(
  'spf_check',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** 관리번호 */
    consCode: text('cons_code').notNull(),
    reportId: integer('report_id').notNull(),
    riskScore: integer('risk_score'),
    survDate: text('surv_date'),
    survName: text('surv_name'),
    riskRank: text('risk_rank'),
    candidate: text('candidate'),
    remark: text('remark'),
  },
  (t) => [unique('spf_check_report_cons_key').on(t.reportId, t.consCode)]
);

export type SpfCheck = typeof spfCheck.$inferSelect;
export type NewSpfCheck = typeof spfCheck.$inferInsert;
