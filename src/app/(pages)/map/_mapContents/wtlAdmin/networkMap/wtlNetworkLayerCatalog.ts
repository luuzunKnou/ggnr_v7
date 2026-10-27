import { getWtlNetMapSource, getWtlNetMapSources } from './wtlNetworkMapSources'

/** ê´ë§ì¡°í íìëª â layer ì¤í¤ë§ íì´ë¸Â·ì©ë ì¡°ê±´ */

/** key = tables.json define_table_name (ìë¬¸ì). ë¯¸ë±ë¡ í­ëª©ì íì í¤ */
export const WTL_NET_LAYER_KEYS = [
  'wtl_pipe_lm_etc',
  'wtl_pipe_lm_saa004',
  'wtl_pipe_lm_saa003',
  'wtl_sply_ls',
  'wtl_valv_ps',
  'wtl_manh_ps',
  'wtl_gain_ps',
  'wtl_puri_as',
  'wtl_serv_ps',
  'wtl_pres_ps',
  'wtl_rsrv_ps',
  'wtl_fire_ps',
  'wtl_flow_ps',
  'wtl_prga_ps',
  'ê¸ìêµ¬ì­',
  'ê¸ìë¶êµ¬',
  'ê¸ìë¸ë¡',
  'wtl_meta_ps',
  'ììì ë³´í¸êµ¬ì­',
  'ê³µì¥ì¤ë¦½ ì íì§ì­',
  'wtl_pipe_ps',
  'wtl_leak_ps',
  'wtl_task_as',
] as const

export type WtlNetLayerKey = (typeof WTL_NET_LAYER_KEYS)[number]

export type WtlNetGeomKind = 'line' | 'point' | 'area'

export type WtlNetLayerDef = {
  key: WtlNetLayerKey
  /** ë¬¼ë¦¬ ì¡°í íì´ë¸ (ê´ë¡ ë¶í ì wtl_pipe_lm + saa) */
  table: string | null
  /** tables.json define_table_name (íìÂ·ì ë ¬ ë©í) */
  defineTable?: string | null
  geomKind: WtlNetGeomKind
  /** wtl_pipe_lm ì©ë ì½ë. null=ì ì²´, 'other'=ë°°ìÂ·ì¡ìÂ·ê¸ì ì ì¸ */
  saa?: 'SAA003' | 'SAA004' | 'SAA005' | 'other' | null
  /** ëª©ë¡ íì ì¹¼ë¼ (ìì¼ë©´ ê³µíµ ê¸°ë³¸) */
  nameExpr?: string
  diameterCol?: string | null
  materialCol?: string | null
  lengthCol?: string | null
  yearCol?: string | null
  /** falseë©´ hjd_cde ìì */
  hasHjd?: boolean
}

/** ë°°ìÂ·ì¡ìÂ·ê¸ì ì¸ ê´ë¡ */
const PIPE_OTHER_SAA = `COALESCE(saa_cde,'') NOT IN ('SAA003','SAA004','SAA005')`

