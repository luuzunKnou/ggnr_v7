/**
 * 상하수도 업무 민원 — 테이블은 메뉴별로 다르고, 화면 항목은 민원관리와 같은 자리로 맞춘다.
 * 준설대상지는 complaint_dre.comp_key 에 붙는 하위 행이다.
 */
import { sql } from 'drizzle-orm'
import { db } from '@/database/db'
import { fetchCoordFromAddress } from '@/lib/vworldAddressServer'
import {
  deleteTableRowByKey,
  getEditableFieldDefinitions,
  getTableRowForEdit,
  insertTableRow,
  updateTableRowByKey,
} from '@/service/layerRowService'
import {
  complaintCategoryFromTableName,
  complaintMenuLabelForTable,
} from '@/lib/waterComplaintCategory'
import {
  DRE_DETAIL_FIELDS,
  DRE_DETAIL_KEY,
  DRE_DETAIL_PARENT,
  DRE_DETAIL_TABLE,
  waterComplaintProfile,
  type WaterComplaintProfile,
} from '@/service/waterAdminComplaintProfile'

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 200

export type WaterComplaintRow = {
  compKey: number
  compDate: string | null
  compCu: string | null
  compCt: string | null
  compCg: string | null
  compAdr: string | null
  compName: string | null
  compTel: string | null
  compContent: string | null
  /** 세부분류 (Field cat). 목록 #태그용 */
  compCat: string | null
  /** 통계분류 (Field stat). 목록 #태그용 */
  compStat: string | null
  compExtra: null
  latestState: string | null
  resultText: string | null
  extent3857?: [number, number, number, number] | null
  geomGeoJson4326?: Record<string, unknown> | null
  details?: WaterDreDetail[]
}

export type WaterComplaintListRow = WaterComplaintRow & { tableName: string }

export type WaterDreDetail = {
  detailKey: number
  jibun: string
  address: string
  name: string
  tel: string
  length: string
  count: string
  company: string
  remark: string
  extent3857: [number, number, number, number] | null
  geomGeoJson4326: Record<string, unknown> | null
}

type SaveFields = {
  compName?: string | null
  compTel?: string | null
  compDate?: string | null
  compCg?: string | null
  compCt?: string | null
  compCu?: string | null
  compAdr?: string | null
  compContent?: string | null
  latestState?: string | null
  resultText?: string | null
  lon?: number | string | null
  lat?: number | string | null
}

function requireProfile(tableName: string | null | undefined): WaterComplaintProfile {
  const profile = waterComplaintProfile(tableName)
  if (!profile) throw new Error('지원하지 않는 민원입니다.')
  return profile
}

function q(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('잘못된 항목명입니다.')
  return `"${name}"`
}

function emptyToNull(s: string | null | undefined): string | null {
  if (s == null) return null
  const t = String(s).trim()
  return t === '' ? null : t
}

function textCol(column: string | null, alias: string): string {
  if (!column) return `NULL::text AS ${alias}`
  return `${q(column)}::text AS ${alias}`
}

function parseLonLat(
  lon?: number | string | null,
  lat?: number | string | null
): { lon: number; lat: number } | null {
  if (lon == null || lat == null) return null
  if (typeof lon === 'string' && lon.trim() === '') return null
  if (typeof lat === 'string' && lat.trim() === '') return null
  const x = Number(lon)
  const y = Number(lat)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (x < -180 || x > 180 || y < -90 || y > 90) return null
  return { lon: x, lat: y }
}

async function wkt5181FromLonLat(lon: number, lat: number): Promise<string | null> {
  const res = await db.execute(
    sql`SELECT ST_AsText(ST_Transform(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326), 5181)) AS wkt`
  )
  const wkt = String((res.rows?.[0] as { wkt?: string } | undefined)?.wkt ?? '').trim()
  return wkt || null
}

async function resolveGeom(params: {
  address?: string | null
  lon?: number | string | null
  lat?: number | string | null
}): Promise<{ geomWkt5181: string | null; geomClear: boolean }> {
  const address = emptyToNull(params.address)
  let lonLat = parseLonLat(params.lon, params.lat)
  if (!lonLat && address) lonLat = await fetchCoordFromAddress(address)
  if (!lonLat) return { geomWkt5181: null, geomClear: true }
  const wkt = await wkt5181FromLonLat(lonLat.lon, lonLat.lat)
  if (!wkt) return { geomWkt5181: null, geomClear: true }
  return { geomWkt5181: wkt, geomClear: false }
}

function selectListSql(profile: WaterComplaintProfile): string {
  return [
    `${q('comp_key')}::int AS comp_key`,
    textCol(profile.name, 'comp_name'),
    textCol(profile.tel, 'comp_tel'),
    textCol(profile.date, 'comp_date'),
    textCol(profile.dept, 'comp_cg'),
    textCol(profile.team, 'comp_ct'),
    textCol(profile.writer, 'comp_cu'),
    textCol(profile.address, 'comp_adr'),
    textCol(profile.content, 'comp_content'),
    textCol(profile.cat, 'comp_cat'),
    textCol(profile.stat, 'comp_stat'),
    textCol(profile.state, 'latest_state'),
    textCol(profile.result, 'result_text'),
  ].join(', ')
}

