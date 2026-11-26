/**
 * 소규모공공시설 후보지 — 유형 테이블 공통 필드 라벨(세천 defineLayer 기준).
 * 등급은 시설 필드가 아니라 안전점검(spf_check)에서만 표시한다.
 */

export const SMALL_PUBLIC_FAC_LAYER = 'spf_creek'

export type SmallPublicDefineField = {
  define_field_name?: string
  define_field_kor_name?: string
  define_field_show_list?: string | boolean
  define_field_show_detail?: string | boolean
  define_field_show_search?: string | boolean
  define_field_is_required?: string | boolean
  define_field_read_only?: string | boolean
  define_field_idx?: string | number
}

/** DB/defineLayer 영문 컬럼 → 화면 시설 객체 키 */
export const SPF_FAC_FIELD_TO_ATTR: Record<string, string> = {
  cons_code: 'mngNo',
  sisul_name: 'name',
  shp_code: 'geomCode',
  type: 'type',
  emd: 'emd',
  ri: 'ri',
  address: 'address',
  start_xy: 'startXy',
  end_xy: 'endXy',
  ben_area: 'benefitArea',
  risk_date: 'riskDate',
  candidate: 'candidate',
  lne: 'length',
  width: 'width',
  hight: 'height',
  parent_fac_name: 'parentFacName',
  parent_cons_code: 'parentFacId',
}

/** 시설 속성에서 빼는 키 — 등급은 점검만, 부모는 부속시설물 탭 */
const FAC_ATTR_BLOCKLIST = new Set([
  'id',
  'geom',
  'risk_rank',
  'risk_score',
  'surv_date',
  'surv_name',
  'parent_fac_id',
  'parent_cons_code',
  'parent_fac_name',
  'src_table',
])

/** 등록 폼에서 지도 찍기로 다루는 좌표 — 텍스트 입력 제외 */
const FAC_FORM_COORD_FIELDS = new Set(['start_xy', 'end_xy'])

function flagOn(v: string | boolean | undefined): boolean {
  if (v === true) return true
  const s = String(v ?? '')
    .trim()
    .toLowerCase()
  return s === 'true' || s === 'y' || s === '1'
}

function fieldIdx(f: SmallPublicDefineField): number {
  const n = Number(f.define_field_idx)
  return Number.isFinite(n) ? n : 9999
}

let fieldsCache: SmallPublicDefineField[] | null = null
let fieldsInflight: Promise<SmallPublicDefineField[]> | null = null

export async function fetchSpfFacDefineFields(): Promise<SmallPublicDefineField[]> {
  if (fieldsCache) return fieldsCache
  if (fieldsInflight) return fieldsInflight
  fieldsInflight = (async () => {
    try {
      const res = await fetch(`/api/config/defineLayer/fields/${encodeURIComponent(SMALL_PUBLIC_FAC_LAYER)}`)
      const json = (await res.json()) as { data?: SmallPublicDefineField[] } | SmallPublicDefineField[]
      const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : []
      fieldsCache = rows
      return rows
    } catch {
      fieldsCache = []
      return []
    } finally {
      fieldsInflight = null
    }
  })()
  return fieldsInflight
}

export function spfFacListFields(fields: SmallPublicDefineField[]): SmallPublicDefineField[] {
  return fields
    .filter((f) => {
      const name = String(f.define_field_name ?? '')
        .trim()
        .toLowerCase()
      if (!name || FAC_ATTR_BLOCKLIST.has(name)) return false
      if (name === 'risk_rank' || name === 'risk_score') return false
      return flagOn(f.define_field_show_list)
    })
    .sort((a, b) => fieldIdx(a) - fieldIdx(b))
}

export function spfFacDetailFields(fields: SmallPublicDefineField[]): SmallPublicDefineField[] {
  return fields
    .filter((f) => {
      const name = String(f.define_field_name ?? '')
        .trim()
        .toLowerCase()
      if (!name || FAC_ATTR_BLOCKLIST.has(name)) return false
      if (name === 'risk_rank' || name === 'risk_score') return false
      return flagOn(f.define_field_show_detail)
    })
    .sort((a, b) => fieldIdx(a) - fieldIdx(b))
}

/** 목록 검색 — 레이어설정 show_search (+ 관리번호는 매핑키라 항상) */
export function spfFacSearchFields(fields: SmallPublicDefineField[]): SmallPublicDefineField[] {
  const rows = fields
    .filter((f) => {
      const name = String(f.define_field_name ?? '')
        .trim()
        .toLowerCase()
      if (!name || FAC_ATTR_BLOCKLIST.has(name)) return false
      if (name === 'cons_code') return true
      return flagOn(f.define_field_show_search)
    })
    .sort((a, b) => fieldIdx(a) - fieldIdx(b))
  return rows
}

export function spfFacSearchPlaceholder(fields: SmallPublicDefineField[]): string {
  const labels = spfFacSearchFields(fields)
    .map((f) => String(f.define_field_kor_name ?? '').trim())
    .filter(Boolean)
  if (labels.length === 0) return '시설명·관리번호 검색'
  return `${labels.slice(0, 3).join('·')} 검색`
}

/** 등록·수정 폼 — show_detail, 좌표·부모 제외. 관리번호는 항상(읽기전용·자동발급) */
export function spfFacFormFields(fields: SmallPublicDefineField[]): SmallPublicDefineField[] {
  const detail = spfFacDetailFields(fields).filter((f) => {
    const name = String(f.define_field_name ?? '')
      .trim()
      .toLowerCase()
    return !FAC_FORM_COORD_FIELDS.has(name) && name !== 'cons_code'
  })
  const cons = fields.find(
    (f) =>
      String(f.define_field_name ?? '')
        .trim()
        .toLowerCase() === 'cons_code'
  )
  return cons ? [cons, ...detail] : detail
}

export function spfFacFieldRequired(f: SmallPublicDefineField): boolean {
  const name = String(f.define_field_name ?? '')
    .trim()
    .toLowerCase()
  if (name === 'cons_code') return true
  return flagOn(f.define_field_is_required)
}

export function spfFacFieldReadOnly(f: SmallPublicDefineField): boolean {
  return flagOn(f.define_field_read_only)
}

export function spfFacAttrKey(fieldName: string): string | null {
  const k = String(fieldName ?? '')
    .trim()
    .toLowerCase()
  return SPF_FAC_FIELD_TO_ATTR[k] ?? null
}
