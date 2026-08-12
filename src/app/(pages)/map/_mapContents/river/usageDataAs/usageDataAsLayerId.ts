/** GeoServer·서비스 레이어 define 테이블명 */
export const USAGE_DATA_AS_WMS_LAYER_ID = "usage_data_as";
export const USAGE_DATA_AS_SOLO_WMS_LAYER_ID = "usage_data_as_solo";
export const USAGE_DATA_AS_MGJ_WMS_LAYER_ID = "usage_data_as_mgj";
/** 울진 점용시설물 — 목록 패널에서 on/off (본표와 별도) */
export const USAGE_DATA_AS_SISUL_WMS_LAYER_ID = "usage_data_sisul_as";

/** 필지·물건지 WMS (목록/오픈 시에는 끄고, 상세에서 행 클릭 시에만 켬) */
export const USAGE_DATA_AS_CHILD_WMS_LAYER_IDS = [
  USAGE_DATA_AS_SOLO_WMS_LAYER_ID,
  USAGE_DATA_AS_MGJ_WMS_LAYER_ID,
] as const;

/** 본표+자식 — 지도 클릭 식별용 (시설물 제외) */
export const USAGE_DATA_AS_WMS_LAYER_IDS = [
  USAGE_DATA_AS_WMS_LAYER_ID,
  ...USAGE_DATA_AS_CHILD_WMS_LAYER_IDS,
] as const;

/** 패널 소유 WMS — 종료·상태복원 제외용 (본표+자식+시설물) */
export const USAGE_DATA_AS_PANEL_WMS_LAYER_IDS = [
  ...USAGE_DATA_AS_WMS_LAYER_IDS,
  USAGE_DATA_AS_SISUL_WMS_LAYER_ID,
] as const;

const USAGE_DATA_AS_PANEL_WMS_LAYER_ID_SET = new Set(
  USAGE_DATA_AS_PANEL_WMS_LAYER_IDS.map((id) => id.toLowerCase())
);

export function isUsageDataAsWmsLayerId(tableName: string): boolean {
  return USAGE_DATA_AS_PANEL_WMS_LAYER_ID_SET.has(
    String(tableName ?? "").trim().toLowerCase()
  );
}
