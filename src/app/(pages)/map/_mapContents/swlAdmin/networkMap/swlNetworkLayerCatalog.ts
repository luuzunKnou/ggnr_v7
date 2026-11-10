/** 하수 관망조회 표시명 ↔ layer 스키마 테이블 */

export const SWL_NET_LAYER_KEYS = [
  '하수관거(기타)',
  '우수관',
  '오수관',
  '측구',
  '하수연결관',
  '배수설비',
  '배수설비구역',
  '하수맨홀',
  '물받이',
  '토구',
  '환기구',
  '우수토실',
  '하수펌프장',
  '하수처리장',
  '역사이펀',
  '집수정',
  '하수관거심도',
  '면형하수관거',
  '처리구역',
  '배수구역',
  '처리분구',
  '배수분구',
  '하수 업데이트 내역',
] as const

export type SwlNetLayerKey = (typeof SWL_NET_LAYER_KEYS)[number]

export type SwlNetGeomKind = 'line' | 'point' | 'area'

export type SwlNetLayerDef = {
  key: SwlNetLayerKey
  table: string
  geomKind: SwlNetGeomKind
  nameExpr: string
  diameterCol?: string | null
  materialCol?: string | null
  lengthCol?: string | null
  yearCol?: string | null
  hasHjd?: boolean
  /** null이면 관리번호 칼럼 없음 */
  idCol?: string | null
  /** 지도·범례에 쓰는 스타일 레이어. 없으면 table */
  wms?: string
  /** 같은 테이블을 용도로 나눌 때 */
  whereSql?: string
}

const ID = `COALESCE(NULLIF(trim(ftr_idn),''), ogc_fid::text)`
const PIPE_NAME = `COALESCE(NULLIF(trim(pip_lbl),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`

const PIPE_FIELDS = {
  table: 'swl_pipe_lm',
  geomKind: 'line' as const,
  nameExpr: PIPE_NAME,
  diameterCol: 'std_dip',
  materialCol: 'mop_cde',
  lengthCol: 'byc_len',
  yearCol: 'ist_ymd',
}

