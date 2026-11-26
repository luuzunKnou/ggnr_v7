/** 상하수도 민원 테이블 → 민원관리 화면 항목 */

export type WaterComplaintColumns = {
  name: string
  tel: string
  date: string
  dept: string | null
  team: string | null
  writer: string | null
  address: string
  content: string
  state: string | null
  result: string | null
  /** 세부분류 컬럼 (목록 #태그). 없으면 null */
  cat: string | null
  /** 통계분류 컬럼 (목록 #태그). 없으면 null */
  stat: string | null
  /** 준설대상지처럼 접수번호에 붙는 하위 테이블 */
  hasChild: boolean
}

const WTL_LIKE: WaterComplaintColumns = {
  name: 'comp_req_name',
  tel: 'comp_req_tel',
  date: 'comp_create_date',
  dept: 'comp_create_group',
  team: 'comp_group',
  writer: 'comp_create_user',
  address: 'comp_req_adr',
  content: 'comp_contents',
  state: 'comp_state',
  result: 'comp_req_contents',
  cat: 'comp_cat',
  stat: 'comp_stat_item',
  hasChild: false,
}

export const WATER_COMPLAINT_PROFILES: Record<string, WaterComplaintColumns> = {
  uiseong_complaint_wtl: WTL_LIKE,
  complaint_sply: { ...WTL_LIKE, stat: null },
  complaint_swl: {
    name: 'co_name',
    tel: 'co_tel',
    date: 'comp_create_date',
    dept: 'comp_create_group',
    team: 'co_emd',
    writer: 'comp_create_user',
    address: 'co_addr',
    content: 'co_contents',
    state: 'comp_state',
    result: 'co_result',
    cat: null,
    stat: null,
    hasChild: false,
  },
  complaint_dre: {
    name: 'dre_name',
    tel: 'dre_tel',
    date: 'dre_ap_date',
    dept: 'comp_create_group',
    team: 'dre_comp',
    writer: 'comp_create_user',
    address: 'dre_addr',
    content: 'dre_remark',
    state: null,
    result: null,
    cat: null,
    stat: null,
    hasChild: true,
  },
}

export const DRE_DETAIL_TABLE = 'complaint_dre_detail'
export const DRE_DETAIL_KEY = 'dre_detail_key'
export const DRE_DETAIL_PARENT = 'dre_key'

export const DRE_DETAIL_FIELDS = [
  { key: 'jibun', column: 'jibun_solo', label: '지번' },
  { key: 'address', column: 'dre_addr_solo', label: '주소' },
  { key: 'name', column: 'dre_name_solo', label: '요청자' },
  { key: 'tel', column: 'dre_tel_solo', label: '전화' },
  { key: 'length', column: 'dre_length_solo', label: '연장(m)' },
  { key: 'count', column: 'dre_cnt_solo', label: '수량' },
  { key: 'company', column: 'dre_comp_solo', label: '업체' },
  { key: 'remark', column: 'dre_remark_solo', label: '비고' },
] as const

export type DreDetailFieldKey = (typeof DRE_DETAIL_FIELDS)[number]['key']

export type WaterComplaintProfile = WaterComplaintColumns & { table: string }

function resolveComplaintColumns(table: string): WaterComplaintColumns | null {
  const exact = WATER_COMPLAINT_PROFILES[table]
  if (exact) return exact
  if (table.includes('_detail')) return null
  // 레거시·마을민원(컬럼맵 다름) 제외. 상수는 uiseong_complaint_wtl
  if (table === 'complaint_wtl' || table === 'complaint_village_wtl') return null
  if (table.includes('complaint_sply') || table.endsWith('_sply')) return WTL_LIKE
  if (table.includes('complaint_wtl') || (table.includes('complaint') && table.endsWith('_wtl'))) {
    return WTL_LIKE
  }
  if (table.includes('complaint_swl') || (table.includes('complaint') && table.endsWith('_swl'))) {
    return WATER_COMPLAINT_PROFILES.complaint_swl
  }
  if (table.includes('complaint_dre') && !table.includes('detail')) {
    return WATER_COMPLAINT_PROFILES.complaint_dre
  }
  return null
}

export function waterComplaintProfile(tableName: string | null | undefined): WaterComplaintProfile | null {
  const table = String(tableName ?? '').trim().toLowerCase()
  const columns = resolveComplaintColumns(table)
  if (!columns) return null
  return { table, ...columns }
}
