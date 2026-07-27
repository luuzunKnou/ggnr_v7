/** GeoServer·서비스 레이어 define 테이블명 */
export const USAGE_DATA_AS_WMS_LAYER_ID = "usage_data_as";
export const USAGE_DATA_AS_SOLO_WMS_LAYER_ID = "usage_data_as_solo";
export const USAGE_DATA_AS_MGJ_WMS_LAYER_ID = "usage_data_as_mgj";

/** 하천점용 목록·상세 진입 시 함께 켤 WMS 레이어 */
export const USAGE_DATA_AS_WMS_LAYER_IDS = [
  USAGE_DATA_AS_WMS_LAYER_ID,
  USAGE_DATA_AS_SOLO_WMS_LAYER_ID,
  USAGE_DATA_AS_MGJ_WMS_LAYER_ID,
] as const;
