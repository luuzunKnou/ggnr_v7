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
  'wtl_wtsa_as',
  'wtl_wtssa_as',
  'wtl_wtsba_as',
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
  {
    key: 'wtl_wtsa_as',
    table: 'wtl_wtsa_as',
    defineTable: 'wtl_wtsa_as',
    geomKind: 'area',
    nameExpr: `COALESCE(NULLIF(trim(wsg_nam),''), NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`,
    diameterCol: null,
    materialCol: null,
    lengthCol: null,
    yearCol: null,
    hasHjd: false,
  },
  {
    key: 'wtl_wtssa_as',
    table: 'wtl_wtssa_as',
    defineTable: 'wtl_wtssa_as',
    geomKind: 'area',
    nameExpr: `COALESCE(NULLIF(trim(wsb_nam),''), NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`,
    diameterCol: null,
    materialCol: null,
    lengthCol: null,
    yearCol: null,
    hasHjd: false,
  },
  {
    key: 'wtl_wtsba_as',
    table: 'wtl_wtsba_as',
    defineTable: 'wtl_wtsba_as',
    geomKind: 'area',
    nameExpr: `COALESCE(NULLIF(trim(wbb_nam),''), NULLIF(trim(ftr_idn::text),''), ogc_fid::text)`,
    diameterCol: null,
    materialCol: null,
    lengthCol: null,
    yearCol: null,
    hasHjd: false,
  },
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
  /** UI에서 고른 재질 라벨(한글·«기타»). 코드 매핑은 materialLabelToCodes */
  materials?: readonly string[]
  materialLabelToCodes?: Readonly<Record<string, readonly string[]>>
  materialTopCodes?: readonly string[]
  keyword?: string
  /** 급수블록명 — 급수블록 레이어는 wbb_nam 속성필터(경계 접침 INTERSECTS 오탐 방지·저부하) */
  supplyBlock?: string | null
  /** EPSG:5181 WKT — 읍면동·리·급수블록 등. 여러 개면 AND */
  areaWkts5181?: readonly string[] | null
}

function isWtlSupplyBlockLayerDef(def: WtlNetLayerDef): boolean {
  const names = [def.key, def.table, def.defineTable]
    .map((v) => String(v ?? '').trim().toLowerCase())
    .filter(Boolean)
  return names.some((n) => n === 'wtl_wtsba_as' || n.endsWith('_wtl_wtsba_as'))
}

/** 급수구역·급수분구 — 블록/행정경계보다 커 WITHIN(구역⊂필터)이면 탈락 → INTERSECTS·포함 관계 사용 */
export function isWtlSupplyZoneOrSubzoneLayerDef(def: WtlNetLayerDef): boolean {
  const names = [def.key, def.table, def.defineTable]
    .map((v) => String(v ?? '').trim().toLowerCase())
    .filter(Boolean)
  return names.some(
    (n) =>
      n === 'wtl_wtsa_as' ||
      n.endsWith('_wtl_wtsa_as') ||
      n === 'wtl_wtssa_as' ||
      n.endsWith('_wtl_wtssa_as')
  )
}

