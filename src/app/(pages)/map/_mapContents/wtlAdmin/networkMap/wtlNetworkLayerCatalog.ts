import { getWtlNetMapSource, getWtlNetMapSources } from './wtlNetworkMapSources'

/** 관망조회 표시명 ↔ layer 스키마 테이블·용도 조건 */

/** key = tables.json define_table_kor_name */
export const WTL_NET_LAYER_KEYS = [
  '상수관로(기타)',
  '배수관로',
  '송수관로',
  '급수관로',
  '변류시설',
  '상수맨홀',
  '취수장',
  '정수장',
  '배수지',
  '가압장',
  '저수조',
  '소방시설',
  '유량계',
  '수압계',
  '급수구역',
  '급수분구',
  '급수블록',
  '급수전계량기',
  '상수원 보호구역',
  '공장설립 제한지역',
  '상수관로 심도',
  '누수지점 및 복구내역',
  '상수 업데이트 내역',
] as const

export type WtlNetLayerKey = (typeof WTL_NET_LAYER_KEYS)[number]

export type WtlNetGeomKind = 'line' | 'point' | 'area'

export type WtlNetLayerDef = {
  key: WtlNetLayerKey
  /** 물리 조회 테이블 (관로 분할은 wtl_pipe_lm + saa) */
  table: string | null
  /** tables.json define_table_name (표시·정렬 메타) */
  defineTable?: string | null
  geomKind: WtlNetGeomKind
  /** wtl_pipe_lm 용도 코드. null=전체, 'other'=배수·송수·급수 제외 */
  saa?: 'SAA003' | 'SAA004' | 'SAA005' | 'other' | null
  /** 목록 표시 칼럼 (없으면 공통 기본) */
  nameExpr?: string
  diameterCol?: string | null
  materialCol?: string | null
  lengthCol?: string | null
  yearCol?: string | null
  /** false면 hjd_cde 없음 */
  hasHjd?: boolean
}

/** 배수·송수·급수 외 관로 */
const PIPE_OTHER_SAA = `COALESCE(saa_cde,'') NOT IN ('SAA003','SAA004','SAA005')`