function asText(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

function mapRow(raw: Record<string, unknown>): WaterComplaintRow {
  return {
    compKey: Number(raw.comp_key),
    compName: asText(raw.comp_name),
    compTel: asText(raw.comp_tel),
    compDate: asText(raw.comp_date),
    compCg: asText(raw.comp_cg),
    compCt: asText(raw.comp_ct),
    compCu: asText(raw.comp_cu),
    compAdr: asText(raw.comp_adr),
    compContent: asText(raw.comp_content),
    compCat: asText(raw.comp_cat),
    compStat: asText(raw.comp_stat),
    compExtra: null,
    latestState: asText(raw.latest_state),
    resultText: asText(raw.result_text),
  }
}

function valuesFromFields(profile: WaterComplaintProfile, fields: SaveFields, includeStateDefault: boolean) {
  const values: Record<string, unknown> = {}
  const put = (column: string | null, value: string | null | undefined, touched: boolean) => {
    if (!column || !touched) return
    values[column] = emptyToNull(value)
  }
  put(profile.name, fields.compName, fields.compName !== undefined)
  put(profile.tel, fields.compTel, fields.compTel !== undefined)
  put(profile.date, fields.compDate, fields.compDate !== undefined)
  put(profile.dept, fields.compCg, fields.compCg !== undefined)
  put(profile.team, fields.compCt, fields.compCt !== undefined)
  put(profile.writer, fields.compCu, fields.compCu !== undefined)
  put(profile.address, fields.compAdr, fields.compAdr !== undefined)
  put(profile.content, fields.compContent, fields.compContent !== undefined)
  put(profile.result, fields.resultText, fields.resultText !== undefined)
  if (profile.state && fields.latestState !== undefined) {
    values[profile.state] = emptyToNull(fields.latestState)
  } else if (profile.state && includeStateDefault) {
    values[profile.state] = '접수'
  }
  return values
}

function clampLimit(limit: unknown): number {
  let n = typeof limit === 'number' && limit > 0 ? limit : DEFAULT_LIMIT
  if (n > MAX_LIMIT) n = MAX_LIMIT
  return Math.floor(n)
}

function orderByDateThenKeySql(profile: WaterComplaintProfile): string {
  if (profile.date) {
    return `${q(profile.date)} DESC NULLS LAST, ${q('comp_key')} DESC`
  }
  return `${q('comp_key')} DESC`
}

export async function list(
  params: { tableName?: string; limit?: number; offset?: number; state?: string | null } = {}
) {
  const profile = requireProfile(params.tableName)
  const limit = clampLimit(params.limit)
  const offset = typeof params.offset === 'number' && params.offset >= 0 ? Math.floor(params.offset) : 0
  const state = String(params.state ?? '').trim() || null
  const from = `layer.${q(profile.table)}`
  const where = `WHERE 1=1${stateFilterSql(profile, state)}`
  const rowsRes = await db.execute(
    sql.raw(
      `SELECT ${selectListSql(profile)} FROM ${from} ${where} ORDER BY ${orderByDateThenKeySql(profile)} LIMIT ${limit} OFFSET ${offset}`
    )
  )
  const countRes = await db.execute(sql.raw(`SELECT count(*)::int AS total FROM ${from} ${where}`))
  const total = Number((countRes.rows?.[0] as { total?: unknown } | undefined)?.total ?? 0)
  const rows = (rowsRes.rows ?? []).map((row) => mapRow(row as Record<string, unknown>))
  return { rows, total }
}

function escLit(value: string): string {
  return value.replace(/'/g, "''")
}

/** 프로필이 참조하는 컬럼이 실제 테이블에 있는지 (잘린 shp 컬럼명 대장 제외) */
async function tableHasProfileColumns(tableName: string): Promise<boolean> {
  const profile = waterComplaintProfile(tableName)
  if (!profile) return false
  const required = [
    'comp_key',
    profile.name,
    profile.tel,
    profile.date,
    profile.dept,
    profile.team,
    profile.writer,
    profile.address,
    profile.content,
    profile.cat,
    profile.stat,
    profile.state,
    profile.result,
  ].filter((c): c is string => Boolean(c))
  const res = await db.execute(
    sql.raw(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'layer' AND table_name = '${escLit(profile.table)}'`
    )
  )
  const present = new Set(
    (res.rows ?? []).map((row) => String((row as { column_name?: unknown }).column_name ?? ''))
  )
  return required.every((col) => present.has(col))
}

async function filterTablesWithProfileColumns(names: string[]): Promise<string[]> {
  const out: string[] = []
  for (const name of names) {
    if (await tableHasProfileColumns(name)) out.push(name)
  }
  return out
}

/** layer 스키마 민원 대장 테이블 (detail·프로필 없음·컬럼 불일치 제외) */
export async function listAvailableComplaintTables(): Promise<{
  tables: { tableName: string; label: string; category: string | null }[]
}> {
  const res = await db.execute(sql.raw(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'layer'
      AND (table_name LIKE 'complaint_%' OR table_name LIKE '%complaint_%')
      AND table_name NOT LIKE '%_detail'
    ORDER BY table_name
  `))
  const tables: { tableName: string; label: string; category: string | null }[] = []
  for (const row of res.rows ?? []) {
    const tableName = String((row as { table_name?: unknown }).table_name ?? '').trim()
    if (!tableName || !waterComplaintProfile(tableName)) continue
    if (!(await tableHasProfileColumns(tableName))) continue
    const category = complaintCategoryFromTableName(tableName)
    tables.push({
      tableName,
      label: complaintMenuLabelForTable(tableName),
      category,
    })
  }
  return { tables }
}

function normalizeComplaintTableNames(tableNames: string[] | undefined): string[] {
  return (tableNames ?? [])
    .map((n) => String(n ?? '').trim().toLowerCase())
    .filter((n) => n && waterComplaintProfile(n))
}

/** 상태 필터. 접수=빈값·null 포함. 상태 컬럼 없는 대장은 필터 시 제외 */
function stateFilterSql(profile: WaterComplaintProfile, state: string | null | undefined): string {
  const s = String(state ?? '').trim()
  if (!s) return ''
  if (!profile.state) return ' AND FALSE'
  const col = `${q(profile.state)}::text`
  if (s === '접수') {
    return ` AND (NULLIF(BTRIM(${col}), '') IS NULL OR BTRIM(${col}) = '접수')`
  }
  return ` AND BTRIM(${col}) = '${escLit(s)}'`
}

/** 상세표시 Field 값 통합검색. geom·ogc_fid·id 제외 */
function detailFieldSearchSql(tableName: string, search: string | null | undefined): string {
  const raw = String(search ?? '').trim()
  if (!raw) return ''
  const needle = raw.startsWith('#') ? raw.slice(1).trim() : raw
  if (!needle) return ''
  const fields = getEditableFieldDefinitions({
    table: tableName,
    excludeFields: ['ogc_fid', 'id'],
  })
  if (fields.length === 0) return ' AND FALSE'
  const pattern = `%${escLit(needle)}%`
  const ors = fields.map((f) => `${q(f.field)}::text ILIKE '${pattern}'`)
  return ` AND (${ors.join(' OR ')})`
}

/** 목록 «접수일» 기간 = 프로필 날짜 컬럼. YYYY-MM-DD */
function createDateRangeSql(
  dateColumn: string | null | undefined,
  dateFrom?: string | null,
  dateTo?: string | null
): string {
  const from = String(dateFrom ?? '').trim().slice(0, 10)
  const to = String(dateTo ?? '').trim().slice(0, 10)
  if (!from && !to) return ''
  if (!dateColumn) return ' AND FALSE'
  const dayExpr = `LEFT(BTRIM(${q(dateColumn)}::text), 10)`
  let sqlPart = ` AND NULLIF(${dayExpr}, '') IS NOT NULL`
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    sqlPart += ` AND ${dayExpr} >= '${escLit(from)}'`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    sqlPart += ` AND ${dayExpr} <= '${escLit(to)}'`
  }
  return sqlPart
}

function combinedUnionSql(
  names: string[],
  state?: string | null,
  search?: string | null,
  dateFrom?: string | null,
  dateTo?: string | null
): string {
  return names
    .map((tableName) => {
      const profile = requireProfile(tableName)
      const dateSql = createDateRangeSql(profile.date, dateFrom, dateTo)
      return `(SELECT ${selectListSql(profile)}, '${profile.table}'::text AS source_table
              FROM layer.${q(profile.table)}
              WHERE 1=1${stateFilterSql(profile, state)}${detailFieldSearchSql(tableName, search)}${dateSql})`
    })
    .join(' UNION ALL ')
}

const COMBINED_ORDER_SQL =
  `NULLIF(BTRIM(comp_date), '') DESC NULLS LAST, comp_key DESC`

export async function listCombined(
  params: {
    tableNames?: string[]
    limit?: number
    offset?: number
    state?: string | null
    q?: string | null
    dateFrom?: string | null
    dateTo?: string | null
  } = {}
) {
  const names = await filterTablesWithProfileColumns(normalizeComplaintTableNames(params.tableNames))
  const limit = clampLimit(params.limit)
  const offset =
    typeof params.offset === 'number' && params.offset >= 0 ? Math.floor(params.offset) : 0
  const state = String(params.state ?? '').trim() || null
  const search = String(params.q ?? '').trim() || null
  const dateFrom = String(params.dateFrom ?? '').trim().slice(0, 10) || null
  const dateTo = String(params.dateTo ?? '').trim().slice(0, 10) || null
  if (names.length === 0) return { rows: [] as WaterComplaintListRow[], total: 0 }

  const unionSql = combinedUnionSql(names, state, search, dateFrom, dateTo)
  const countRes = await db.execute(sql.raw(`SELECT count(*)::int AS total FROM (${unionSql}) u`))
  const total = Number((countRes.rows?.[0] as { total?: unknown } | undefined)?.total ?? 0)
  const rowsRes = await db.execute(
    sql.raw(
      `SELECT * FROM (${unionSql}) u
       ORDER BY ${COMBINED_ORDER_SQL}
       LIMIT ${limit} OFFSET ${offset}`
    )
  )
  const rows: WaterComplaintListRow[] = (rowsRes.rows ?? []).map((row) => {
    const raw = row as Record<string, unknown>
    return {
      ...mapRow(raw),
      tableName: String(raw.source_table ?? '').trim().toLowerCase(),
    }
  })
  return { rows, total }
}

/** 통합 목록 정렬 기준 0-based 순위. 없으면 index=-1 */
export async function findCombinedRank(params: {
  tableNames?: string[]
  tableName?: string
  compKey?: number
  state?: string | null
  q?: string | null
  dateFrom?: string | null
  dateTo?: string | null
}) {
  const names = await filterTablesWithProfileColumns(normalizeComplaintTableNames(params.tableNames))
  const tableName = String(params.tableName ?? '').trim().toLowerCase()
  const compKey = Number(params.compKey)
  const state = String(params.state ?? '').trim() || null
  const search = String(params.q ?? '').trim() || null
  const dateFrom = String(params.dateFrom ?? '').trim().slice(0, 10) || null
  const dateTo = String(params.dateTo ?? '').trim().slice(0, 10) || null
  if (names.length === 0 || !tableName || !Number.isInteger(compKey) || compKey < 1) {
    return { index: -1, total: 0 }
  }
  const unionSql = combinedUnionSql(names, state, search, dateFrom, dateTo)
  const countRes = await db.execute(sql.raw(`SELECT count(*)::int AS total FROM (${unionSql}) u`))
  const total = Number((countRes.rows?.[0] as { total?: unknown } | undefined)?.total ?? 0)
  const rankRes = await db.execute(
    sql.raw(
      `SELECT rn::int AS rn FROM (
         SELECT source_table, comp_key,
                ROW_NUMBER() OVER (ORDER BY ${COMBINED_ORDER_SQL}) AS rn
         FROM (${unionSql}) u
       ) r
       WHERE source_table = '${escLit(tableName)}' AND comp_key = ${compKey}
       LIMIT 1`
    )
  )
  const rn = Number((rankRes.rows?.[0] as { rn?: unknown } | undefined)?.rn ?? 0)
  return { index: rn > 0 ? rn - 1 : -1, total }
}

function mergeExtents(
  acc: [number, number, number, number] | null,
  next: [number, number, number, number] | null
): [number, number, number, number] | null {
  if (!next) return acc
  if (!acc) return next
  return [
    Math.min(acc[0], next[0]),
    Math.min(acc[1], next[1]),
    Math.max(acc[2], next[2]),
    Math.max(acc[3], next[3]),
  ]
}

export async function getCombinedLayerExtent3857(params: { tableNames?: string[] } = {}) {
  const names = (params.tableNames ?? [])
    .map((n) => String(n ?? '').trim().toLowerCase())
    .filter((n) => n && waterComplaintProfile(n))
  let extent3857: [number, number, number, number] | null = null
  for (const tableName of names) {
    const part = await getLayerExtent3857({ tableName })
    extent3857 = mergeExtents(extent3857, part.extent3857 ?? null)
  }
  return { extent3857 }
}

async function readGeom(profile: WaterComplaintProfile, compKey: number) {
  const res = await db.execute(
    sql.raw(
      `SELECT ST_XMin(g)::float8 AS xmin, ST_YMin(g)::float8 AS ymin,
              ST_XMax(g)::float8 AS xmax, ST_YMax(g)::float8 AS ymax,
              ST_AsGeoJSON(ST_Transform(geom, 4326))::text AS gjson
       FROM (
         SELECT geom, ST_Transform(geom, 3857) AS g
         FROM layer.${q(profile.table)}
         WHERE ${q('comp_key')} = ${compKey} AND geom IS NOT NULL
       ) s`
    )
  )
  const row = res.rows?.[0] as
    | { xmin?: unknown; ymin?: unknown; xmax?: unknown; ymax?: unknown; gjson?: unknown }
    | undefined
  if (!row) return { extent3857: null, geomGeoJson4326: null }
  const nums = [row.xmin, row.ymin, row.xmax, row.ymax].map((v) => Number(v))
  const extent3857 =
    nums.length === 4 && nums.every((n) => Number.isFinite(n))
      ? (nums as [number, number, number, number])
      : null
  let geomGeoJson4326: Record<string, unknown> | null = null
  if (typeof row.gjson === 'string' && row.gjson.trim()) {
    try {
      const parsed = JSON.parse(row.gjson) as unknown
      if (parsed && typeof parsed === 'object') geomGeoJson4326 = parsed as Record<string, unknown>
    } catch {
      geomGeoJson4326 = null
    }
  }
  return { extent3857, geomGeoJson4326 }
}

function extentFromRow(raw: Record<string, unknown>): [number, number, number, number] | null {
  const nums = [raw.xmin, raw.ymin, raw.xmax, raw.ymax].map((value) => Number(value))
  if (nums.length !== 4 || !nums.every((n) => Number.isFinite(n))) return null
  return nums as [number, number, number, number]
}

function geomFromRow(raw: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof raw.gjson !== 'string' || !raw.gjson.trim()) return null
  try {
    const parsed = JSON.parse(raw.gjson) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

async function readDetails(compKey: number): Promise<WaterDreDetail[]> {
  const res = await db.execute(sql`
    SELECT "dre_detail_key"::int AS detail_key,
           "jibun_solo"::text AS jibun,
           "dre_addr_solo"::text AS address,
           "dre_name_solo"::text AS name,
           "dre_tel_solo"::text AS tel,
           "dre_length_solo"::text AS length,
           "dre_cnt_solo"::text AS count,
           "dre_comp_solo"::text AS company,
           "dre_remark_solo"::text AS remark,
           ST_XMin(ST_Transform(geom, 3857))::float8 AS xmin,
           ST_YMin(ST_Transform(geom, 3857))::float8 AS ymin,
           ST_XMax(ST_Transform(geom, 3857))::float8 AS xmax,
           ST_YMax(ST_Transform(geom, 3857))::float8 AS ymax,
           ST_AsGeoJSON(ST_Transform(geom, 4326))::text AS gjson
    FROM layer."complaint_dre_detail"
    WHERE "dre_key" = ${compKey}
    ORDER BY "dre_detail_key"
  `)
  return (res.rows ?? []).map((row) => {
    const raw = row as Record<string, unknown>
    return {
      detailKey: Number(raw.detail_key),
      jibun: asText(raw.jibun) ?? '',
      address: asText(raw.address) ?? '',
      name: asText(raw.name) ?? '',
      tel: asText(raw.tel) ?? '',
      length: asText(raw.length) ?? '',
      count: asText(raw.count) ?? '',
      company: asText(raw.company) ?? '',
      remark: asText(raw.remark) ?? '',
      extent3857: extentFromRow(raw),
      geomGeoJson4326: geomFromRow(raw),
    }
  })
}

export async function get(params: { tableName?: string; compKey?: number }) {
  const profile = requireProfile(params.tableName)
  const compKey = Number(params.compKey)
  if (!Number.isInteger(compKey) || compKey < 1) return null
  const res = await db.execute(
    sql.raw(
      `SELECT ${selectListSql(profile)} FROM layer.${q(profile.table)} WHERE ${q('comp_key')} = ${compKey} LIMIT 1`
    )
  )
  const raw = res.rows?.[0] as Record<string, unknown> | undefined
  if (!raw) return null
  const row = mapRow(raw)
  let geom = { extent3857: null as [number, number, number, number] | null, geomGeoJson4326: null as Record<string, unknown> | null }
  try {
    geom = await readGeom(profile, compKey)
  } catch {
    geom = { extent3857: null, geomGeoJson4326: null }
  }
  const details = profile.hasChild ? await readDetails(compKey) : undefined
  return { ...row, ...geom, details }
}

export async function getLayerExtent3857(params: { tableName?: string }) {
  const profile = requireProfile(params.tableName)
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT ST_XMin(e)::float8 AS xmin, ST_YMin(e)::float8 AS ymin,
                ST_XMax(e)::float8 AS xmax, ST_YMax(e)::float8 AS ymax
         FROM (
           SELECT ST_Extent(ST_Transform(geom, 3857)) AS e
           FROM layer.${q(profile.table)}
           WHERE geom IS NOT NULL
         ) s
         WHERE e IS NOT NULL`
      )
    )
    const row = res.rows?.[0] as { xmin?: unknown; ymin?: unknown; xmax?: unknown; ymax?: unknown } | undefined
    if (!row) return { extent3857: null }
    const extent = [row.xmin, row.ymin, row.xmax, row.ymax].map((v) => Number(v))
    if (extent.length !== 4 || !extent.every((n) => Number.isFinite(n))) return { extent3857: null }
    return { extent3857: extent as [number, number, number, number] }
  } catch {
    return { extent3857: null }
  }
}

export async function create(params: { tableName?: string } & SaveFields) {
  const profile = requireProfile(params.tableName)
  const geom = await resolveGeom({ address: params.compAdr, lon: params.lon, lat: params.lat })
  const inserted = await insertTableRow({
    table: profile.table,
    schema: 'layer',
    keyField: 'comp_key',
    values: valuesFromFields(profile, params, true),
    allowPhysicalColumns: true,
    geomWkt5181: geom.geomWkt5181,
  })
  if (!inserted.success) throw new Error(inserted.error ?? '등록에 실패했습니다.')
  const compKey = Number(inserted.keyValue)
  if (!Number.isInteger(compKey) || compKey < 1) return null
  return get({ tableName: profile.table, compKey })
}

export async function update(params: { tableName?: string; compKey?: number } & SaveFields) {
  const profile = requireProfile(params.tableName)
  const compKey = Number(params.compKey)
  if (!Number.isInteger(compKey) || compKey < 1) return null
  const changes = valuesFromFields(profile, params, false)
  const shouldSyncGeom = params.compAdr !== undefined || params.lon !== undefined || params.lat !== undefined
  let geomWkt5181: string | null = null
  let geomClear = false
  if (shouldSyncGeom) {
    const geom = await resolveGeom({ address: params.compAdr, lon: params.lon, lat: params.lat })
    geomWkt5181 = geom.geomWkt5181
    geomClear = geom.geomClear
  }
  if (Object.keys(changes).length === 0 && !shouldSyncGeom) {
    return get({ tableName: profile.table, compKey })
  }
  const updated = await updateTableRowByKey({
    table: profile.table,
    schema: 'layer',
    keyField: 'comp_key',
    keyValue: compKey,
    changes,
    allowPhysicalColumns: true,
    geomWkt5181,
    geomClear,
  })
  if (!updated.success) throw new Error(updated.error ?? '저장에 실패했습니다.')
  return get({ tableName: profile.table, compKey })
}

export async function remove(params: { tableName?: string; compKey?: number }) {
  const profile = requireProfile(params.tableName)
  const compKey = Number(params.compKey)
  if (!Number.isInteger(compKey) || compKey < 1) return { success: false }
  const deleted = await deleteTableRowByKey({
    table: profile.table,
    schema: 'layer',
    keyField: 'comp_key',
    keyValue: compKey,
    childTableNames: profile.hasChild ? [DRE_DETAIL_TABLE] : undefined,
    childParentField: profile.hasChild ? DRE_DETAIL_PARENT : undefined,
  })
  if (!deleted.success) throw new Error(deleted.error ?? '삭제에 실패했습니다.')
  return { success: true }
}

/** 공통UI Field 상세 — 원본 컬럼 + 지도용 extent/geom */
export async function getFieldDetail(params: { tableName?: string; compKey?: number }) {
  const profile = requireProfile(params.tableName)
  const compKey = Number(params.compKey)
  if (!Number.isInteger(compKey) || compKey < 1) {
    return { row: null as Record<string, string> | null, extent3857: null, geomGeoJson4326: null }
  }
  const edited = await getTableRowForEdit({
    table: profile.table,
    schema: 'layer',
    keyField: 'comp_key',
    keyValue: compKey,
  })
  if (!edited.row) {
    return { row: null, extent3857: null, geomGeoJson4326: null, error: edited.error }
  }
  let geom = {
    extent3857: null as [number, number, number, number] | null,
    geomGeoJson4326: null as Record<string, unknown> | null,
  }
  try {
    geom = await readGeom(profile, compKey)
  } catch {
    geom = { extent3857: null, geomGeoJson4326: null }
  }
  return { row: edited.row, ...geom }
}

function pickAddressFromValues(values: Record<string, string | null | undefined>): string | null {
  const preferred = [
    'comp_req_adr',
    'comp_req_adr_road',
    'co_addr',
    'dre_addr',
    'comp_adr',
    'address',
    'addr',
  ]
  for (const key of preferred) {
    const hit = emptyToNull(values[key])
    if (hit) return hit
  }
  for (const [key, val] of Object.entries(values)) {
    if (!/adr|addr|address|jibun|loc/i.test(key)) continue
    const hit = emptyToNull(val)
    if (hit) return hit
  }
  return null
}

/** 공통UI Field 상세 저장 — defineLayer 표시 항목 values 그대로 */
export async function saveFieldDetail(params: {
  tableName?: string
  compKey?: number | null
  values?: Record<string, string | null | undefined>
  lon?: number | string | null
  lat?: number | string | null
}) {
  const profile = requireProfile(params.tableName)
  const rawValues = params.values ?? {}
  const values: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(rawValues)) {
    const col = String(key ?? '').trim()
    if (!col || col.toLowerCase() === 'comp_key') continue
    values[col] = emptyToNull(val == null ? null : String(val))
  }
  const address = pickAddressFromValues(
    Object.fromEntries(
      Object.entries(rawValues).map(([k, v]) => [k, v == null ? null : String(v)])
    )
  )
  const geom = await resolveGeom({ address, lon: params.lon, lat: params.lat })
  const compKey = Number(params.compKey)
  if (Number.isInteger(compKey) && compKey > 0) {
    const updated = await updateTableRowByKey({
      table: profile.table,
      schema: 'layer',
      keyField: 'comp_key',
      keyValue: compKey,
      changes: values,
      allowPhysicalColumns: true,
      geomWkt5181: geom.geomWkt5181,
      geomClear: geom.geomClear,
    })
    if (!updated.success) throw new Error(updated.error ?? '저장에 실패했습니다.')
    return getFieldDetail({ tableName: profile.table, compKey })
  }
  const inserted = await insertTableRow({
    table: profile.table,
    schema: 'layer',
    keyField: 'comp_key',
    values,
    allowPhysicalColumns: true,
    geomWkt5181: geom.geomWkt5181,
  })
  if (!inserted.success) throw new Error(inserted.error ?? '등록에 실패했습니다.')
  const newKey = Number(inserted.keyValue)
  if (!Number.isInteger(newKey) || newKey < 1) return { row: null, extent3857: null, geomGeoJson4326: null }
  return getFieldDetail({ tableName: profile.table, compKey: newKey })
}

function detailValues(fields: Partial<Record<(typeof DRE_DETAIL_FIELDS)[number]['key'], string | null>>) {
  const values: Record<string, unknown> = {}
  for (const field of DRE_DETAIL_FIELDS) {
    if (fields[field.key] === undefined) continue
    values[field.column] = emptyToNull(fields[field.key])
  }
  return values
}

export async function saveDetail(params: {
  compKey?: number
  detailKey?: number | null
  jibun?: string | null
  address?: string | null
  name?: string | null
  tel?: string | null
  length?: string | null
  count?: string | null
  company?: string | null
  remark?: string | null
  lon?: number | string | null
  lat?: number | string | null
}) {
  const compKey = Number(params.compKey)
  if (!Number.isInteger(compKey) || compKey < 1) throw new Error('준설민원을 먼저 저장하세요.')
  const values = detailValues(params)
  values[DRE_DETAIL_PARENT] = compKey
  const geom = await resolveGeom({ address: params.address, lon: params.lon, lat: params.lat })
  const detailKey = Number(params.detailKey)
  if (Number.isInteger(detailKey) && detailKey > 0) {
    const updated = await updateTableRowByKey({
      table: DRE_DETAIL_TABLE,
      schema: 'layer',
      keyField: DRE_DETAIL_KEY,
      keyValue: detailKey,
      changes: values,
      allowPhysicalColumns: true,
      geomWkt5181: geom.geomWkt5181,
      geomClear: params.address !== undefined && geom.geomClear,
    })
    if (!updated.success) throw new Error(updated.error ?? '대상지 저장에 실패했습니다.')
  } else {
    const inserted = await insertTableRow({
      table: DRE_DETAIL_TABLE,
      schema: 'layer',
      keyField: DRE_DETAIL_KEY,
      values,
      allowPhysicalColumns: true,
      geomWkt5181: geom.geomWkt5181,
    })
    if (!inserted.success) throw new Error(inserted.error ?? '대상지 등록에 실패했습니다.')
  }
  return readDetails(compKey)
}

export async function removeDetail(params: { compKey?: number; detailKey?: number }) {
  const compKey = Number(params.compKey)
  const detailKey = Number(params.detailKey)
  if (!Number.isInteger(detailKey) || detailKey < 1) throw new Error('대상지를 찾을 수 없습니다.')
  const deleted = await deleteTableRowByKey({
    table: DRE_DETAIL_TABLE,
    schema: 'layer',
    keyField: DRE_DETAIL_KEY,
    keyValue: detailKey,
  })
  if (!deleted.success) throw new Error(deleted.error ?? '대상지 삭제에 실패했습니다.')
  if (!Number.isInteger(compKey) || compKey < 1) return []
  return readDetails(compKey)
}

/** layer.compd 와 동일 컬럼 + source_table. layer.comp FK 없음 (통합UI 대장 키용 임시) */
const COMPD_TEMP_SQL = `
CREATE TABLE IF NOT EXISTS layer.compd_temp (
  compd_key SERIAL PRIMARY KEY,
  comp_key integer NOT NULL,
  source_table varchar NOT NULL,
  compd_date timestamp,
  compd_cu varchar,
  compd_ct varchar,
  compd_cg varchar,
  compd_state varchar,
  compd_contents varchar,
  compd_extra json
);
CREATE INDEX IF NOT EXISTS compd_temp_comp_key_idx ON layer.compd_temp (comp_key);
CREATE INDEX IF NOT EXISTS compd_temp_src_key_idx ON layer.compd_temp (source_table, comp_key);
DROP INDEX IF EXISTS layer.compd_temp_src_state_uidx;
COMMENT ON TABLE layer.compd_temp IS '민원 처리내역(통합UI 이관 임시)';
`

async function layerColumnExists(table: string, column: string): Promise<boolean> {
  const res = await db.execute(
    sql.raw(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'layer'
         AND lower(table_name) = '${escLit(table.toLowerCase())}'
         AND lower(column_name) = '${escLit(column.toLowerCase())}'
       LIMIT 1`
    )
  )
  return (res.rows?.length ?? 0) > 0
}

