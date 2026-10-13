/** 데이터조회 가상 레이어 — 드론영상 범위(bbox). GeoServer WMS 동기화 제외 */
export const ORTHO_DATA_QUERY_LAYER_ID = 'ortho_extent';

export function isOrthoDataQueryLayerId(name: string): boolean {
  return String(name ?? '').trim().toLowerCase() === ORTHO_DATA_QUERY_LAYER_ID;
}
