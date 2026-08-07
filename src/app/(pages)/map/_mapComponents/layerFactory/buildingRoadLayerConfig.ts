/**
 * 건물·도로 패널·WMS 후보 (OpenLayers 의존 없음 — service에서도 참조).
 * 실제 노출은 tables.json 등록 + DB public_layer 존재로 한 번 더 걸러진다.
 */
export const BUILDING_ROAD_LAYER_DEFS: {
  tableName: string;
  layerName: string;
  minZoom: number;
  maxZoom: number;
}[] = [
  { tableName: 'tl_sgco_rnadr_mst', layerName: '건물군', minZoom: 8, maxZoom: 30 },
  { tableName: 'tl_spbd_entrc', layerName: '건물군 출입구', minZoom: 8, maxZoom: 30 },
  { tableName: 'tl_sgco_rnadr_dong', layerName: '건물', minZoom: 8, maxZoom: 30 },
  { tableName: 'tl_spbd_entrc_dong', layerName: '건물 출입구', minZoom: 8, maxZoom: 30 },
  { tableName: 'tl_sprd_rw', layerName: '실폭도로', minZoom: 8, maxZoom: 30 },
  { tableName: 'tl_sprd_manage', layerName: '도로구간', minZoom: 8, maxZoom: 30 },
];