function asDateOrNull(v: unknown): string | null {
  const s = emptyToNull(v == null ? null : String(v))
  if (!s) return null
  const d = s.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
}

async function ensureCompdTempTable() {
  await db.execute(sql.raw(COMPD_TEMP_SQL))
}

function mapCompdTempRow(raw: Record<string, unknown>) {
  const extra = raw.compd_extra
  return {
    compdKey: Number(raw.compd_key),
    compKey: Number(raw.comp_key),
    sourceTable: asText(raw.source_table),
    compdDate: asText(raw.compd_date),
    compdCu: asText(raw.compd_cu),
    compdCt: asText(raw.compd_ct),
    compdCg: asText(raw.compd_cg),
    compdState: asText(raw.compd_state),
    compdContents: asText(raw.compd_contents),
    compdExtra:
      extra && typeof extra === 'object' && !Array.isArray(extra)
        ? (extra as Record<string, unknown>)
        : null,
  }
}

/** 통합UI 이력 목록 — layer.compd_temp */
export async function listCompdTemp(params: { tableName?: string; compKey?: number }) {
  const profile = requireProfile(params.tableName)
  const compKey = Number(params.compKey)
  if (!Number.isInteger(compKey) || compKey < 1) return { rows: [] as ReturnType<typeof mapCompdTempRow>[] }
  await ensureCompdTempTable()
  const res = await db.execute(
    sql.raw(
      `SELECT
         compd_key, comp_key, source_table, compd_date::text AS compd_date,
         compd_cu, compd_ct, compd_cg, compd_state, compd_contents, compd_extra
       FROM layer.compd_temp
       WHERE source_table = '${escLit(profile.table)}'
         AND comp_key = ${compKey}
       ORDER BY compd_key ASC`
    )
  )
  return {
    rows: (res.rows ?? []).map((row) => mapCompdTempRow(row as Record<string, unknown>)),
  }
}

