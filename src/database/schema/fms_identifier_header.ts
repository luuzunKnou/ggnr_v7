import { integer, pgSchema, text } from 'drizzle-orm/pg-core';

const fmsLinkage = pgSchema('fms_linkage');

export const fmsIdentifierHeader = fmsLinkage.table('fms_identifier_header', {
  identifier: text('identifier'),
  colOrder: integer('col_order'),
  colName: text('col_name'),
  colNameKor: text('col_name_kor'),
  refName: text('ref_name'),
  codeDept: text('code_dept'),
});

export type FmsIdentifierHeader = typeof fmsIdentifierHeader.$inferSelect;
