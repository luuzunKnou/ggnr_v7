import { call } from '@/lib/api'
import {
  matchesPreferRegion,
  searchAddress,
  type PreferRegion,
  type VWorldAddressItem,
} from '../../../_mapComponents/addressSearch/vworldAddressSearch'
import { transformCoordinate } from '../../../_mapComponents/services/coordinateService'

export type MeterLocateStatus = 'shown' | 'point' | 'miss'

export type MeterLocateResult = {
  id: string
  input: string
  status: MeterLocateStatus
  detail: string
  geometry4326: Record<string, unknown> | null
  point4326: [number, number] | null
  /** public_layer.jijuk PNU — 필지 건수(고유) 집계용 */
  pnu: string | null
}

export function parseMeterAddressLines(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\u00a0/g, ' ').trim()
    if (!line) continue
    const key = line.replace(/\s+/g, '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(line)
  }
  return out
}

/** 단건 누적 추가 시에도 겹치지 않는 행 id */
function nextMeterRowId(input: string): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}-${input}`
}

function compact(value: string): string {
  return value.replace(/\s+/g, '')
}

function hasExactBuildingNo(hay: string, no: string): boolean {
  if (!no) return false
  const esc = no.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^0-9])${esc}(?![0-9-])`).test(hay)
}

function addressMatchScore(query: string, haystack: string): number {
  const hay = compact(haystack)
  if (!hay) return 0
  const trimmed = query.trim()
  const no = trimmed.match(/(\d+(?:-\d+)?)\s*$/)?.[1] ?? ''
  if (!hasExactBuildingNo(hay, no)) return 0
  const parts = trimmed.split(/\s+/).filter(Boolean)
  const road = parts.find((part) => part !== no && /(로|길)/.test(part)) ?? ''
  const admin = parts.filter((part) => /(읍|면|동|리|가)$/.test(part))
  if (road) {
    if (!hay.includes(compact(road))) return 0
  } else if (admin.length === 0) {
    return 0
  } else if (!admin.some((name) => hay.includes(compact(name)))) {
    return 0
  }
  let score = 4
  if (road) score += 4
  for (const name of admin) {
    if (hay.includes(compact(name))) score += 1
  }
  return score
}

function pickAddress(
  query: string,
  items: VWorldAddressItem[],
  region?: PreferRegion
): VWorldAddressItem | null {
  const ranked = items
    .map((item) => {
      const score = Math.max(
        addressMatchScore(query, item.roadAddress ?? ''),
        addressMatchScore(query, item.jibunAddress ?? ''),
        addressMatchScore(query, item.address ?? '')
      )
      return { item, score, local: matchesPreferRegion(item, region) }
    })
    .filter((row) => row.score > 0 && row.local)
    .sort((a, b) => b.score - a.score)
  return ranked[0]?.item ?? null
}

type ParcelHit = {
  geometry4326: Record<string, unknown>
  pnu: string | null
}

async function fetchParcelGeometry(params: {
  x?: number
  y?: number
  pnu?: string
}): Promise<ParcelHit | null> {
  try {
    const res = await call('', 'POST', {
      service: 'standardService',
      action: 'getParcelHighlightGeom',
      params,
    })
    const body = (res?.data ?? res) as {
      geometry4326?: Record<string, unknown> | null
      pnu?: string | null
      data?: { geometry4326?: Record<string, unknown> | null; pnu?: string | null }
    }
    const geometry = body?.geometry4326 ?? body?.data?.geometry4326 ?? null
    if (!geometry || typeof geometry !== 'object' || !('type' in geometry)) return null
    const pnu = pnuDigits(String(body?.pnu ?? body?.data?.pnu ?? params.pnu ?? ''))
    return { geometry4326: geometry, pnu: pnu || null }
  } catch {
    return null
  }
}

function pnuDigits(value: string | undefined): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length >= 19 ? digits.slice(0, 19) : ''
}