/** 통합UI 이력 추가 — layer.compd_temp */
export async function createCompdTemp(params: {
  tableName?: string
  compKey?: number
  compdDate?: string | null
  compdCu?: string | null
  compdCt?: string | null
  compdCg?: string | null
  compdState?: string | null
  compdContents?: string | null
  compdExtra?: Record<string, unknown> | null
}) {
  const profile = requireProfile(params.tableName)
  const compKey = Number(params.compKey)
  if (!Number.isInteger(compKey) || compKey < 1) throw new Error('민원을 찾을 수 없습니다.')
  await ensureCompdTempTable()
  const date = asDateOrNull(params.compdDate)
  const dateSql = date ? `'${escLit(date)}'::timestamp` : 'NULL'
  const cu = emptyToNull(params.compdCu)
  const ct = emptyToNull(params.compdCt)
  const cg = emptyToNull(params.compdCg)
  const state = emptyToNull(params.compdState)
  const contents = emptyToNull(params.compdContents)
  const extraJson = JSON.stringify(params.compdExtra ?? {})
  const res = await db.execute(
    sql.raw(
      `INSERT INTO layer.compd_temp (
         comp_key, source_table, compd_date, compd_cu, compd_ct, compd_cg,
         compd_state, compd_contents, compd_extra
       ) VALUES (
         ${compKey},
         '${escLit(profile.table)}',
         ${dateSql},
         ${cu ? `'${escLit(cu)}'` : 'NULL'},
         ${ct ? `'${escLit(ct)}'` : 'NULL'},
         ${cg ? `'${escLit(cg)}'` : 'NULL'},
         ${state ? `'${escLit(state)}'` : 'NULL'},
         ${contents ? `'${escLit(contents)}'` : 'NULL'},
         '${escLit(extraJson)}'::jsonb
       )
       RETURNING
         compd_key, comp_key, source_table, compd_date::text AS compd_date,
         compd_cu, compd_ct, compd_cg, compd_state, compd_contents, compd_extra`
    )
  )
  const row = res.rows?.[0] as Record<string, unknown> | undefined
  return row ? mapCompdTempRow(row) : null
}

