/**
 * 공간분석 이력 도형 — 스냅점·관로·단수 면 (layer 스키마, 4326)
 * 지도 복원용. 위상 수정요청 도형(5181)과 좌표계가 다르다.
 */
import { customType, doublePrecision, index, integer, pgSchema, serial, text } from 'drizzle-orm/pg-core';
import { wtlAnalysisHistory } from './wtl_analysis_history';

const layer = pgSchema('layer');

const geometry4326 = customType<{ data: unknown; driverData: unknown }>({
  dataType() {
    return 'geometry(Geometry,4326)';
  },
});

export const wtlAnalysisHistoryGeom = layer.table(
  'wtl_analysis_history_geom',
  {
    geomId: serial('geom_id').primaryKey().notNull(),
    historyId: integer('history_id')
      .notNull()
      .references(() => wtlAnalysisHistory.historyId, { onDelete: 'cascade' }),
    geomKind: text('geom_kind').notNull(),
    seq: integer('seq'),
    bufferM: doublePrecision('buffer_m'),
    geom: geometry4326('geom'),
  },
  (t) => [index('wtl_analysis_history_geom_hist_idx').on(t.historyId)]
);

export const wtlAnalysisHistoryGeomTableComment = '상수도 공간분석 이력 도형';

export const wtlAnalysisHistoryGeomColumnComments: Record<string, string> = {
  geom_id: '키',
  history_id: '공간분석 이력',
  geom_kind: 'snap, pipes, zone, building_zone',
  seq: '순서(단수 면이 여러 개일 때)',
  buffer_m: '면 생성 버퍼(m)',
  geom: '도형(4326)',
};