export const WTL_NET_LAYER_DEFS: readonly WtlNetLayerDef[] = [
  {
    key: 'wtl_pipe_lm_etc',
    table: 'wtl_pipe_lm',
    defineTable: 'wtl_pipe_lm_etc',
    geomKind: 'line',
    saa: 'other',
    nameExpr: `COALESCE(NULLIF(trim(pip_lbl),''), NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`,
    diameterCol: 'std_dip',
    materialCol: 'mop_cde',
    lengthCol: 'byc_len',
    yearCol: 'ist_ymd',
  },
  {
    key: 'wtl_pipe_lm_saa004',
    table: 'wtl_pipe_lm',
    defineTable: 'wtl_pipe_lm_saa004',
    geomKind: 'line',
    saa: 'SAA004',
    nameExpr: `COALESCE(NULLIF(trim(pip_lbl),''), NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`,
    diameterCol: 'std_dip',
    materialCol: 'mop_cde',
    lengthCol: 'byc_len',
    yearCol: 'ist_ymd',
  },
  {
    key: 'wtl_pipe_lm_saa003',
    table: 'wtl_pipe_lm',
    defineTable: 'wtl_pipe_lm_saa003',
    geomKind: 'line',
    saa: 'SAA003',
    nameExpr: `COALESCE(NULLIF(trim(pip_lbl),''), NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`,
    diameterCol: 'std_dip',
    materialCol: 'mop_cde',
    lengthCol: 'byc_len',
    yearCol: 'ist_ymd',
  },
  {
    key: 'wtl_sply_ls',
    table: 'wtl_sply_ls',
    defineTable: 'wtl_sply_ls',
    geomKind: 'line',
    saa: null,
    nameExpr: `COALESCE(NULLIF(trim(pip_lbl),''), NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`,
    diameterCol: 'std_dip',
    materialCol: 'mop_cde',
    lengthCol: 'byc_len',
    yearCol: 'ist_ymd',
  },
  {
    key: 'wtl_valv_ps',
    table: 'wtl_valv_ps',
    defineTable: 'wtl_valv_ps',
    geomKind: 'point',
    nameExpr: `COALESCE(NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`,
    diameterCol: 'std_dip',
    materialCol: 'mop_cde',
    lengthCol: null,
    yearCol: 'ist_ymd',
  },
  {
    key: 'wtl_manh_ps',
    table: 'wtl_manh_ps',
    defineTable: 'wtl_manh_ps',
    geomKind: 'point',
    nameExpr: `COALESCE(NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`,
    diameterCol: null,
    materialCol: null,
    lengthCol: null,
    yearCol: 'ist_ymd',
  },
  {
    key: 'wtl_gain_ps',
    table: 'wtl_gain_ps',
    defineTable: 'wtl_gain_ps',
    geomKind: 'area',
    nameExpr: `COALESCE(NULLIF(trim(gai_nam),''), NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`,
    diameterCol: null,
    materialCol: null,
    lengthCol: null,
    yearCol: 'fns_ymd',
  },
  {
    key: 'wtl_puri_as',
    table: 'wtl_puri_as',
    defineTable: 'wtl_puri_as',
    geomKind: 'area',
    nameExpr: `COALESCE(NULLIF(trim(pur_nam),''), NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`,
    diameterCol: null,
    materialCol: null,
    lengthCol: null,
    yearCol: 'fns_ymd',
  },
  {
    key: 'wtl_serv_ps',
    table: 'wtl_serv_ps',
    defineTable: 'wtl_serv_ps',
    geomKind: 'area',
    nameExpr: `COALESCE(NULLIF(trim(srv_nam),''), NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`,
    diameterCol: null,
    materialCol: null,
    lengthCol: null,
    yearCol: 'fns_ymd',
  },
  {
    key: 'wtl_pres_ps',
    table: 'wtl_pres_ps',
    defineTable: 'wtl_pres_ps',
    geomKind: 'area',
    nameExpr: `COALESCE(NULLIF(trim(prs_nam),''), NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`,
    diameterCol: null,
    materialCol: null,
    lengthCol: null,
    yearCol: 'fns_ymd',
  },
  { key: 'wtl_rsrv_ps', table: 'wtl_rsrv_ps', defineTable: 'wtl_rsrv_ps', geomKind: 'point' },
  {
    key: 'wtl_fire_ps',
    table: 'wtl_fire_ps',
    defineTable: 'wtl_fire_ps',
    geomKind: 'point',
    nameExpr: `COALESCE(NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`,
    diameterCol: 'std_dip',
    materialCol: 'mof_cde',
    lengthCol: null,
    yearCol: 'ist_ymd',
  },
  {
    key: 'wtl_flow_ps',
    table: 'wtl_flow_ps',
    defineTable: 'wtl_flow_ps',
    geomKind: 'point',
    nameExpr: `COALESCE(NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`,
    diameterCol: 'std_dip',
    materialCol: 'mof_cde',
    lengthCol: null,
    yearCol: 'ist_ymd',
  },
  {
    key: 'wtl_prga_ps',
    table: 'wtl_prga_ps',
    defineTable: 'wtl_prga_ps',
    geomKind: 'point',
    nameExpr: `COALESCE(NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`,
    diameterCol: 'std_dip',
    materialCol: 'mof_cde',
    lengthCol: null,
    yearCol: 'ist_ymd',
  },
  { key: 'ê¸ìêµ¬ì­', table: null, geomKind: 'area' },
  { key: 'ê¸ìë¶êµ¬', table: null, geomKind: 'area' },
  { key: 'ê¸ìë¸ë¡', table: null, geomKind: 'area' },
  {
    key: 'wtl_meta_ps',
    table: 'wtl_meta_ps',
    defineTable: 'wtl_meta_ps',
    geomKind: 'point',
    nameExpr: `COALESCE(NULLIF(trim(met_num),''), NULLIF(trim(hom_num),''), NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`,
    diameterCol: 'met_dip',
    materialCol: 'mof_cde',
    lengthCol: null,
    yearCol: 'ist_ymd',
  },
  { key: 'ììì ë³´í¸êµ¬ì­', table: null, geomKind: 'area' },
  { key: 'ê³µì¥ì¤ë¦½ ì íì§ì­', table: null, geomKind: 'area' },
  {
    key: 'wtl_pipe_ps',
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
    key: 'wtl_leak_ps',
    table: 'wtl_leak_ps',
    defineTable: 'wtl_leak_ps',
    geomKind: 'point',
    nameExpr: `COALESCE(NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`,
    diameterCol: 'std_dip',
    materialCol: 'mop_cde',
    lengthCol: null,
    yearCol: 'lek_ymd',
  },
  {
    key: 'wtl_task_as',
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

export type WtlNetWmsSearchFilter = {
  yearFrom?: number | null
  yearTo?: number | null
  diameterFrom?: number | null
  diameterTo?: number | null
  materials?: readonly string[]
  keyword?: string
}

function escCql(s: string): string {
  return String(s).replace(/'/g, "''")
}

/** 검색 조건 → 레이어별 ECQL 조각 (saa 조건과 AND) */
export function buildWtlNetSearchCql(
  def: WtlNetLayerDef,
  filter?: WtlNetWmsSearchFilter | null
): string {
  if (!filter) return 'INCLUDE'
  const parts: string[] = []
  const dipCol = def.diameterCol
  const mopCol = def.materialCol
  const yearCol = def.yearCol

  if (
    dipCol &&
    filter.diameterFrom != null &&
    filter.diameterTo != null &&
    Number.isFinite(filter.diameterFrom) &&
    Number.isFinite(filter.diameterTo)
  ) {
    const from = Number(filter.diameterFrom)
    const to = Number(filter.diameterTo)
    parts.push(
      `(${dipCol} IS NULL OR (${dipCol} >= ${from} AND ${dipCol} <= ${to}))`
    )
  }

  if (
    yearCol &&
    filter.yearFrom != null &&
    filter.yearTo != null &&
    Number.isFinite(filter.yearFrom) &&
    Number.isFinite(filter.yearTo)
  ) {
    const y0 = Math.trunc(Number(filter.yearFrom))
    const y1 = Math.trunc(Number(filter.yearTo))
    const lo = `'${y0}0101'`
    const hi = `'${y1}1231'`
    parts.push(`(${yearCol} IS NULL OR (${yearCol} >= ${lo} AND ${yearCol} <= ${hi}))`)
  }

  const mats = (filter.materials ?? []).map((m) => String(m).trim()).filter(Boolean)
  if (mopCol && mats.length > 0) {
    const list = mats.map((m) => `'${escCql(m)}'`).join(',')
    parts.push(`${mopCol} IN (${list})`)
  }

  const kw = String(filter.keyword ?? '').trim()
  if (kw) {
    const like = `'%${escCql(kw)}%'`
    const ors = [`strToLowerCase(ftr_idn) LIKE strToLowerCase(${like})`]
    if (dipCol) ors.push(`strToLowerCase(${dipCol}) LIKE strToLowerCase(${like})`)
    if (mopCol) ors.push(`strToLowerCase(${mopCol}) LIKE strToLowerCase(${like})`)
    parts.push(`(${ors.join(' OR ')})`)
  }

  if (parts.length === 0) return 'INCLUDE'
  return parts.join(' AND ')
}

/** 켜진 표시명·관망도 출처 → GeoServer 레이어명(테이블) + CQL */
export function resolveWtlNetWmsLayers(
  keys: Iterable<string>,
  sourceIds?: Iterable<string>,
  searchFilter?: WtlNetWmsSearchFilter | null
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
      const baseParts: string[] = []
      if (def.saa === 'other') baseParts.push(PIPE_OTHER_SAA)
      else if (def.saa) baseParts.push(`saa_cde='${def.saa}'`)
      const search = buildWtlNetSearchCql(def, searchFilter)
      if (search !== 'INCLUDE') baseParts.push(`(${search})`)
      const filter = baseParts.length === 0 ? 'INCLUDE' : baseParts.join(' AND ')
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