/** 통합UI 이력 수정 — layer.compd_temp */
export async function updateCompdTemp(params: {
  tableName?: string
  compdKey?: number
  compdDate?: string | null
  compdCu?: string | null
  compdCt?: string | null
  compdCg?: string | null
  compdState?: string | null
  compdContents?: string | null
  compdExtra?: Record<string, unknown> | null
}) {
  const profile = requireProfile(params.tableName)
  const compdKey = Number(params.compdKey)
  if (!Number.isInteger(compdKey) || compdKey < 1) throw new Error('이력을 찾을 수 없습니다.')
  await ensureCompdTempTable()
  const date = asDateOrNull(params.compdDate)
  const dateSql = date ? `'${escLit(date)}'::timestamp` : 'NULL'
  const cu = emptyToNull(params.compdCu)
  const ct = emptyToNull(params.compdCt)
  const cg = emptyToNull(params.compdCg)
  const state = emptyToNull(params.compdState)
  const contents = emptyToNull(params.compdContents)
  const extraJson = JSON.stringify(params.compdExtra ?? {})
  const res = await db.execute(
    sql.raw(
      `UPDATE layer.compd_temp SET
         compd_date = ${dateSql},
         compd_cu = ${cu ? `'${escLit(cu)}'` : 'NULL'},
         compd_ct = ${ct ? `'${escLit(ct)}'` : 'NULL'},
         compd_cg = ${cg ? `'${escLit(cg)}'` : 'NULL'},
         compd_state = ${state ? `'${escLit(state)}'` : 'NULL'},
         compd_contents = ${contents ? `'${escLit(contents)}'` : 'NULL'},
         compd_extra = '${escLit(extraJson)}'::jsonb
       WHERE compd_key = ${compdKey}
         AND source_table = '${escLit(profile.table)}'
       RETURNING
         compd_key, comp_key, source_table, compd_date::text AS compd_date,
         compd_cu, compd_ct, compd_cg, compd_state, compd_contents, compd_extra`
    )
  )
  const row = res.rows?.[0] as Record<string, unknown> | undefined
  if (!row) throw new Error('이력을 찾을 수 없습니다.')
  return mapCompdTempRow(row)
}

