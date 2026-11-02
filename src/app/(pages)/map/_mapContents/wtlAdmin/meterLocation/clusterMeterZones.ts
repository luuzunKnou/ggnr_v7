import { transformCoordinate } from '../../../_mapComponents/services/coordinateService'
import type { MeterLocateResult } from './locateMeterAddresses'

/** 축척막대 100m 기준 — 한 구역 링크 거리 상한(m, 3857≈미터) */
const LINK_DISTANCE_M = 100
/** 축척막대 100m일 때 구역 extent 대각선 상한(대략 가시폭) */
const MAX_ZONE_DIAGONAL_M = 220

export type MeterZone = {
  zoneId: string
  label: string
  /** 구역 이동 가능 여부(위치 있는 항목만) */
  navigable: boolean
  rowIds: string[]
  /** 3857 extent [xmin,ymin,xmax,ymax] — navigable일 때만 */
  extent3857: [number, number, number, number] | null
}

type PointRow = {
  row: MeterLocateResult
  x: number
  y: number
}

function pointOf(row: MeterLocateResult): [number, number] | null {
  if (row.point4326 && row.point4326.length >= 2) {
    const lon = Number(row.point4326[0])
    const lat = Number(row.point4326[1])
    if (Number.isFinite(lon) && Number.isFinite(lat)) return [lon, lat]
  }
  const g = row.geometry4326 as { type?: string; coordinates?: unknown } | null
  if (!g) return null
  // Polygon/MultiPolygon centroid 근사: 첫 링 첫 좌표
  try {
    if (g.type === 'Point' && Array.isArray(g.coordinates)) {
      const c = g.coordinates as number[]
      if (c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
        return [c[0]!, c[1]!]
      }
    }
    if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
      const ring = (g.coordinates as number[][][])[0]
      const c = ring?.[0]
      if (c && c.length >= 2) return [c[0]!, c[1]!]
    }
    if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
      const ring = (g.coordinates as number[][][][])[0]?.[0]
      const c = ring?.[0]
      if (c && c.length >= 2) return [c[0]!, c[1]!]
    }
  } catch {
    return null
  }
  return null
}

function to3857(lonLat: [number, number]): [number, number] | null {
  try {
    const xy = transformCoordinate(lonLat, 'EPSG:4326', 'EPSG:3857')
    if (!xy || !Number.isFinite(xy[0]) || !Number.isFinite(xy[1])) return null
    return [xy[0], xy[1]]
  } catch {
    return null
  }
}

function dist(a: PointRow, b: PointRow): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.hypot(dx, dy)
}

function extentOf(pts: PointRow[]): [number, number, number, number] {
  let xmin = Infinity
  let ymin = Infinity
  let xmax = -Infinity
  let ymax = -Infinity
  for (const p of pts) {
    xmin = Math.min(xmin, p.x)
    ymin = Math.min(ymin, p.y)
    xmax = Math.max(xmax, p.x)
    ymax = Math.max(ymax, p.y)
  }
  return [xmin, ymin, xmax, ymax]
}

function diagonal(ext: [number, number, number, number]): number {
  return Math.hypot(ext[2] - ext[0], ext[3] - ext[1])
}

/** Union-Find 단일 연결 군집 */
function clusterByDistance(points: PointRow[], linkM: number): PointRow[][] {
  const n = points.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => {
    let p = i
    while (parent[p] !== p) p = parent[p]!
    let cur = i
    while (parent[cur] !== p) {
      const next = parent[cur]!
      parent[cur] = p
      cur = next
    }
    return p
  }
  const unite = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (dist(points[i]!, points[j]!) <= linkM) unite(i, j)
    }
  }
  const groups = new Map<number, PointRow[]>()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    const list = groups.get(r) ?? []
    list.push(points[i]!)
    groups.set(r, list)
  }
  return [...groups.values()]
}

/**
 * 구역 extent가 축척막대 ~100m 가시 범위를 넘으면 가장 먼 점부터 분할.
 */
function splitOversized(group: PointRow[]): PointRow[][] {
  if (group.length <= 1) return [group]
  const ext = extentOf(group)
  if (diagonal(ext) <= MAX_ZONE_DIAGONAL_M) return [group]

  // 중심에서 가장 먼 점을 seed로 새 클러스터, 나머지는 다시 거리 군집
  const cx = (ext[0] + ext[2]) / 2
  const cy = (ext[1] + ext[3]) / 2
  let farIdx = 0
  let farD = -1
  for (let i = 0; i < group.length; i++) {
    const p = group[i]!
    const d = Math.hypot(p.x - cx, p.y - cy)
    if (d > farD) {
      farD = d
      farIdx = i
    }
  }
  const seed = group[farIdx]!
  const near: PointRow[] = []
  const far: PointRow[] = [seed]
  for (let i = 0; i < group.length; i++) {
    if (i === farIdx) continue
    const p = group[i]!
    if (dist(p, seed) <= LINK_DISTANCE_M) far.push(p)
    else near.push(p)
  }
  if (near.length === 0) {
    // 전부 seed에 붙으면 반으로 나눔
    const mid = Math.ceil(group.length / 2)
    return [group.slice(0, mid), group.slice(mid)].filter((g) => g.length > 0)
  }
  return [...splitOversized(near), ...splitOversized(far)]
}

/**
 * 위치 있는 계량기를 축척막대 80~100m에 맞게 구역으로 묶고,
 * 못 찾은 항목은 「미확인」 구역으로 둔다.
 */
export function clusterMeterZones(rows: MeterLocateResult[]): MeterZone[] {
  const located: PointRow[] = []
  const missed: MeterLocateResult[] = []

  for (const row of rows) {
    if (row.status === 'miss') {
      missed.push(row)
      continue
    }
    const ll = pointOf(row)
    if (!ll) {
      missed.push(row)
      continue
    }
    const xy = to3857(ll)
    if (!xy) {
      missed.push(row)
      continue
    }
    located.push({ row, x: xy[0], y: xy[1] })
  }

  const rawGroups = clusterByDistance(located, LINK_DISTANCE_M)
  const groups: PointRow[][] = []
  for (const g of rawGroups) {
    groups.push(...splitOversized(g))
  }

  // 구역 정렬: 남서(작은 x,y) 우선
  groups.sort((a, b) => {
    const ea = extentOf(a)
    const eb = extentOf(b)
    const cxa = (ea[0] + ea[2]) / 2
    const cxb = (eb[0] + eb[2]) / 2
    if (cxa !== cxb) return cxa - cxb
    return (ea[1] + ea[3]) / 2 - (eb[1] + eb[3]) / 2
  })

  const zones: MeterZone[] = []
  let zoneIdx = 1
  for (const g of groups) {
    const ext = extentOf(g)
    zones.push({
      zoneId: `zone-${zoneIdx}`,
      label: `구역${zoneIdx}`,
      navigable: true,
      rowIds: g.map((p) => p.row.id),
      extent3857: ext,
    })
    zoneIdx += 1
  }

  if (missed.length > 0) {
    zones.push({
      zoneId: 'zone-miss',
      label: '미확인',
      navigable: false,
      rowIds: missed.map((r) => r.id),
      extent3857: null,
    })
  }

  return zones
}
