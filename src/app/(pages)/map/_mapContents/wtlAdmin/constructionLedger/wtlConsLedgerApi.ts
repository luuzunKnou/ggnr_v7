import GeoJSON from 'ol/format/GeoJSON'
import WKT from 'ol/format/WKT'
import { call } from '@/lib/api'
import type { ConsLedgerKind } from '@/lib/consLedgerVariant'
import '../../../_mapComponents/config/projections'
import type { WtlConsWork } from './wtlConsSample'
import type { ZoneMock } from './WtlConsRelatedTabs'

/** 본표 도형. 경위도(4326) GeoJSON */
export type WtlConsGeom4326 = {
  type: 'MultiPolygon'
  coordinates: [number, number][][][]
}

type LedgerApiRow = {
  consCode: string
  consName: string
  consLocat: string
  consVolum: string
  contDate: string
  startDate: string
  doneDate: string
  sdoneDate: string
  businName: string
  ceoName: string
  businPhon: string
  businAddr: string
  directPos: string
  directNam: string
  amountPre: string
  amountVar: string
  amountCha: string
  amountAft: string
  reason: string
  descript: string
  geom: WtlConsGeom4326 | null
}

type ZoneApiItem = {
  id?: string
  address?: string
  remark?: string
  descript?: string
  geometry3857?: Record<string, unknown> | null
  extent3857?: [number, number, number, number] | null
}

export type WtlConsLedgerItem = WtlConsWork & {
  /** 본표 도형. 경위도(4326) */
  geom4326: WtlConsGeom4326 | null
}

export type WtlConsZoneItem = ZoneMock & {
  geometry3857: Record<string, unknown> | null
  extent3857: [number, number, number, number] | null
}

type Extent = [number, number, number, number] | null

function asBody(res: unknown): Record<string, unknown> {
  if (res && typeof res === 'object' && 'data' in res && (res as { data?: unknown }).data) {
    return (res as { data: Record<string, unknown> }).data
  }
  return (res ?? {}) as Record<string, unknown>
}

export type WtlConsGeomHit = {
  consCode: string
  geom4326: WtlConsGeom4326 | null
}

/** 공사 본표 도형(4326)을 지적 조회용 5181 WKT로 바꾼다 */
export function geom4326ToWkt5181(geom: { type?: string } | null | undefined): string | null {
  if (!geom || typeof geom.type !== 'string') return null
  try {
    const geometry = new GeoJSON().readGeometry(geom, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:4326',
    })
    const text = new WKT().writeGeometry(geometry, {
      featureProjection: 'EPSG:4326',
      dataProjection: 'EPSG:5181',
    })
    return text?.trim() || null
  } catch {
    return null
  }
}

function geom3857ToWkt5181(geom: Record<string, unknown> | null): string | null {
  if (!geom) return null
  try {
    const geometry = new GeoJSON().readGeometry(geom, {
      dataProjection: 'EPSG:3857',
      featureProjection: 'EPSG:3857',
    })
    const text = new WKT().writeGeometry(geometry, {
      featureProjection: 'EPSG:3857',
      dataProjection: 'EPSG:5181',
    })
    return text?.trim() || null
  } catch {
    return null
  }
}

function rowToWork(row: LedgerApiRow): WtlConsLedgerItem {
  return {
    id: row.consCode,
    consCode: row.consCode,
    name: row.consName || row.consCode,
    location: row.consLocat,
    volume: row.consVolum,
    amountPre: row.amountPre,
    amountVar: row.amountVar,
    amountCha: row.amountCha,
    amountAft: row.amountAft,
    contDate: row.contDate,
    startDate: row.startDate,
    doneDate: row.doneDate,
    sdoneDate: row.sdoneDate,
    company: row.businName,
    ceo: row.ceoName,
    companyAddr: row.businAddr,
    companyPhone: row.businPhon,
    directorPos: row.directPos,
    directorName: row.directNam,
    reason: row.reason,
    descript: row.descript,
    geomWkt5181: null,
    attachments: [],
    geom4326: row.geom,
  }
}