/** 통합UI 이력 삭제 — layer.compd_temp */
export async function removeCompdTemp(params: { tableName?: string; compdKey?: number }) {
  const profile = requireProfile(params.tableName)
  const compdKey = Number(params.compdKey)
  if (!Number.isInteger(compdKey) || compdKey < 1) return { deleted: false }
  await ensureCompdTempTable()
  const res = await db.execute(
    sql.raw(
      `DELETE FROM layer.compd_temp
       WHERE compd_key = ${compdKey}
         AND source_table = '${escLit(profile.table)}'
       RETURNING compd_key`
    )
  )
  return { deleted: (res.rows?.length ?? 0) > 0 }
}

async function insertCompdTempIfAbsent(params: {
  sourceTable: string
  compKey: number
  state: string
  date: string | null
  contents: string | null
  cu: string | null
  ct: string | null
  cg: string | null
}): Promise<boolean> {
  const exists = await db.execute(
    sql.raw(
      `SELECT 1 FROM layer.compd_temp
       WHERE source_table = '${escLit(params.sourceTable)}'
         AND comp_key = ${params.compKey}
         AND COALESCE(compd_state, '') = '${escLit(params.state)}'
       LIMIT 1`
    )
  )
  if ((exists.rows?.length ?? 0) > 0) return false
  const dateSql = params.date ? `'${escLit(params.date)}'::timestamp` : 'NULL'
  const contentsSql = params.contents ? `'${escLit(params.contents)}'` : 'NULL'
  const cuSql = params.cu ? `'${escLit(params.cu)}'` : 'NULL'
  const ctSql = params.ct ? `'${escLit(params.ct)}'` : 'NULL'
  const cgSql = params.cg ? `'${escLit(params.cg)}'` : 'NULL'
  await db.execute(
    sql.raw(
      `INSERT INTO layer.compd_temp (
         comp_key, source_table, compd_date, compd_cu, compd_ct, compd_cg,
         compd_state, compd_contents, compd_extra
       ) VALUES (
         ${params.compKey},
         '${escLit(params.sourceTable)}',
         ${dateSql},
         ${cuSql},
         ${ctSql},
         ${cgSql},
         '${escLit(params.state)}',
         ${contentsSql},
         jsonb_build_object('migratedFrom', 'field', 'sourceTable', '${escLit(params.sourceTable)}')
       )`
    )
  )
  return true
}

