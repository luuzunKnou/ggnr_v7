/**
 * rd_work_target_review — 대상여부 검토 (layer 스키마)
 * 기동 시 ensureLayerAppTables 가 없으면 생성한다.
 */
import { integer, jsonb, pgSchema, serial, varchar } from 'drizzle-orm/pg-core';

const layer = pgSchema('layer');

export const rdWorkTargetReview = layer.table('rd_work_target_review', {
  id: serial('id').primaryKey().notNull(),
  seqNo: integer('seq_no'),
  title: varchar('title'),
  criteria: varchar('criteria'),
  law: varchar('law'),
  timing: varchar('timing'),
  tgtContent: varchar('tgt_content'),
  implOrg: varchar('impl_org'),
  remark: varchar('remark'),
  formula: jsonb('formula').$type<Record<string, unknown> | null>(),
});

export const rdWorkTargetReviewTableComment = '대상여부 검토';

export const rdWorkTargetReviewColumnComments: Record<string, string> = {
  id: '키',
  seq_no: '번호',
  title: '제목',
  criteria: '기준',
  law: '법령',
  timing: '수행시기',
  tgt_content: '대상기준 내용',
  impl_org: '시행주체',
  remark: '비고',
  formula: '계산식',
};

export type RdWorkTargetReview = typeof rdWorkTargetReview.$inferSelect;
export type NewRdWorkTargetReview = typeof rdWorkTargetReview.$inferInsert;
