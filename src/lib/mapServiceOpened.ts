/**
 * ser_eng → URL `opened` 쿼리 키 (map-sidebar, 지도 식별 분기와 동일해야 함)
 */
export const SER_ENG_TO_OPENED: Record<string, string> = {
  dataQuery: 'standardList',
  mapState: 'standardList',
  data3d: 'map3dData',
  parcelAnalysis: 'landInfo',
  tifManager: 'highQualityVideo',
  complaint: 'complaintManagement',
  memo: 'memoManagement',
  crossSection: 'sectionView',
  waterSupplyWork: 'waterSupply',
  waterworksLedger: 'constructionLedger',
  riverBasicPlan: 'riverBasicPlan',
};

export function getOpenedKeyForSerEng(serEng: string): string {
  return SER_ENG_TO_OPENED[serEng] ?? serEng;
}

export type SerLayerIdentifyRule = {
  layer_name?: string | null;
  identify?: string | null;
};

/** URL opened 토큰에 해당하는 서비스의 `open_scan` 레이어 define_table_name 집합 */
export function collectOpenScanLayerTableNames(
  openedTokens: string[],
  services: Array<{ ser_eng?: string | null; ser_layers?: SerLayerIdentifyRule[] | null }>
): Set<string> {
  const opened = new Set(openedTokens.map((t) => t.trim()).filter(Boolean));
  const out = new Set<string>();
  for (const s of services) {
    const eng = String(s.ser_eng ?? '').trim();
    if (!eng) continue;
    const key = getOpenedKeyForSerEng(eng);
    if (!opened.has(key)) continue;
    const layers = Array.isArray(s.ser_layers) ? s.ser_layers : [];
    for (const row of layers) {
      if (String(row.identify ?? '').trim() !== 'open_scan') continue;
      const name = String(row.layer_name ?? '').trim();
      if (name) out.add(name);
    }
  }
  return out;
}