async function migrateOneComplaintTable(tableName: string): Promise<{
  tableName: string
  scanned: number
  inserted: number
  skipped: number
}> {
  const profile = requireProfile(tableName)
  const hasContent = await layerColumnExists(tableName, profile.content)
  const hasWorkContents = await layerColumnExists(tableName, 'work_contents')
  const hasWorkDate = await layerColumnExists(tableName, 'work_date')
  const hasProcDate = await layerColumnExists(tableName, 'comp_req_limit')
  const hasCreateDate = await layerColumnExists(tableName, profile.date)
  const hasCu = profile.writer ? await layerColumnExists(tableName, profile.writer) : false
  const hasCt = profile.team ? await layerColumnExists(tableName, profile.team) : false
  const hasCg = profile.dept ? await layerColumnExists(tableName, profile.dept) : false

  const selectParts = [
    `comp_key::int AS comp_key`,
    hasContent ? `${q(profile.content)}::text AS content` : `NULL::text AS content`,
    hasWorkContents ? `work_contents::text AS work_contents` : `NULL::text AS work_contents`,
    hasWorkDate ? `work_date::text AS work_date` : `NULL::text AS work_date`,
    hasProcDate ? `comp_req_limit::text AS proc_date` : `NULL::text AS proc_date`,
    hasCreateDate ? `${q(profile.date)}::text AS create_date` : `NULL::text AS create_date`,
    hasCu && profile.writer ? `${q(profile.writer)}::text AS cu` : `NULL::text AS cu`,
    hasCt && profile.team ? `${q(profile.team)}::text AS ct` : `NULL::text AS ct`,
    hasCg && profile.dept ? `${q(profile.dept)}::text AS cg` : `NULL::text AS cg`,
  ]
  const res = await db.execute(
    sql.raw(`SELECT ${selectParts.join(', ')} FROM layer."${tableName}" ORDER BY comp_key`)
  )

  let inserted = 0
  let skipped = 0
  for (const raw of res.rows ?? []) {
    const row = raw as Record<string, unknown>
    const compKey = Number(row.comp_key)
    if (!Number.isInteger(compKey) || compKey < 1) continue
    const cu = emptyToNull(row.cu == null ? null : String(row.cu))
    const ct = emptyToNull(row.ct == null ? null : String(row.ct))
    const cg = emptyToNull(row.cg == null ? null : String(row.cg))
    const content = emptyToNull(row.content == null ? null : String(row.content))
    const workContents = emptyToNull(
      row.work_contents == null ? null : String(row.work_contents)
    )
    const workDate = asDateOrNull(row.work_date)
    const procDate = asDateOrNull(row.proc_date)
    const createDate = asDateOrNull(row.create_date)

    if (content) {
      const ok = await insertCompdTempIfAbsent({
        sourceTable: tableName,
        compKey,
        state: '접수',
        date: createDate,
        contents: content,
        cu,
        ct,
        cg,
      })
      if (ok) inserted += 1
      else skipped += 1
    }
    if (workContents || workDate) {
      const ok = await insertCompdTempIfAbsent({
        sourceTable: tableName,
        compKey,
        state: '처리중',
        date: workDate,
        contents: workContents,
        cu,
        ct,
        cg,
      })
      if (ok) inserted += 1
      else skipped += 1
    }
    if (procDate) {
      const ok = await insertCompdTempIfAbsent({
        sourceTable: tableName,
        compKey,
        state: '완료',
        date: procDate,
        contents: null,
        cu,
        ct,
        cg,
      })
      if (ok) inserted += 1
      else skipped += 1
    }
  }

  return {
    tableName,
    scanned: res.rows?.length ?? 0,
    inserted,
    skipped,
  }
}

/**
 * 통합UI 민원 대장 Field → layer.compd_temp 1회 이관.
 * 상세내용→접수, 작업내용·작업일자→처리중, 처리일자→완료.
 * 동일 source_table+comp_key+상태는 건너뜀.
 */
export async function migrateFieldHistoryToCompdTemp(params: {
  tableNames?: string[]
} = {}) {
  await ensureCompdTempTable()
  const available = await listAvailableComplaintTables()
  const requested = normalizeComplaintTableNames(params.tableNames)
  const targets =
    requested.length > 0
      ? available.tables.filter((t) => requested.includes(t.tableName)).map((t) => t.tableName)
      : available.tables.map((t) => t.tableName)

  const results: { tableName: string; scanned: number; inserted: number; skipped: number }[] = []
  for (const tableName of targets) {
    results.push(await migrateOneComplaintTable(tableName))
  }
  return {
    table: 'layer.compd_temp',
    results,
    inserted: results.reduce((n, r) => n + r.inserted, 0),
    skipped: results.reduce((n, r) => n + r.skipped, 0),
    scanned: results.reduce((n, r) => n + r.scanned, 0),
  }
}
