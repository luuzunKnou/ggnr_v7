export type ParcelAnalysisBasicMapLayerDef = {
  id: string;
  title: string;
  wmsLayer?: string;
  showSatellite?: boolean;
};

/** v6 data.json 기본도 WMS 레이어명 */
export const PARCEL_ANALYSIS_BASIC_MAP_LAYERS: ParcelAnalysisBasicMapLayerDef[] = [
  { id: 'basicMap:aerial', title: '항공영상', showSatellite: true },
  { id: 'basicMap:jijuk', title: '연속지적도', wmsLayer: 'jijuk' },
  { id: 'basicMap:building', title: '건물 및 건물군', wmsLayer: 'tl_sgco_rnadr_mst' },
  { id: 'basicMap:road', title: '실폭도로', wmsLayer: 'tl_sprd_rw' },
];

/** 결과 모달 기본도 — 합성 지도 1장 섹션 id */
export const BASIC_MAP_COMPOSITE_SECTION_ID = 'basicMap:map';

/** 목차에 표시할 짧은 제목 */
export const BASIC_MAP_TOC_TITLE = '분석 지도';

export function resolveBasicMapLayersForCapture(layerIds: string[]): ParcelAnalysisBasicMapLayerDef[] {
  const idSet = new Set(layerIds);
  return PARCEL_ANALYSIS_BASIC_MAP_LAYERS.filter((d) => idSet.has(d.id));
}

export function basicMapCompositeTitle(layerIds: string[]): string {
  const titles = resolveBasicMapLayersForCapture(layerIds).map((d) => d.title);
  return titles.length ? titles.join(' · ') : '분석 지도';
}
