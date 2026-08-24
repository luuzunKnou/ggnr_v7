import { integer, pgSchema, serial, text } from 'drizzle-orm/pg-core';

const fmsLinkage = pgSchema('fms_linkage');

export const fmsCode = fmsLinkage.table('fms_code', {
  codeKey: serial('code_key').primaryKey(),
  codeName: text('code_name'),
  codeKorName: text('code_kor_name'),
  code1: text('code1'),
  code2: text('code2'),
  code3: text('code3'),
  data1: text('data1'),
  data2: text('data2'),
  data3: text('data3'),
});

export type FmsCode = typeof fmsCode.$inferSelect;
