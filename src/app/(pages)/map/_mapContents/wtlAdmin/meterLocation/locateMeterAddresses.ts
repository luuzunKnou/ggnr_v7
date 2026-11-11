import { call } from '@/lib/api'
import {
  getAddressFromCoord,
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

async function fetchParcelGeometry(params: {
  x?: number
  y?: number
  pnu?: string
}): Promise<Record<string, unknown> | null> {
  const res = await call('', 'POST', {
    service: 'standardService',
    action: 'getParcelHighlightGeom',
    params,
  })
  const body = (res?.data ?? res) as { geometry4326?: Record<string, unknown> | null }
  const geometry = body?.geometry4326
  if (!geometry || typeof geometry !== 'object' || !('type' in geometry)) return null
  return geometry
}

function pnuDigits(value: string | undefined): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length >= 19 ? digits.slice(0, 19) : ''
}

async function parcelAtPoint(
  lon: number,
  lat: number,
  apiKey: string,
  pnu: string
): Promise<Record<string, unknown> | null> {
  const coord = transformCoordinate([lon, lat], 'EPSG:4326', 'EPSG:3857')
  if (coord) {
    const atPoint = await fetchParcelGeometry({
      x: coord[0],
      y: coord[1],
      ...(pnu ? { pnu } : {}),
    })
    if (atPoint) return atPoint
  }
  const fromSearch = pnu ? await fetchParcelGeometry({ pnu }) : null
  if (fromSearch) return fromSearch
  const addr = await getAddressFromCoord(lon, lat, { apiKey })
  const fromCoord = pnuDigits(addr?.pnu)
  if (!fromCoord || fromCoord === pnu) return null
  return fetchParcelGeometry({ pnu: fromCoord })
}

async function locateOne(
  input: string,
  index: number,
  apiKey: string,
  region: PreferRegion | undefined
): Promise<MeterLocateResult> {
  const id = `${index}-${input}`
  const road = await searchAddress(input, { apiKey, maxResults: 8, category: 'road' })
  let hit = pickAddress(input, road)
  if (!hit) {
    const parcel = await searchAddress(input, { apiKey, maxResults: 8, category: 'parcel' })
    hit = pickAddress(input, parcel)
  }
  if (!hit && region) {
    const local = await searchAddress(input, {
      apiKey,
      maxResults: 8,
      category: 'road',
      preferRegion: region,
    })
    hit = pickAddress(input, local, region)
  }
  if (!hit || !Number.isFinite(hit.point?.x) || !Number.isFinite(hit.point?.y)) {
    return {
      id,
      input,
      status: 'miss',
      detail: '주소를 찾지 못했습니다',
      geometry4326: null,
      point4326: null,
    }
  }
  const point4326: [number, number] = [hit.point.x, hit.point.y]
  const detail = (hit.jibunAddress || hit.roadAddress || hit.address || input).trim()
  const geometry4326 = await parcelAtPoint(hit.point.x, hit.point.y, apiKey, pnuDigits(hit.id))
  if (!geometry4326) {
    return {
      id,
      input,
      status: 'point',
      detail: '필지 경계 없음',
      geometry4326: null,
      point4326,
    }
  }
  return { id, input, status: 'shown', detail, geometry4326, point4326 }
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
        }
      }
      done += 1
      onProgress?.(done, lines.length)
    }
  }
  const workers = Array.from({ length: Math.min(3, lines.length) }, () => worker())
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
  index: number,
  apiKey: string
): Promise<MeterLocateResult> {
  const id = `${index}-${row.input}`
  if (!row.found || !row.point) {
    return {
      id,
      input: row.input,
      status: 'miss',
      detail: '계량기를 찾지 못했습니다',
      geometry4326: null,
      point4326: null,
    }
  }
  const point4326 = row.point
  const detail = (row.address || row.meterNo || row.input).trim()
  const geometry4326 = await parcelAtPoint(point4326[0], point4326[1], apiKey, '')
  if (!geometry4326) {
    return {
      id,
      input: row.input,
      status: 'point',
      detail: detail || '필지 경계 없음',
      geometry4326: null,
      point4326,
    }
  }
  return { id, input: row.input, status: 'shown', detail, geometry4326, point4326 }
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
  return new Map(fetched.map((row) => [row.input, row]))
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
          results[index] = await locateOneByNumber(meter, index, apiKey)
        } else if (apiKey) {
          results[index] = await locateOne(line, index, apiKey, region)
        } else {
          results[index] = {
            id: `${index}-${line}`,
            input: line,
            status: 'miss',
            detail: '위치를 찾지 못했습니다',
            geometry4326: null,
            point4326: null,
          }
        }
      } catch {
        results[index] = {
          id: `${index}-${line}`,
          input: line,
          status: 'miss',
          detail: '조회에 실패했습니다',
          geometry4326: null,
          point4326: null,
        }
      }
      done += 1
      onProgress?.(done, lines.length)
    }
  }
  const workers = Array.from({ length: Math.min(3, lines.length) }, () => worker())
  await Promise.all(workers)
  return results.filter((row): row is MeterLocateResult => Boolean(row))
}