export const SWL_NET_LAYER_DEFS: readonly SwlNetLayerDef[] = [
  {
    key: '하수관거(기타)',
    ...PIPE_FIELDS,
    wms: 'swl_pipe_lm_etc',
    whereSql: `COALESCE(sba_cde,'') NOT IN ('SBA003','SBA004')`,
  },
  {
    key: '우수관',
    ...PIPE_FIELDS,
    wms: 'swl_pipe_lm_sba003',
    whereSql: `sba_cde = 'SBA003'`,
  },
  {
    key: '오수관',
    ...PIPE_FIELDS,
    wms: 'swl_pipe_lm_sba004',
    whereSql: `sba_cde = 'SBA004'`,
  },
  {
    key: '측구',
    table: 'swl_side_ls',
    geomKind: 'line',
    nameExpr: ID,
    diameterCol: 'std_dip',
    materialCol: 'mop_cde',
    lengthCol: 'byc_len',
    yearCol: 'ist_ymd',
  },
  {
    key: '하수연결관',
    table: 'swl_conn_ls',
    geomKind: 'line',
    nameExpr: `COALESCE(NULLIF(trim(pip_lbl),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    diameterCol: 'std_dip',
    materialCol: 'mop_cde',
    lengthCol: 'byc_len',
    yearCol: 'ist_ymd',
  },
  {
    key: '배수설비',
    table: 'swl_bssb_ps',
    geomKind: 'area',
    nameExpr: `COALESCE(NULLIF(trim(jibun),''), NULLIF(trim(own_name),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    hasHjd: false,
  },
  {
    key: '배수설비구역',
    table: 'swl_bssb_as',
    geomKind: 'area',
    nameExpr: `COALESCE(NULLIF(trim(cons_name),''), NULLIF(trim(remark),''), ogc_fid::text)`,
    hasHjd: false,
    idCol: null,
  },
  {
    key: '하수맨홀',
    table: 'swl_manh_ps',
    geomKind: 'point',
    nameExpr: ID,
    diameterCol: 'man_dip',
    materialCol: 'mop_cde',
    yearCol: 'ist_ymd',
  },
  {
    key: '물받이',
    table: 'swl_spot_ps',
    geomKind: 'point',
    nameExpr: ID,
    diameterCol: 'spt_dip',
    materialCol: 'mop_cde',
    yearCol: 'ist_ymd',
  },
  {
    key: '토구',
    table: 'swl_spew_ps',
    geomKind: 'point',
    nameExpr: ID,
    diameterCol: 'spw_dip',
    yearCol: 'ist_ymd',
  },
  {
    key: '환기구',
    table: 'swl_vent_ps',
    geomKind: 'point',
    nameExpr: ID,
    diameterCol: 'vnt_dip',
    materialCol: 'mop_cde',
    yearCol: 'ist_ymd',
  },
  {
    key: '우수토실',
    table: 'swl_clay_ps',
    geomKind: 'point',
    nameExpr: ID,
    yearCol: 'ist_ymd',
  },
  {
    key: '하수펌프장',
    table: 'swl_pump_ps',
    geomKind: 'area',
    nameExpr: `COALESCE(NULLIF(trim(pmp_nam),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    yearCol: 'ist_ymd',
  },
  {
    key: '하수처리장',
    table: 'swl_dran_ps',
    geomKind: 'point',
    nameExpr: `COALESCE(NULLIF(trim(drn_nam),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    yearCol: 'ist_ymd',
  },
  {
    key: '역사이펀',
    table: 'swl_rsph_ps',
    geomKind: 'point',
    nameExpr: ID,
    materialCol: 'mop_cde',
    lengthCol: 'sph_len',
    yearCol: 'ist_ymd',
  },
  {
    key: '집수정',
    table: 'swl_drwl_ps',
    geomKind: 'area',
    nameExpr: ID,
    yearCol: 'ist_ymd',
  },
  {
    key: '하수관거심도',
    table: 'swl_dept_ps',
    geomKind: 'point',
    nameExpr: `COALESCE(NULLIF(trim(pip_dep::text),''), ogc_fid::text)`,
    hasHjd: false,
    idCol: null,
  },
  {
    key: '면형하수관거',
    table: 'swl_pipe_as',
    geomKind: 'area',
    nameExpr: ID,
    hasHjd: false,
  },
  {
    key: '처리구역',
    table: 'swl_aodp_as',
    geomKind: 'area',
    nameExpr: `COALESCE(NULLIF(trim(adp_nam),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    yearCol: 'str_ymd',
    hasHjd: false,
  },
  {
    key: '배수구역',
    table: 'swl_aodr_as',
    geomKind: 'area',
    nameExpr: `COALESCE(NULLIF(trim(adr_nam),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    hasHjd: false,
  },
  {
    key: '처리분구',
    table: 'swl_dodp_as',
    geomKind: 'area',
    nameExpr: `COALESCE(NULLIF(trim(ddp_nam),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    hasHjd: false,
  },
  {
    key: '배수분구',
    table: 'swl_dodr_as',
    geomKind: 'area',
    nameExpr: `COALESCE(NULLIF(trim(ddr_nam),''), NULLIF(trim(ftr_idn),''), ogc_fid::text)`,
    hasHjd: false,
  },
  {
    key: '하수 업데이트 내역',
    table: 'swl_task_as',
    geomKind: 'area',
    nameExpr: `COALESCE(NULLIF(trim(cons_name),''), NULLIF(trim(busin_name),''), ogc_fid::text)`,
    yearCol: 'jb_date',
    hasHjd: false,
    idCol: null,
  },
]

const DEF_BY_KEY = new Map(SWL_NET_LAYER_DEFS.map((d) => [d.key, d]))

export function getSwlNetLayerDef(key: string): SwlNetLayerDef | undefined {
  return DEF_BY_KEY.get(key as SwlNetLayerKey)
}

export function swlNetStyleName(def: SwlNetLayerDef): string {
  return def.wms ?? def.table
}

/** 켜진 표시명 → GeoServer 레이어명 */
export function resolveSwlNetWmsLayers(keys: Iterable<string>): string[] {
  const layers: string[] = []
  const seen = new Set<string>()
  for (const key of keys) {
    const def = getSwlNetLayerDef(key)
    const name = def ? swlNetStyleName(def) : ''
    if (!name || seen.has(name)) continue
    seen.add(name)
    layers.push(name)
  }
  return layers
}
