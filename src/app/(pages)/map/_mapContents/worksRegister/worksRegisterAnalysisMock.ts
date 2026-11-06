/** 사업분석·입지추천 — 화면용 예시 데이터 */

export type OwnershipKey = 'gun' | 'guk' | 'do' | 'private'
export type IncludeMode = 'include' | 'exclude'
export type ZoneMode = 'include' | 'conflict' | 'exclude'

export type AnalysisProjectInfo = {
  projectName: string
  budget: string
  orderDept: string
  constructionType: string
}

export type LocationAnalysisConditions = {
  eupMyeonDong: string
  eupDetail: string
  areaSize: string
  landPriceEnabled: boolean
  landPrice: string
  landPriceDir: 'gte' | 'lte'
  ownership: Record<OwnershipKey, { checked: boolean; mode: IncludeMode }>
  zones: Record<string, { checked: boolean; mode: ZoneMode }>
}

export type RecommendedZone = {
  id: string
  name: string
  address: string
  areaM2: number
  landPrice: number
  ownership: string
  zoneLabel: string
  /** 상세(필지분석)용 — 없으면 상세보기 시 도형 필요 안내 */
  wkt5181?: string
}

export const ORDER_DEPTS = [
  '건설과',
  '도로철도과',
  '도시과',
  '환경과',
  '산림과',
  '상하수도사업소',
] as const

export const CONSTRUCTION_TYPES = [
  '도로 개설·확장',
  '아스팔트 덧씌우기',
  '교량·터널',
  '하천 정비',
  '공영주차장',
  '상수도 신설·교체',
  '하수관로 정비',
  '공공건축물 신축',
  '관광시설',
  '도시공원·조경',
] as const

export const EUP_MYEON_DONG = [
  '영양읍',
  '입암면',
  '청기면',
  '수비면',
  '일월면',
  '석보면',
] as const

export const AREA_SIZE_OPTIONS = [
  '100㎡',
  '300㎡',
  '500㎡',
  '1,000㎡',
  '3,000㎡',
  '10,000㎡',
] as const

export const OWNERSHIP_OPTIONS: { key: OwnershipKey; label: string }[] = [
  { key: 'gun', label: '군유지' },
  { key: 'guk', label: '국유지' },
  { key: 'do', label: '도유지' },
  { key: 'private', label: '사유지' },
]

export const ZONE_GROUPS: {
  id: string
  label: string
  items: { id: string; label: string }[]
}[] = [
  {
    id: 'residential',
    label: '주거지역',
    items: [
      { id: 'res1', label: '제1종전용주거지역' },
      { id: 'res2', label: '제2종전용주거지역' },
      { id: 'res3', label: '제1종일반주거지역' },
      { id: 'res4', label: '제2종일반주거지역' },
      { id: 'res5', label: '제3종일반주거지역' },
      { id: 'res6', label: '준주거지역' },
    ],
  },
  {
    id: 'commercial',
    label: '상업지역',
    items: [
      { id: 'com1', label: '중심상업지역' },
      { id: 'com2', label: '일반상업지역' },
      { id: 'com3', label: '근린상업지역' },
      { id: 'com4', label: '유통상업지역' },
    ],
  },
]

function emptyOwnership(): LocationAnalysisConditions['ownership'] {
  return {
    gun: { checked: true, mode: 'include' },
    guk: { checked: true, mode: 'include' },
    do: { checked: true, mode: 'include' },
    private: { checked: false, mode: 'exclude' },
  }
}

function emptyZones(): LocationAnalysisConditions['zones'] {
  const zones: LocationAnalysisConditions['zones'] = {}
  for (const g of ZONE_GROUPS) {
    for (const item of g.items) {
      zones[item.id] = { checked: false, mode: 'include' }
    }
  }
  return zones
}

export function createEmptyProjectInfo(projectName = ''): AnalysisProjectInfo {
  return {
    projectName,
    budget: '',
    orderDept: ORDER_DEPTS[0],
    constructionType: CONSTRUCTION_TYPES[0],
  }
}

export function createEmptyLocationConditions(): LocationAnalysisConditions {
  return {
    eupMyeonDong: EUP_MYEON_DONG[0],
    eupDetail: '전체',
    areaSize: AREA_SIZE_OPTIONS[0],
    landPriceEnabled: false,
    landPrice: '',
    landPriceDir: 'lte',
    ownership: emptyOwnership(),
    zones: emptyZones(),
  }
}

/** 조건 기반 예시 추천 (프론트 목) */
export function mockRecommendZones(cond: LocationAnalysisConditions): RecommendedZone[] {
  const base = cond.eupMyeonDong
  const areaHint = Number(String(cond.areaSize).replace(/[^\d]/g, '')) || 100
  return [
    {
      id: 'rz-1',
      name: `${base} 후보구역 A`,
      address: `${base} 일원`,
      areaM2: Math.round(areaHint * 1.2),
      landPrice: 85_000,
      ownership: '군유지',
      zoneLabel: '제1종일반주거지역',
    },
    {
      id: 'rz-2',
      name: `${base} 후보구역 B`,
      address: `${base} 중앙로 인근`,
      areaM2: Math.round(areaHint * 0.9),
      landPrice: 120_000,
      ownership: '국유지',
      zoneLabel: '근린상업지역',
    },
    {
      id: 'rz-3',
      name: `${base} 후보구역 C`,
      address: `${base} 외곽`,
      areaM2: Math.round(areaHint * 2.1),
      landPrice: 42_000,
      ownership: '도유지',
      zoneLabel: '제2종일반주거지역',
    },
  ]
}
