/**
 * 학습된 연결·제수변 절단 거리 (layer 스키마)
 */
import { doublePrecision, integer, pgSchema, serial, text, timestamp } from 'drizzle-orm/pg-core';

const layer = pgSchema('layer');

export const wtlTraceCriterion = layer.table('wtl_trace_criterion', {
  criterionId: serial('criterion_id').primaryKey().notNull(),
  kind: text('kind').notNull(),
  thresholdM: doublePrecision('threshold_m'),
  sampleCount: integer('sample_count').notNull(),
  updateDate: timestamp('update_date', { withTimezone: true }),
});

export const wtlTraceCriterionTableComment = '상수도 탐색 학습 기준';

export const wtlTraceCriterionColumnComments: Record<string, string> = {
  criterion_id: '키',
  kind: '연결, 제수변절단',
  threshold_m: '학습된 거리(m)',
  sample_count: '반영 건수',
  update_date: '갱신 시각',
};
