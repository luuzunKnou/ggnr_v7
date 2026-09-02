/** GeoServer·visibleLayerNames 에 쓰는 define 테이블명 */
export const ROAD_FRONTAGE_BUILDING_WMS_LAYER_ID = 'road_frontage_building';
/** 표주 점(자식) — 지도 표시·식별용 */
export const ROAD_FRONTAGE_MARKER_ITEM_WMS_LAYER_ID = 'road_frontage_marker_item';

export const ROAD_FRONTAGE_WMS_LAYER_IDS = [
  ROAD_FRONTAGE_BUILDING_WMS_LAYER_ID,
  ROAD_FRONTAGE_MARKER_ITEM_WMS_LAYER_ID,
] as const;

export const ROAD_FRONTAGE_LAYER_GROUP = '접도구역';

export function isRoadFrontageWmsLayerId(tableName: string): boolean {
  const t = String(tableName ?? '').trim().toLowerCase();
  return ROAD_FRONTAGE_WMS_LAYER_IDS.some((id) => id.toLowerCase() === t);
}
