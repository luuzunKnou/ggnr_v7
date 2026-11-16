/**
 * 탐색 수정요청의 관로·제수변 (layer 스키마)
 */
import { doublePrecision, integer, pgSchema, serial, text } from 'drizzle-orm/pg-core';

const layer = pgSchema('layer');

export const wtlRequestItem = layer.table('wtl_request_item', {
  itemId: serial('item_id').primaryKey().notNull(),
  requestId: integer('request_id').notNull(),
  assetKind: text('asset_kind'),
  srcTable: text('src_table'),
  ftrIdn: text('ftr_idn'),
  editKind: text('edit_kind').notNull(),
  gapM: doublePrecision('gap_m'),
  offsetM: doublePrecision('offset_m'),
  ruleCode: text('rule_code'),
});

export const wtlRequestItemTableComment = '상수도 탐색 수정요청 항목';

export const wtlRequestItemColumnComments: Record<string, string> = {
  item_id: '키',
  request_id: '수정요청',
  asset_kind: '관로, 제수변',
  src_table: '레이어',
  ftr_idn: '시설고유번호',
  edit_kind: '연결, 제수변절단',
  gap_m: '끝점 간격(m)',
  offset_m: '밸브 이격(m)',
  rule_code: '당시 기준',
};
