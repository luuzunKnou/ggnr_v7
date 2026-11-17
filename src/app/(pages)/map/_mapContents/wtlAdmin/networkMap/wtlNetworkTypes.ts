import type { WtlNetGeomKind, WtlNetLayerKey } from './wtlNetworkLayerCatalog'

export type WtlNetworkRow = {
  id: string
  layerKey: WtlNetLayerKey | string
  geomKind: WtlNetGeomKind
  name: string
  diameter: string
  material: string
  length: string
  year: string
  status: string
  hjd: string
  attrs: Array<{ label: string; value: string }>
  geom?: GeoJSON.Geometry | null
  /** 상세 모달 — DB 행(geom 제외). 필드 설정·코드 한글화용 */
  record?: Record<string, unknown> | null
  /** table_{name}.json 조회 키 (물리 테이블명) */
  fieldsTable?: string | null
  /** 분할 레이어 시 부모 테이블 등 코드 폴백 */
  fieldsTableFallback?: string | null
}

export type WtlNetworkFilterMeta = {
  yearMin: number
  yearMax: number
  diameterMin: number
  diameterMax: number
  /** UI 칩 라벨(한글 재질명 + «기타») */
  materials: string[]
  /** 한글 재질명 → mop_cde 목록 (목록 SQL·WMS CQL 공통) */
  materialLabelToCodes: Record<string, string[]>
  /** 상위 재질 코드 — «기타» = 이 목록에 없는 값 */
  materialTopCodes: string[]
}

export type WtlNetworkLengthStatRow = {
  label: string
  meters: number
}

export type WtlNetworkFacilityCountRow = {
  label: string
  count: number
}

export type WtlNetworkStatusStats = {
  byDiameter: WtlNetworkLengthStatRow[]
  byMaterial: WtlNetworkLengthStatRow[]
  byYear: WtlNetworkLengthStatRow[]
  /** 관용도(saa_cde)별 연장 */
  bySaa: WtlNetworkLengthStatRow[]
  facilityCounts: WtlNetworkFacilityCountRow[]
}

/**
 * 현황·교차표 공통 — 리스트 패널 검색 + «화면에 보이는 시설만» + 켜진 레이어.
 * 목록 getWtlNetworkList 와 동일 필드.
 */
export type WtlNetworkStatusListFilter = {
  /** 사이드바에서 켜진 레이어 키(상수관로 기타·배수 등). 비면 관로 집계 없음 */
  layerKeys?: string[] | null
  /** true 인데 bbox 없으면 집계 보류(빈 결과) — 목록 «화면에 보이는 시설만»과 동일 */
  onlyInView?: boolean
  bbox?: number[] | null
  keyword?: string
  yearFrom?: number | null
  yearTo?: number | null
  diameterFrom?: number | null
  diameterTo?: number | null
  materials?: string[]
  emdCode?: string | null
  riCode?: string | null
  supplyBlock?: string | null
  areaWkts5181?: string[] | null
}

/** 확대 모달 교차축 — 관경(dip) / 연도(year) */
export type WtlNetworkAxisMode = 'dip' | 'year'

/** 관경·연도 확대 모달 — mop_cde × 축 교차 + 경년·비내식 */
export type WtlNetworkDipMatrixCell = Record<string, number>

export type WtlNetworkDipMatrixRow = {
  mopCode: string
  label: string
  isTotal: boolean
  total: number
  lengths: WtlNetworkDipMatrixCell
  agedLength: number
  agedRatio: number
  /** 총계 행만 값, 그 외 null */
  nonCorrosionRatio: number | null
  usefulLife: number | null
  /** 연도축만 — 연장가중 평균연령(년). 관경축은 null */
  avgAge: number | null
}

export type WtlNetworkDipMatrix = {
  axis: WtlNetworkAxisMode
  statYear: number
  /** dip=std_dip / year=매설년도 (오름차순, 미상 맨 뒤) */
  columns: string[]
  /** 연도축만 — columns와 동일 순서의 사용연수(statYear 기준) */
  serviceYears: (number | null)[]
  rows: WtlNetworkDipMatrixRow[]
}

export type WtlNetworkDipFilterOption = {
  value: string
  label: string
}

export type WtlNetworkDipFilterOptions = {
  /** 관로 종류 (부모 테이블명 → 한글명) */
  pipeKinds: WtlNetworkDipFilterOption[]
  /** 읍면동 */
  emds: WtlNetworkDipFilterOption[]
  /** 매설년도 (ist_ymd 앞 4자리) */
  years: WtlNetworkDipFilterOption[]
  /** 관용도 (saa_cde) */
  saas: WtlNetworkDipFilterOption[]
}

/**
 * 확대 모달 필터.
 * - `null` / 생략 = 전체
 * - `[]` = 미선택(결과 없음)
 * - 값 있음 = 해당 항목만
 * pipeTables: 논리 키(wtl_pipe_lm|wtl_sply_ls). 물리 테이블은 mapSources remap.
 */
export type WtlNetworkDipMatrixParams = {
  /** 선택된 관망 레이어 그룹(define_table_group) */
  mapSources?: string[]
  pipeTables?: string[] | null
  emdCodes?: string[] | null
  years?: string[] | null
  saaCodes?: string[] | null
  /** 리스트 패널 검색·화면 범위 */
  listFilter?: WtlNetworkStatusListFilter | null
}

/** 연도별 확대 모달 — years 필터는 무시(축이 연도). 그 외는 관경과 동일 */
export type WtlNetworkYearMatrixParams = Omit<WtlNetworkDipMatrixParams, 'years'>

/** 관용도별 확대 — mop_cde × saa_cde, 셀=연장 합 */
export type WtlNetworkSaaMatrixRow = {
  mopCode: string
  label: string
  isTotal: boolean
  total: number
  lengths: Record<string, number>
}

export type WtlNetworkSaaMatrix = {
  columns: string[]
  columnLabels: Record<string, string>
  rows: WtlNetworkSaaMatrixRow[]
}

/**
 * 관용도별 모달 필터.
 * - diameterFrom/To: null=미적용, 숫자=관경(std_dip) 구간
 */
export type WtlNetworkSaaMatrixParams = {
  mapSources?: string[]
  pipeTables?: string[] | null
  emdCodes?: string[] | null
  years?: string[] | null
  diameterFrom?: number | null
  diameterTo?: number | null
  /** 리스트 패널 검색·화면 범위 */
  listFilter?: WtlNetworkStatusListFilter | null
}
