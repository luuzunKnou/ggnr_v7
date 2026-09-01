/**
 * 접도구역 표주·표지 관리대장 (layer 스키마)
 * 기동 시 ensureLayerAppTables 가 없으면 생성한다.
 * 노선(1) — 표주 점(N)
 */
import { customType, integer, pgSchema, serial, text } from 'drizzle-orm/pg-core';

const layer = pgSchema('layer');

const geomPoint5181 = customType<{ data: string | null; driverData: string | null }>({
  dataType() {
    return 'geometry(Point,5181)';
  },
});

const geomMultiPoint5181 = customType<{ data: string | null; driverData: string | null }>({
  dataType() {
    return 'geometry(MultiPoint,5181)';
  },
});

export const roadFrontageMarker = layer.table('road_frontage_marker', {
  id: serial('id').primaryKey().notNull(),
  roadType: text('road_type'),
  routeName: text('route_name'),
  /** 소속 표주 점 모음 */
  geom: geomMultiPoint5181('geom'),
});

export const roadFrontageMarkerItem = layer.table('road_frontage_marker_item', {
  id: serial('id').primaryKey().notNull(),
  parentId: integer('parent_id')
    .notNull()
    .references(() => roadFrontageMarker.id, { onDelete: 'cascade' }),
  stationDistance: text('station_distance'),
  ownerName: text('owner_name'),
  ownerAddress: text('owner_address'),
  sign: text('sign'),
  remark: text('remark'),
  /** 설치위치 — 예: 일월면 곡강리 162-2 (지목 제외) */
  installLocation: text('install_location'),
  /** 지목 — 예: 대, 전, 답 */
  landCategory: text('land_category'),
  pnu: text('pnu'),
  geom: geomPoint5181('geom'),
});

export const roadFrontageMarkerTableComment = '접도구역 표주 관리대장';

export const roadFrontageMarkerColumnComments: Record<string, string> = {
  id: 'id',
  road_type: '도로의 종류',
  route_name: '노선명',
  geom: '표주 점 모음',
};

export const roadFrontageMarkerItemTableComment = '접도구역 표주 점';

export const roadFrontageMarkerItemColumnComments: Record<string, string> = {
  id: 'id',
  parent_id: '관리대장 id',
  station_distance: '지점거리',
  owner_name: '토지 소유자 성명',
  owner_address: '토지 소유자 주소',
  sign: '표지',
  remark: '비고',
  install_location: '설치위치',
  land_category: '지목',
  pnu: '필지번호',
  geom: '위치',
};
