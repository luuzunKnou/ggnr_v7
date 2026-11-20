/**
 * 위상검증 수정요청 도형 — 대상별 변경 전·후 (layer 스키마, EPSG:5181 고정)
 * v7 저장 규칙(SHP·엑셀·앱 테이블 모두 5181)에 맞춰 모든 도형을 5181로 저장한다. 화면에는 4326으로 바꿔 내려준다.
 * before: 요청 당시 원래 도형. 승인 시 현재 도형과 비교해 «요청 이후 변경됨»을 알린다.
 * applied_before: 반영 직전 실제 도형(MULTI 형식 그대로). 되돌리기는 이 도형으로 복원한다.
 * after: 반영할 도형(수정·추가). 반전은 after 없이 before만 남긴다.
 * applied_after: 반영 직후 실제 도형 — 되돌리기 전, 그 사이 다른 수정이 있었는지 비교한다.
 */
import { customType, index, integer, pgSchema, serial, text } from 'drizzle-orm/pg-core';
import { wtlTopoRequest } from './wtl_topo_request';
import { wtlTopoRequestItem } from './wtl_topo_request_item';

const layer = pgSchema('layer');

const geometry5181 = customType<{ data: unknown; driverData: unknown }>({
  dataType() {
    return 'geometry(Geometry,5181)';
  },
});

export const wtlTopoRequestGeom = layer.table(
  'wtl_topo_request_geom',
  {
    geomId: serial('geom_id').primaryKey().notNull(),
    requestId: integer('request_id')
      .notNull()
      .references(() => wtlTopoRequest.requestId, { onDelete: 'cascade' }),
    itemId: integer('item_id')
      .notNull()
      .references(() => wtlTopoRequestItem.itemId, { onDelete: 'cascade' }),
    geomKind: text('geom_kind').notNull(),
    geom: geometry5181('geom'),
  },
  (t) => [
    index('wtl_topo_request_geom_req_idx').on(t.requestId),
    index('wtl_topo_request_geom_item_idx').on(t.itemId, t.geomKind),
  ]
);

export const wtlTopoRequestGeomTableComment = '상수도 위상검증 수정요청 도형';

export const wtlTopoRequestGeomColumnComments: Record<string, string> = {
  geom_id: '키',
  request_id: '위상검증 수정요청',
  item_id: '수정요청 대상',
  geom_kind: 'before(요청 당시), after(반영할 도형), applied_before(반영 직전, 되돌리기용), applied_after(반영 직후)',
  geom: '도형(EPSG:5181)',
};