export async function loadWtlConsLedger(
  kind: Extract<ConsLedgerKind, 'wtl' | 'swl'> = 'wtl'
): Promise<{ rows: WtlConsLedgerItem[]; error?: string }> {
  const res = await call('', 'POST', {
    service: 'consDataAsService',
    action: 'listRows',
    params: { kind, includeGeometry: false },
  })
  const body = asBody(res)
  const raw = Array.isArray(body.rows) ? (body.rows as LedgerApiRow[]) : []
  return {
    rows: raw.map(rowToWork),
    error: typeof body.error === 'string' ? body.error : undefined,
  }
}

export async function loadWtlConsGeoms(
  kind: Extract<ConsLedgerKind, 'wtl' | 'swl'>,
  consCodes: string[]
): Promise<{ rows: WtlConsGeomHit[]; error?: string }> {
  const res = await call('', 'POST', {
    service: 'consDataAsService',
    action: 'listGeomsByConsCodes',
    params: { kind, consCodes },
  })
  const body = asBody(res)
  const raw = Array.isArray(body.rows) ? (body.rows as Array<{ consCode?: string; geom?: WtlConsGeom4326 | null }>) : []
  return {
    rows: raw
      .map((row) => ({
        consCode: String(row.consCode ?? '').trim(),
        geom4326: row.geom ?? null,
      }))
      .filter((row) => row.consCode),
    error: typeof body.error === 'string' ? body.error : undefined,
  }
}

export type WtlConsIntersectHit = {
  consCode: string
  consName: string
  consLocat: string
  doneDate: string
  sdoneDate: string
  amountPre: string
  amountAft: string
  geom4326: WtlConsGeom4326 | null
}

/** 같은 종류 공사대장 중 도형이 겹치는 다른 공사 */
export async function loadWtlConsIntersecting(
  kind: Extract<ConsLedgerKind, 'wtl' | 'swl'>,
  consCode: string,
  wkt5181: string
): Promise<{ rows: WtlConsIntersectHit[]; error?: string }> {
  const res = await call('', 'POST', {
    service: 'consDataAsService',
    action: 'listIntersectingRows',
    params: { kind, wkt5181, excludeConsCode: consCode, limit: 200 },
  })
  const body = asBody(res)
  const raw = Array.isArray(body.rows) ? (body.rows as Array<Record<string, unknown>>) : []
  return {
    rows: raw
      .map((row) => ({
        consCode: String(row.consCode ?? '').trim(),
        consName: String(row.consName ?? '').trim(),
        consLocat: String(row.consLocat ?? '').trim(),
        doneDate: String(row.doneDate ?? '').trim(),
        sdoneDate: String(row.sdoneDate ?? '').trim(),
        amountPre: String(row.amountPre ?? '').trim(),
        amountAft: String(row.amountAft ?? '').trim(),
        geom4326: (row.geom as WtlConsGeom4326 | null) ?? null,
      }))
      .filter((row) => row.consCode),
    error: typeof body.error === 'string' ? body.error : undefined,
  }
}

export async function loadWtlConsZones(
  consCode: string,
  kind: Extract<ConsLedgerKind, 'wtl' | 'swl'> = 'wtl'
): Promise<{ zones: WtlConsZoneItem[]; error?: string }> {
  const res = await call('', 'POST', {
    service: 'consDataAsService',
    action: 'listParcelsByConsCode',
    params: { kind, consCode, includeGeometry: true },
  })
  const body = asBody(res)
  const items = Array.isArray(body.items) ? (body.items as ZoneApiItem[]) : []
  return {
    zones: items.map((item, index) => ({
      id: item.id?.trim() || `${consCode}-z${index + 1}`,
      location: item.address?.trim() || '—',
      note: item.remark?.trim() || item.descript?.trim() || '',
      geomWkt5181: geom3857ToWkt5181(item.geometry3857 ?? null),
      geometry3857: item.geometry3857 ?? null,
      extent3857: item.extent3857 ?? null,
    })),
    error: typeof body.error === 'string' ? body.error : undefined,
  }
}

export async function loadWtlConsExtent(
  consCode: string,
  kind: Extract<ConsLedgerKind, 'wtl' | 'swl'> = 'wtl'
): Promise<Extent> {
  const res = await call('', 'POST', {
    service: 'consDataAsService',
    action: 'getExtent3857ByConsCode',
    params: { kind, consCode },
  })
  const body = asBody(res)
  const extent = body.extent3857
  if (!Array.isArray(extent) || extent.length !== 4) return null
  const nums = extent.map(Number)
  return nums.every((v) => Number.isFinite(v)) ? (nums as Extent) : null
}
