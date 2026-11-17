/** GeoServer·visibleLayerNames 에 쓰는 define 테이블명 */
export const RIVER_ILLEGAL_OCCUPATION_WMS_LAYER_ID = "illegal_usage_as";

export const RIVER_ILLEGAL_OCCUPATION_WMS_LAYER_IDS = [
  RIVER_ILLEGAL_OCCUPATION_WMS_LAYER_ID,
] as const;

const RIVER_ILLEGAL_OCCUPATION_WMS_LAYER_ID_SET = new Set(
  RIVER_ILLEGAL_OCCUPATION_WMS_LAYER_IDS.map((id) => id.toLowerCase())
);

export function isRiverIllegalOccupationWmsLayerId(tableName: string): boolean {
  return RIVER_ILLEGAL_OCCUPATION_WMS_LAYER_ID_SET.has(
    String(tableName ?? "").trim().toLowerCase()
  );
}
