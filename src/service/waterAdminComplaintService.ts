/**
 * 상하수도 업무 민원 — 테이블은 메뉴별로 다르고, 화면 항목은 민원관리와 같은 자리로 맞춘다.
 * 준설대상지는 complaint_dre.comp_key 에 붙는 하위 행이다.
 */
import { sql } from 'drizzle-orm'
import { db } from '@/database/db'
import { fetchCoordFromAddress } from '@/lib/vworldAddressServer'
import {
  deleteTableRowByKey,
  insertTableRow,
  updateTableRowByKey,
} from '@/service/layerRowService'
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
  compExtra: null
  latestState: string | null
  resultText: string | null
  extent3857?: [number, number, number, number] | null
  geomGeoJson4326?: Record<string, unknown> | null
  details?: WaterDreDetail[]
}

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

export async function list(params: { tableName?: string; limit?: number; offset?: number } = {}) {
  const profile = requireProfile(params.tableName)
  const limit = clampLimit(params.limit)
  const offset = typeof params.offset === 'number' && params.offset >= 0 ? Math.floor(params.offset) : 0
  const from = `layer.${q(profile.table)}`
  const rowsRes = await db.execute(
    sql.raw(
      `SELECT ${selectListSql(profile)} FROM ${from} ORDER BY ${q('comp_key')} DESC LIMIT ${limit} OFFSET ${offset}`
    )
  )
  const countRes = await db.execute(sql.raw(`SELECT count(*)::int AS total FROM ${from}`))
  const total = Number((countRes.rows?.[0] as { total?: unknown } | undefined)?.total ?? 0)
  const rows = (rowsRes.rows ?? []).map((row) => mapRow(row as Record<string, unknown>))
  return { rows, total }
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