/** 주소처럼 보일 때만 브이월드 검색. 번호·와일드카드·특수문자는 호출하지 않음 */
function looksLikeAddressQuery(input: string): boolean {
  const s = input.trim()
  if (!s || s.length < 2) return false
  if (/[%_\\'";<>*#]/.test(s)) return false
  if (/^[\d\s-]+$/.test(s)) return false
  return /(로|길|읍|면|동|리|가|번지)/.test(s)
}

async function parcelAtPoint(lon: number, lat: number, pnu: string): Promise<ParcelHit | null> {
  try {
    const coord = transformCoordinate([lon, lat], 'EPSG:4326', 'EPSG:3857')
    if (coord) {
      const atPoint = await fetchParcelGeometry({
        x: coord[0],
        y: coord[1],
        ...(pnu ? { pnu } : {}),
      })
      if (atPoint) return atPoint
    }
    return pnu ? await fetchParcelGeometry({ pnu }) : null
  } catch {
    return null
  }
}

async function locateOne(
  input: string,
  _index: number,
  apiKey: string,
  region: PreferRegion | undefined
): Promise<MeterLocateResult> {
  const id = nextMeterRowId(input)
  if (!apiKey.trim() || !looksLikeAddressQuery(input)) {
    return {
      id,
      input,
      status: 'miss',
      detail: '주소를 찾지 못했습니다',
      geometry4326: null,
      point4326: null,
      pnu: null,
    }
  }
  const category = /(로|길)/.test(input) ? 'road' : 'parcel'
  const found = await searchAddress(input, {
    apiKey,
    maxResults: 5,
    category,
    preferRegion: region,
  })
  const hit = pickAddress(input, found, region)
  if (!hit || !Number.isFinite(hit.point?.x) || !Number.isFinite(hit.point?.y)) {
    return {
      id,
      input,
      status: 'miss',
      detail: '주소를 찾지 못했습니다',
      geometry4326: null,
      point4326: null,
      pnu: null,
    }
  }
  const point4326: [number, number] = [hit.point.x, hit.point.y]
  const detail = (hit.jibunAddress || hit.roadAddress || hit.address || input).trim()
  const hitParcel = await parcelAtPoint(hit.point.x, hit.point.y, pnuDigits(hit.id))
  if (!hitParcel) {
    return {
      id,
      input,
      status: 'point',
      detail: '필지 경계 없음',
      geometry4326: null,
      point4326,
      pnu: null,
    }
  }
  return {
    id,
    input,
    status: 'shown',
    detail,
    geometry4326: hitParcel.geometry4326,
    point4326,
    pnu: hitParcel.pnu,
  }
}

export async function locateMeterAddresses(args: {
  lines: string[]
  apiKey: string
  region?: PreferRegion
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
}): Promise<MeterLocateResult[]> {
  const { lines, apiKey, region, signal, onProgress } = args
  const results: MeterLocateResult[] = new Array(lines.length)
  let cursor = 0
  let done = 0
  const worker = async () => {
    while (cursor < lines.length) {
      if (signal?.aborted) return
      const index = cursor
      cursor += 1
      const line = lines[index]
      if (!line) continue
      try {
        results[index] = await locateOne(line, index, apiKey, region)
      } catch {
        results[index] = {
          id: `${index}-${line}`,
          input: line,
          status: 'miss',
          detail: '조회에 실패했습니다',
          geometry4326: null,
          point4326: null,
          pnu: null,
        }
      }
      done += 1
      onProgress?.(done, lines.length)
    }
  }
  const workers = Array.from({ length: Math.min(1, lines.length) }, () => worker())
  await Promise.all(workers)
  return results.filter((row): row is MeterLocateResult => Boolean(row))
}

type MeterByNumberRow = {
  input: string
  meterNo: string
  address: string
  point: [number, number] | null
  found: boolean
}

async function locateOneByNumber(
  row: MeterByNumberRow,
  _index: number
): Promise<MeterLocateResult> {
  const id = nextMeterRowId(row.input)
  if (!row.found || !row.point) {
    return {
      id,
      input: row.input,
      status: 'miss',
      detail: '계량기를 찾지 못했습니다',
      geometry4326: null,
      point4326: null,
      pnu: null,
    }
  }
  const point4326 = row.point
  const detail = (row.address || row.meterNo || row.input).trim()
  const hitParcel = await parcelAtPoint(point4326[0], point4326[1], '')
  if (!hitParcel) {
    return {
      id,
      input: row.input,
      status: 'point',
      detail: detail ? `${detail} · 필지 경계 없음` : '필지 경계 없음',
      geometry4326: null,
      point4326,
      pnu: null,
    }
  }
  return {
    id,
    input: row.input,
    status: 'shown',
    detail,
    geometry4326: hitParcel.geometry4326,
    point4326,
    pnu: hitParcel.pnu,
  }
}

/** 한 번에 조회 — 필지 도형은 내려받지 않고 PNU만 */
const JIJUK_BATCH = 500

type JijukResolveRow = {
  index: number
  pnu: string | null
  geometry4326: Record<string, unknown> | null
}

async function resolveJijukBatch(
  points: Array<{ lon: number; lat: number } | null>,
  onProgress?: (done: number, total: number) => void | Promise<void>
): Promise<JijukResolveRow[]> {
  const chunks: Array<{ offset: number; pts: Array<{ lon: number; lat: number } | null> }> = []
  for (let i = 0; i < points.length; i += JIJUK_BATCH) {
    chunks.push({ offset: i, pts: points.slice(i, i + JIJUK_BATCH) })
  }
  const out: JijukResolveRow[] = points.map((_, index) => ({
    index,
    pnu: null,
    geometry4326: null,
  }))
  const total = points.length
  let donePoints = 0
  await onProgress?.(0, total)
  for (const chunk of chunks) {
    try {
      const res = await call('', 'POST', {
        service: 'wtlMeterLocationService',
        action: 'resolveJijukParcelsByLonLat',
        params: { points: chunk.pts },
      })
      const body = (res?.data ?? res) as { rows?: JijukResolveRow[] }
      const rows = Array.isArray(body?.rows) ? body.rows : []
      for (const row of rows) {
        const localIdx = Number(row.index)
        if (!Number.isFinite(localIdx)) continue
        const globalIdx = chunk.offset + localIdx
        if (globalIdx < 0 || globalIdx >= out.length) continue
        const pnu = pnuDigits(String(row.pnu ?? ''))
        const geom = row.geometry4326
        out[globalIdx] = {
          index: globalIdx,
          pnu: pnu || null,
          geometry4326:
            geom && typeof geom === 'object' && 'type' in geom ? geom : null,
        }
      }
    } catch {
      /* chunk 실패 시 해당 구간은 null 유지 */
    }
    donePoints += chunk.pts.length
    await onProgress?.(Math.min(donePoints, total), total)
  }
  return out
}

/**
 * 이미 좌표를 아는 계량기 목록 — jijuk 일괄(병렬 청크)로 필지 보강.
 */
export async function locateMetersFromKnown(args: {
  meters: Array<{
    meterNo: string
    address?: string
    point?: [number, number] | null
  }>
  apiKey: string
  onProgress?: (done: number, total: number) => void | Promise<void>
}): Promise<MeterLocateResult[]> {
  const { meters, onProgress } = args
  if (meters.length === 0) return []

  const points: Array<{ lon: number; lat: number } | null> = meters.map((m) => {
    const point = m.point
    if (
      Array.isArray(point) &&
      point.length >= 2 &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1])
    ) {
      return { lon: point[0]!, lat: point[1]! }
    }
    return null
  })

  const resolved = await resolveJijukBatch(points, onProgress)

  return meters.map((m, index) => {
    const meterNo = String(m.meterNo ?? '').trim() || `row-${index}`
    const id = nextMeterRowId(meterNo)
    const point = m.point
    const hasPoint =
      Array.isArray(point) &&
      point.length >= 2 &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1])
    const detail = (String(m.address ?? '').trim() || meterNo).trim()
    if (!hasPoint) {
      return {
        id,
        input: meterNo,
        status: 'miss' as const,
        detail: '계량기를 찾지 못했습니다',
        geometry4326: null,
        point4326: null,
        pnu: null,
      }
    }
    const hit = resolved[index]
    const pnu = hit?.pnu ?? null
    if (pnu) {
      return {
        id,
        input: meterNo,
        status: 'shown' as const,
        detail,
        geometry4326: null,
        point4326: [point![0], point![1]],
        pnu,
      }
    }
    return {
      id,
      input: meterNo,
      status: 'point' as const,
      detail: `${detail} · 필지 경계 없음`,
      geometry4326: null,
      point4326: [point![0], point![1]],
      pnu: null,
    }
  })
}