export const WTL_NET_LAYER_DEFS: readonly WtlNetLayerDef[] = [
  {
    key: '상수관로(기타)',
    table: 'wtl_pipe_lm',
    defineTable: 'wtl_pipe_lm_etc',
    geomKind: 'line',
    saa: 'other',
    nameExpr: `COALESCE(NULLIF(trim(pip_lbl),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    diameterCol: 'std_dip',
    materialCol: 'mop_cde',
    lengthCol: 'byc_len',
    yearCol: 'ist_ymd',
  },
  {
    key: '배수관로',
    table: 'wtl_pipe_lm',
    defineTable: 'wtl_pipe_lm_saa004',
    geomKind: 'line',
    saa: 'SAA004',
    nameExpr: `COALESCE(NULLIF(trim(pip_lbl),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    diameterCol: 'std_dip',
    materialCol: 'mop_cde',
    lengthCol: 'byc_len',
    yearCol: 'ist_ymd',
  },
  {
    key: '송수관로',
    table: 'wtl_pipe_lm',
    defineTable: 'wtl_pipe_lm_saa003',
    geomKind: 'line',
    saa: 'SAA003',
    nameExpr: `COALESCE(NULLIF(trim(pip_lbl),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    diameterCol: 'std_dip',
    materialCol: 'mop_cde',
    lengthCol: 'byc_len',
    yearCol: 'ist_ymd',
  },
  {
    key: '급수관로',
    table: 'wtl_sply_ls',
    defineTable: 'wtl_sply_ls',
    geomKind: 'line',
    saa: null,
    nameExpr: `COALESCE(NULLIF(trim(pip_lbl),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    diameterCol: 'std_dip',
    materialCol: 'mop_cde',
    lengthCol: 'byc_len',
    yearCol: 'ist_ymd',
  },
  {
    key: '변류시설',
    table: 'wtl_valv_ps',
    defineTable: 'wtl_valv_ps',
    geomKind: 'point',
    nameExpr: `COALESCE(NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    diameterCol: 'std_dip',
    materialCol: 'mop_cde',
    lengthCol: null,
    yearCol: 'ist_ymd',
  },
  {
    key: '상수맨홀',
    table: 'wtl_manh_ps',
    defineTable: 'wtl_manh_ps',
    geomKind: 'point',
    nameExpr: `COALESCE(NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    diameterCol: null,
    materialCol: null,
    lengthCol: null,
    yearCol: 'ist_ymd',
  },
  {
    key: '취수장',
    table: 'wtl_gain_ps',
    defineTable: 'wtl_gain_ps',
    geomKind: 'area',
    nameExpr: `COALESCE(NULLIF(trim(gai_nam),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    diameterCol: null,
    materialCol: null,
    lengthCol: null,
    yearCol: 'fns_ymd',
  },
  {
    key: '정수장',
    table: 'wtl_puri_as',
    defineTable: 'wtl_puri_as',
    geomKind: 'area',
    nameExpr: `COALESCE(NULLIF(trim(pur_nam),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    diameterCol: null,
    materialCol: null,
    lengthCol: null,
    yearCol: 'fns_ymd',
  },
  {
    key: '배수지',
    table: 'wtl_serv_ps',
    defineTable: 'wtl_serv_ps',
    geomKind: 'area',
    nameExpr: `COALESCE(NULLIF(trim(srv_nam),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    diameterCol: null,
    materialCol: null,
    lengthCol: null,
    yearCol: 'fns_ymd',
  },
  {
    key: '가압장',
    table: 'wtl_pres_ps',
    defineTable: 'wtl_pres_ps',
    geomKind: 'area',
    nameExpr: `COALESCE(NULLIF(trim(prs_nam),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    diameterCol: null,
    materialCol: null,
    lengthCol: null,
    yearCol: 'fns_ymd',
  },
  { key: '저수조', table: 'wtl_rsrv_ps', defineTable: 'wtl_rsrv_ps', geomKind: 'point' },
  {
    key: '소방시설',
    table: 'wtl_fire_ps',
    defineTable: 'wtl_fire_ps',
    geomKind: 'point',
    nameExpr: `COALESCE(NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    diameterCol: 'std_dip',
    materialCol: 'mof_cde',
    lengthCol: null,
    yearCol: 'ist_ymd',
  },
  {
    key: '유량계',
    table: 'wtl_flow_ps',
    defineTable: 'wtl_flow_ps',
    geomKind: 'point',
    nameExpr: `COALESCE(NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    diameterCol: 'std_dip',
    materialCol: 'mof_cde',
    lengthCol: null,
    yearCol: 'ist_ymd',
  },
  {
    key: '수압계',
    table: 'wtl_prga_ps',
    defineTable: 'wtl_prga_ps',
    geomKind: 'point',
    nameExpr: `COALESCE(NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    diameterCol: 'std_dip',
    materialCol: 'mof_cde',
    lengthCol: null,
    yearCol: 'ist_ymd',
  },
  { key: '급수구역', table: null, geomKind: 'area' },
  { key: '급수분구', table: null, geomKind: 'area' },
  { key: '급수블록', table: null, geomKind: 'area' },
  {
    key: '급수전계량기',
    table: 'wtl_meta_ps',
    defineTable: 'wtl_meta_ps',
    geomKind: 'point',
    nameExpr: `COALESCE(NULLIF(trim(met_num),''), NULLIF(trim(hom_num),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    diameterCol: 'met_dip',
    materialCol: 'mof_cde',
    lengthCol: null,
    yearCol: 'ist_ymd',
  },
  { key: '상수원 보호구역', table: null, geomKind: 'area' },
  { key: '공장설립 제한지역', table: null, geomKind: 'area' },
  {
    key: '상수관로 심도',
    table: 'wtl_pipe_ps',
    defineTable: 'wtl_pipe_ps',
    geomKind: 'point',
    nameExpr: `ogc_fid::text`,
    diameterCol: null,
    materialCol: null,
    lengthCol: null,
    yearCol: null,
    hasHjd: false,
  },
  {
    key: '누수지점 및 복구내역',
    table: 'wtl_leak_ps',
    defineTable: 'wtl_leak_ps',
    geomKind: 'point',
    nameExpr: `COALESCE(NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    diameterCol: 'std_dip',
    materialCol: 'mop_cde',
    lengthCol: null,
    yearCol: 'lek_ymd',
  },
  {
    key: '상수 업데이트 내역',
    table: 'wtl_task_as',
    defineTable: 'wtl_task_as',
    geomKind: 'area',
    nameExpr: `COALESCE(NULLIF(trim(cons_name),''), NULLIF(trim(cons_code),''), ogc_fid::text)`,
    diameterCol: null,
    materialCol: null,
    lengthCol: null,
    yearCol: 'jb_date',
    hasHjd: false,
  },
]

const DEF_BY_KEY = new Map(WTL_NET_LAYER_DEFS.map((d) => [d.key, d]))

export function getWtlNetLayerDef(key: string): WtlNetLayerDef | undefined {
  return DEF_BY_KEY.get(key as WtlNetLayerKey)
}

/** 켜진 표시명·관망도 출처 → GeoServer 레이어명(테이블) + CQL */
export function resolveWtlNetWmsLayers(
  keys: Iterable<string>,
  sourceIds?: Iterable<string>
): {
  layers: string[]
  cql: string[]
} {
  const fallbackIds = getWtlNetMapSources().map((s) => s.id)
  const sources = [...(sourceIds ?? fallbackIds)]
    .map((id) => getWtlNetMapSource(id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
  const activeSources = sources.length > 0 ? sources : getWtlNetMapSources()

  const layers: string[] = []
  const cql: string[] = []
  const seen = new Set<string>()
  for (const source of activeSources) {
    for (const key of keys) {
      const def = getWtlNetLayerDef(key)
      if (!def?.table) continue
      const table = source.remapTable(def.table).toLowerCase()
      let filter = 'INCLUDE'
      if (def.saa === 'other') filter = PIPE_OTHER_SAA
      else if (def.saa) filter = `saa_cde='${def.saa}'`
      const slot = `${table}::${filter}`
      if (seen.has(slot)) continue
      seen.add(slot)
      layers.push(table)
      cql.push(filter)
    }
  }
  return { layers, cql }
}

export function wtlNetSaaSql(def: WtlNetLayerDef): string | null {
  if (def.saa === 'other') return PIPE_OTHER_SAA
  if (def.saa) return `saa_cde = '${def.saa}'`
  return null
}
