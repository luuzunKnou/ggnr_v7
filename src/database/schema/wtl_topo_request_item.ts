/**
 * 위상검증 수정요청 대상 — 반전·수정·추가할 관로·시설 (layer 스키마)
 * 한 요청에 여러 관로(접합점 반전 등)가 들어갈 수 있다.
 */
import { index, integer, jsonb, pgSchema, serial, text } from 'drizzle-orm/pg-core';
import { wtlTopoRequest } from './wtl_topo_request';

const layer = pgSchema('layer');

export const wtlTopoRequestItem = layer.table(
  'wtl_topo_request_item',
  {
    itemId: serial('item_id').primaryKey().notNull(),
    requestId: integer('request_id')
      .notNull()
      .references(() => wtlTopoRequest.requestId, { onDelete: 'cascade' }),
    seq: integer('seq'),
    editKind: text('edit_kind').notNull(),
    srcTable: text('src_table').notNull(),
    /** 기존 대상 — 추가(insert)면 없음 */
    ogcFid: integer('ogc_fid'),
    ftrIdn: text('ftr_idn'),
    ftrCde: text('ftr_cde'),
    saaCde: text('saa_cde'),
    /** 반영 후 결과 — 추가면 새 ogc_fid (되돌리면 이 행을 지운다) */
    resultOgcFid: integer('result_ogc_fid'),
    /** 반영 직전 속성 — 되돌릴 때 복원 (수정·반전은 도형만 바뀌므로 대개 비어 있음) */
    beforeAttrJson: jsonb('before_attr_json').$type<Record<string, unknown>>(),
    attrJson: jsonb('attr_json').$type<Record<string, unknown>>(),
  },
  (t) => [
    index('wtl_topo_request_item_req_idx').on(t.requestId),
    index('wtl_topo_request_item_src_idx').on(t.srcTable, t.ogcFid),
  ]
);

export const wtlTopoRequestItemTableComment = '상수도 위상검증 수정요청 대상';

export const wtlTopoRequestItemColumnComments: Record<string, string> = {
  item_id: '키',
  request_id: '위상검증 수정요청',
  seq: '정렬 순서',
  edit_kind: 'reverse(반전), modify(도형 수정), insert(추가)',
  src_table: '레이어(wtl_pipe_lm, wtl_sply_ls, wtl_valv_ps 등)',
  ogc_fid: '대상 ogc_fid(추가면 없음)',
  ftr_idn: '요청 당시 관리번호(표시용)',
  ftr_cde: '지형지물부호(추가 시 SA001, SA200 등)',
  saa_cde: '상수관용도(상수관 추가 시 SAA003·SAA004·SAA999)',
  result_ogc_fid: '반영 결과 ogc_fid(추가면 새 번호, 되돌리면 삭제)',
  before_attr_json: '반영 직전 속성(되돌리기용)',
  attr_json: '부가 속성(관경·재질 등, 이후 확장)',
};