async function fetchMetersByNumbers(
  lines: string[],
  signal?: AbortSignal
): Promise<Map<string, MeterByNumberRow>> {
  if (lines.length === 0) return new Map()
  const res = await call('', 'POST', {
    service: 'wtlMeterLocationService',
    action: 'locateMetersByNumbers',
    params: { numbers: lines },
  })
  if (signal?.aborted) return new Map()
  const body = (res?.data ?? res) as { rows?: MeterByNumberRow[] }
  const fetched = Array.isArray(body?.rows) ? body.rows : []
  const map = new Map<string, MeterByNumberRow>()
  for (const row of fetched) {
    if (row.input) map.set(row.input, row)
    if (row.meterNo) map.set(row.meterNo, row)
  }
  return map
}

/**
 * 주소·계량기번호 구분 없이 한 줄씩 찾아 필지·점으로 표시한다.
 * 계량기번호 일괄 조회 후, 못 찾은 줄만 주소 검색한다.
 */
export async function locateMeterInputs(args: {
  lines: string[]
  apiKey: string
  region?: PreferRegion
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
}): Promise<MeterLocateResult[]> {
  const { lines, apiKey, region, signal, onProgress } = args
  if (lines.length === 0) return []

  const byMeter = await fetchMetersByNumbers(lines, signal)
  if (signal?.aborted) return []

  const results: MeterLocateResult[] = new Array(lines.length)
  let cursor = 0
  let done = 0
  const worker = async () => {
    while (cursor < lines.length) {
      if (signal?.aborted) return
      const index = cursor
      cursor += 1
      const line = lines[index]
      if (!line) continue
      try {
        const meter = byMeter.get(line)
        if (meter?.found && meter.point) {
          results[index] = await locateOneByNumber(meter, index)
        } else if (apiKey) {
          results[index] = await locateOne(line, index, apiKey, region)
        } else {
          results[index] = {
            id: nextMeterRowId(line),
            input: line,
            status: 'miss',
            detail: '위치를 찾지 못했습니다',
            geometry4326: null,
            point4326: null,
            pnu: null,
          }
        }
      } catch {
        results[index] = {
          id: nextMeterRowId(line),
          input: line,
          status: 'miss',
          detail: '조회에 실패했습니다',
          geometry4326: null,
          point4326: null,
          pnu: null,
        }
      }
      done += 1
      onProgress?.(done, lines.length)
    }
  }
  const workers = Array.from({ length: Math.min(1, lines.length) }, () => worker())
  await Promise.all(workers)
  return results.filter((row): row is MeterLocateResult => Boolean(row))
}