function escCql(s: string): string {
  return String(s).replace(/'/g, "''")
}

/** 급수구역·분구·블록 — 출처 그룹 밖, 지하시설물 동기화·슬롯 단일화용 */
export const WTL_NET_ZONE_LAYER_KEYS = [
  'wtl_wtsa_as',
  'wtl_wtssa_as',
  'wtl_wtsba_as',
] as const

export function isWtlNetZoneLayerKey(key: string): boolean {
  const k = String(key ?? '').trim().toLowerCase()
  return (WTL_NET_ZONE_LAYER_KEYS as readonly string[]).some((z) => z === k)
}

/** 지하 레이어 tableName ↔ 켜진 관망 키 매칭 (remap·saa 분할 포함) */
export function matchWtlNetLayerDefForTable(
  tableName: string,
  activeKeys: ReadonlySet<string>
): WtlNetLayerDef | undefined {
  const t = String(tableName ?? '')
    .trim()
    .toLowerCase()
  if (!t) return undefined
  for (const key of activeKeys) {
    const def = getWtlNetLayerDef(key)
    if (!def) continue
    if (key.toLowerCase() === t) return def
    const defineTable = String(def.defineTable ?? '')
      .trim()
      .toLowerCase()
    if (defineTable && defineTable === t) return def
    const base = String(def.table ?? '')
      .trim()
      .toLowerCase()
    if (!base) continue
    if (base === t || t.endsWith(`_${base}`) || t.endsWith(base)) return def
  }
  return undefined
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

  const supplyBlock = String(filter.supplyBlock ?? '').trim()
  if (supplyBlock && isWtlSupplyBlockLayerDef(def)) {
    // 속성 일치 — 인접 블록이 경계만 맞닿아 INTERSECTS로 남는 문제·WKT 부하 회피
    parts.push(`wbb_nam='${escCql(supplyBlock)}'`)
  } else {
    const areaWkts = (filter.areaWkts5181 ?? [])
      .map((raw) => String(raw ?? '').trim())
      .filter(Boolean)
    if (isWtlSupplyZoneOrSubzoneLayerDef(def) && areaWkts.length > 0) {
      // 구역·분구는 블록보다 큼 → WITHIN(구역⊂블록) 불가.
      // Shell 적재 순서: [행정경계?] + [급수블록?] — 블록 선택 시 마지막 WKT가 블록.
      if (supplyBlock) {
        for (const wkt of areaWkts.slice(0, -1)) {
          parts.push(`INTERSECTS(geom, ${wkt})`)
        }
        parts.push(`CONTAINS(geom, ${areaWkts[areaWkts.length - 1]})`)
      } else {
        for (const wkt of areaWkts) {
          parts.push(`INTERSECTS(geom, ${wkt})`)
        }
      }
    } else {
      for (const wkt of areaWkts) {
        // WITHIN: 경계만 접한 도형 제외 (관로·시설)
        parts.push(`WITHIN(geom, ${wkt})`)
      }
    }
  }

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
    // 목록 SQL(buildMaterialWhere)과 동일 — 한글 라벨 → mop_cde, «기타»=상위 제외
    const labelMap = filter.materialLabelToCodes ?? {}
    const topCodes = (filter.materialTopCodes ?? [])
      .map((c) => String(c).trim())
      .filter(Boolean)
    const codes = new Set<string>()
    let wantOther = false
    for (const raw of mats) {
      if (raw === '기타') {
        wantOther = true
        continue
      }
      const mapped = labelMap[raw]
      if (mapped && mapped.length > 0) {
        for (const c of mapped) {
          const code = String(c).trim()
          if (code) codes.add(code)
        }
      } else {
        codes.add(raw)
      }
    }
    const orParts: string[] = []
    if (codes.size > 0) {
      const list = [...codes].map((c) => `'${escCql(c)}'`).join(',')
      orParts.push(`${mopCol} IN (${list})`)
    }
    if (wantOther && topCodes.length > 0) {
      const topList = topCodes.map((c) => `'${escCql(c)}'`).join(',')
      orParts.push(`(${mopCol} IS NULL OR ${mopCol} NOT IN (${topList}))`)
    }
    if (orParts.length === 1) parts.push(orParts[0]!)
    else if (orParts.length > 1) parts.push(`(${orParts.join(' OR ')})`)
  }

  const kw = String(filter.keyword ?? '').trim()
  if (kw) {
    const like = `'%${escCql(kw)}%'`
    const ors: string[] = []
    // nameExpr 기본·ftr_idn 포함 레이어만 — wtl_pipe_ps 등 컬럼 없는 테이블 제외
    const nameExpr = def.nameExpr
    if (nameExpr == null || /\bftr_idn\b/i.test(nameExpr)) {
      ors.push(`strToLowerCase(ftr_idn) LIKE strToLowerCase(${like})`)
    }
    if (dipCol) ors.push(`strToLowerCase(${dipCol}) LIKE strToLowerCase(${like})`)
    if (mopCol) ors.push(`strToLowerCase(${mopCol}) LIKE strToLowerCase(${like})`)
    if (ors.length > 0) parts.push(`(${ors.join(' OR ')})`)
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
