import { bigserial, integer, pgSchema, text, unique } from 'drizzle-orm/pg-core';

/**
 * 소규모 공공시설 — 안전점검 보고서 점검 대상.
 * 보고서를 만들 때 정해진 대상 목록(관리번호)과, 그 시점의 직전 평가구분·점검일을 보관한다.
 * 점검 결과(spf_check)는 대상 중 점검을 마친 건만 들어간다.
 */
const layer = pgSchema('layer');

export const spfReportTarget = layer.table(
  'spf_report_target',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    reportId: integer('report_id').notNull(),
    /** 관리번호 */
    consCode: text('cons_code').notNull(),
    /** 기준일 이전 마지막 점검의 평가구분(없으면 시설 구분) */
    prevClass: text('prev_class'),
    /** 기준일 이전 마지막 점검일 */
    prevDate: text('prev_date'),
  },
  (t) => [unique('spf_report_target_key').on(t.reportId, t.consCode)]
);

export type SpfReportTarget = typeof spfReportTarget.$inferSelect;
export type NewSpfReportTarget = typeof spfReportTarget.$inferInsert;
