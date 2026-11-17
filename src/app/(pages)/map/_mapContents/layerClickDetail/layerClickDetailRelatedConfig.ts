/**
 * 지도 기본 모달·관망·설비 상세가 공유하는 연관 탭·시설 추가정보 매핑.
 * (서버 service에서도 import 가능 — client 전용 API 금지)
 */

export type WtlRelatedChildCandidate = {
  defineTable: string
  label: string
}

/** 가압장·정수장 상세 하단 연관 자식 탭 후보 */
export const RELATED_CHILD_BY_PARENT: Record<string, WtlRelatedChildCandidate[]> = {
  wtl_pres_ps: [
    { defineTable: 'wtl_pres_pm_ps', label: '펌프현황' },
    { defineTable: 'wtl_pres_hj_ps', label: '흡수정 현황' },
  ],
  wtl_puri_as: [{ defineTable: 'wtl_puri_dt_ps', label: '펌프 현황' }],
}

export function relatedChildParentKeys(): string[] {
  return Object.keys(RELATED_CHILD_BY_PARENT)
}

export function isRelatedChildParentKey(key: string): boolean {
  return Boolean(RELATED_CHILD_BY_PARENT[String(key ?? '').trim().toLowerCase()])
}

/**
 * 가압장·배수지·정수장 — 시설 Search 대상(열릴 시설)이며,
 * 이 테이블 상세에는 Search를 달지 않는다.
 */
export const FACILITY_DETAIL_TARGET_TABLES = new Set([
  'wtl_pres_ps',
  'wtl_serv_ps',
  'wtl_puri_as',
])

/** 현재 행 ftr_idn 으로 시설 플로팅 (펌프·흡수정 등 자식 현황) */
export type FacilityInfoByFtrIdnDef = {
  fieldNames: string[]
  korNames: string[]
  table: string
  title: string
  fieldsTable: string
}

export const FACILITY_INFO_BY_FTR_IDN: FacilityInfoByFtrIdnDef[] = [
  {
    fieldNames: ['prs_nam'],
    korNames: ['가압장명'],
    table: 'wtl_pres_ps',
    title: '가압장',
    fieldsTable: 'wtl_pres_ps',
  },
  {
    fieldNames: ['pur_nam'],
    korNames: ['정수장명'],
    table: 'wtl_puri_as',
    title: '정수장',
    fieldsTable: 'wtl_puri_as',
  },
]

/**
 * byFtrIdn Search를 다는 소스 테이블.
 * - 펌프현황(가압): prs_nam(가압장명)
 * - 펌프현황(정수): pur_nam(정수장명)
 * - 흡수정현황: prs_nam(가압장명)
 * 가압장·정수장·배수지 본 시설에는 달지 않는다.
 */
export const FACILITY_INFO_BY_FTR_IDN_SOURCES = new Set([
  'wtl_pres_pm_ps',
  'wtl_pres_hj_ps',
  'wtl_puri_dt_ps',
])

/** 소스 테이블별 byFtrIdn 노출 필드(영문) — 문서·검수용 */
export const FACILITY_INFO_BY_FTR_IDN_FIELDS_BY_SOURCE: Record<
  string,
  readonly string[]
> = {
  wtl_pres_pm_ps: ['prs_nam'],
  wtl_puri_dt_ps: ['pur_nam'],
  wtl_pres_hj_ps: ['prs_nam'],
}

/**
 * 염소투입·수질계측기 — 시설명 컬럼 값을
 * 가압장·배수지·정수장 시설명과 매칭해 시설 열기 (show_title 미사용)
 */
export const FACILITY_NAME_LOOKUP_FIELDS_BY_SOURCE: Record<string, readonly string[]> = {
  /** 염소투입설비 */
  wtl_infeed_ps: ['inf_nam'],
  /** 수질계측기 */
  wtl_meter_ps: ['mtr_nam'],
}

export const FACILITY_NAME_LOOKUP_TARGETS: Array<{
  table: string
  title: string
  fieldsTable: string
}> = [
  { table: 'wtl_pres_ps', title: '가압장', fieldsTable: 'wtl_pres_ps' },
  { table: 'wtl_serv_ps', title: '배수지', fieldsTable: 'wtl_serv_ps' },
  { table: 'wtl_puri_as', title: '정수장', fieldsTable: 'wtl_puri_as' },
]

/** @deprecated FACILITY_NAME_LOOKUP_TARGETS 사용 */
export const FACILITY_SHOW_TITLE_LOOKUP_TARGETS = FACILITY_NAME_LOOKUP_TARGETS

export function resolveFacilityInfoByFtrIdn(
  fieldName: string,
  korName: unknown
): FacilityInfoByFtrIdnDef | null {
  const name = String(fieldName ?? '')
    .trim()
    .toLowerCase()
  const kor = String(korName ?? '').trim()
  for (const def of FACILITY_INFO_BY_FTR_IDN) {
    if (def.fieldNames.some((f) => f.toLowerCase() === name)) return def
    if (kor && def.korNames.includes(kor)) return def
  }
  return null
}

export function isFacilityNameLookupSource(tableKey: string): boolean {
  const key = String(tableKey ?? '')
    .trim()
    .toLowerCase()
  return Boolean(FACILITY_NAME_LOOKUP_FIELDS_BY_SOURCE[key]?.length)
}

/** @deprecated isFacilityNameLookupSource 사용 */
export function isFacilityShowTitleLookupSource(tableKey: string): boolean {
  return isFacilityNameLookupSource(tableKey)
}

/** 염소·수질 등 — 시설 추가정보 Search를 달 필드명 */
export function facilityNameLookupFieldsForSource(
  tableKey: string
): readonly string[] {
  const key = String(tableKey ?? '')
    .trim()
    .toLowerCase()
  return FACILITY_NAME_LOOKUP_FIELDS_BY_SOURCE[key] ?? []
}

export function isFacilityInfoByFtrIdnSource(tableKey: string): boolean {
  return FACILITY_INFO_BY_FTR_IDN_SOURCES.has(
    String(tableKey ?? '')
      .trim()
      .toLowerCase()
  )
}

/** 가압장·배수지·정수장 본 시설 상세 — Search 비노출 */
export function isFacilityDetailTargetTable(tableKey: string): boolean {
  return FACILITY_DETAIL_TARGET_TABLES.has(
    String(tableKey ?? '')
      .trim()
      .toLowerCase()
  )
}
