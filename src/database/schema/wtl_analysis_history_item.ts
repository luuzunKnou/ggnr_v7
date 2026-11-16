/**
 * 공간분석 이력 결과 항목 — 제수변·관로·필지·주소·수용가 등 (layer 스키마)
 * 원본 레이어 외래키는 걸지 않는다. 관망이 바뀌어도 당시 목록은 유지한다.
 */
import { index, integer, jsonb, pgSchema, serial, text } from 'drizzle-orm/pg-core';
import { wtlAnalysisHistory } from './wtl_analysis_history';

const layer = pgSchema('layer');

export const wtlAnalysisHistoryItem = layer.table(
  'wtl_analysis_history_item',
  {
    itemId: serial('item_id').primaryKey().notNull(),
    historyId: integer('history_id')
      .notNull()
      .references(() => wtlAnalysisHistory.historyId, { onDelete: 'cascade' }),
    itemKind: text('item_kind').notNull(),
    role: text('role'),
    seq: integer('seq'),
    srcTable: text('src_table'),
    /** 원본 행 번호 — 시설고유번호가 없거나 중복될 때 복원·표시용 */
    ogcFid: integer('ogc_fid'),
    ftrIdn: text('ftr_idn'),
    name: text('name'),
    attrJson: jsonb('attr_json').$type<Record<string, unknown>>(),
  },
  (t) => [
    index('wtl_analysis_history_item_hist_kind_idx').on(t.historyId, t.itemKind),
    index('wtl_analysis_history_item_src_idx').on(t.srcTable, t.ftrIdn),
    index('wtl_analysis_history_item_ogc_idx').on(t.srcTable, t.ogcFid),
  ]
);

export const wtlAnalysisHistoryItemTableComment = '상수도 공간분석 이력 항목';

export const wtlAnalysisHistoryItemColumnComments: Record<string, string> = {
  item_id: '키',
  history_id: '공간분석 이력',
  item_kind: 'snap, gate, pipe, parcel, address, customer',
  role: '입력, 결과, 잠금 등',
  seq: '정렬 순서',
  src_table: '레이어',
  ogc_fid: '원본 ogc_fid(관로·시설·계량기 등)',
  ftr_idn: '시설고유번호(필지는 PNU, 수용가는 수용가번호)',
  name: '표시명',
  attr_json: '기능별 부가 속성(구경, 주소, 지목, 면적, 전화 등)',
};
