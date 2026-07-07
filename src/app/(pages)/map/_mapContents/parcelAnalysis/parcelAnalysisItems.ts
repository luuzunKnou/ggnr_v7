export type ParcelAnalysisItemDef = {
  id: string;
  title: string;
  description?: string;
};

export type ParcelAnalysisGroupDef = {
  id: string;
  title: string;
  items: ParcelAnalysisItemDef[];
};

/** v6 data.json 구조 + 시설목록(1차 mock) */
export const PARCEL_ANALYSIS_GROUPS: ParcelAnalysisGroupDef[] = [
  {
    id: 'basicMap',
    title: '기본도',
    items: [
      { id: 'basicMap:aerial', title: '항공영상', description: '결과보고서 배경 항공영상' },
      { id: 'basicMap:jijuk', title: '연속지적도', description: '연속지적도·지번주소' },
      { id: 'basicMap:building', title: '건물 및 건물군' },
      { id: 'basicMap:road', title: '실폭도로' },
    ],
  },
  {
    id: 'building',
    title: '건축물',
    items: [{ id: 'building:ledger', title: '건축물대장', description: '건축물대장 현황 분석' }],
  },
  {
    id: 'parcel',
    title: '필지분석',
    items: [
      { id: 'parcel:land', title: '토지현황', description: '필지 목록·필지정보' },
      { id: 'parcel:owner', title: '소유자 현황' },
      { id: 'parcel:jimok', title: '지목별 현황' },
      { id: 'parcel:landUse', title: '토지이용계획 현황' },
    ],
  },
  {
    id: 'facility',
    title: '시설목록',
    items: [],
  },
];

export const ALL_PARCEL_ITEM_IDS = PARCEL_ANALYSIS_GROUPS.flatMap((g) =>
  g.items.map((i) => i.id)
);

/** 시설목록 제외 고정 그룹 — SSR·수화 전 표시용 */
export const STATIC_PARCEL_ANALYSIS_GROUPS = PARCEL_ANALYSIS_GROUPS.filter((g) => g.id !== 'facility');

export const STATIC_PARCEL_ITEM_IDS = STATIC_PARCEL_ANALYSIS_GROUPS.flatMap((g) =>
  g.items.map((i) => i.id)
);
