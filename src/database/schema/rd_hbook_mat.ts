/**
 * rd_hbook_mat — 설계실무요령 자료 (layer 스키마)
 * 기동 시 ensureLayerAppTables 가 없으면 생성한다.
 */
import { integer, pgSchema, serial, varchar } from 'drizzle-orm/pg-core';

const layer = pgSchema('layer');

export const rdHbookMat = layer.table('rd_hbook_mat', {
  id: serial('id').primaryKey().notNull(),
  seqNo: integer('seq_no'),
  category: varchar('category'),
  title: varchar('title'),
  remark: varchar('remark'),
  matUrl: varchar('mat_url'),
  xmlUrl: varchar('xml_url'),
  origUrl: varchar('orig_url'),
});

export const rdHbookMatTableComment = '설계실무요령 자료';

export const rdHbookMatColumnComments: Record<string, string> = {
  id: '키',
  seq_no: '번호',
  category: '분류',
  title: '제목',
  remark: '비고',
  mat_url: '자료 링크',
  xml_url: '자료 xml',
  orig_url: '원문',
};

export type RdHbookMat = typeof rdHbookMat.$inferSelect;
export type NewRdHbookMat = typeof rdHbookMat.$inferInsert;
