import { transformCoordinate } from '../../../_mapComponents/services/coordinateService'
import type { MeterLocateResult } from './locateMeterAddresses'

/**
 * 한 구역 = 축척막대 ~35m일 때 한 화면에 담기는 범위.
 * (가로 420m × 세로 210m — 격자 스냅 없이 연속 군집)
 */
const MAX_ZONE_WIDTH_M = 420
const MAX_ZONE_HEIGHT_M = 210
/** 구역 내 점 개수 ≤ 이 값이면 왼쪽 시작 고정 열린 경로 완전탐색(DP) */
const EXACT_PATH_MAX_N = 15

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

function dist(a: PointRow, b: PointRow): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** 가장 왼쪽(서) 우선 — X 작음 → 같으면 북(Y 큼) */
function compareWestmost(a: PointRow, b: PointRow): number {
  if (a.x !== b.x) return a.x - b.x
  if (a.y !== b.y) return b.y - a.y
  return a.row.id.localeCompare(b.row.id)
}

function fitsOneScreen(pts: PointRow[]): boolean {
  if (pts.length <= 1) return true
  const [xmin, ymin, xmax, ymax] = extentOf(pts)
  return xmax - xmin <= MAX_ZONE_WIDTH_M && ymax - ymin <= MAX_ZONE_HEIGHT_M
}

function centerDist(a: PointRow[], b: PointRow[]): number {
  const ea = extentOf(a)
  const eb = extentOf(b)
  const cxa = (ea[0] + ea[2]) / 2
  const cya = (ea[1] + ea[3]) / 2
  const cxb = (eb[0] + eb[2]) / 2
  const cyb = (eb[1] + eb[3]) / 2
  return Math.hypot(cxa - cxb, cya - cyb)
}

/** 최소 점간 거리 (가까운 급수전 우선 병합) */
function minPointDist(a: PointRow[], b: PointRow[]): number {
  let best = Infinity
  for (const p of a) {
    for (const q of b) {
      const d = dist(p, q)
      if (d < best) best = d
    }
  }
  return best
}

/**
 * 한 화면에 들어가는 동안 가장 가까운 군집부터 합친다.
 * 격자 칸 경계로 갈라지지 않음.
 */
function clusterFitOneScreen(points: PointRow[]): PointRow[][] {
  if (points.length === 0) return []
  const clusters: PointRow[][] = points.map((p) => [p])

  while (clusters.length > 1) {
    let bestI = -1
    let bestJ = -1
    let bestD = Infinity
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const merged = [...clusters[i]!, ...clusters[j]!]
        if (!fitsOneScreen(merged)) continue
        const d = minPointDist(clusters[i]!, clusters[j]!)
        if (d < bestD) {
          bestD = d
          bestI = i
          bestJ = j
        }
      }
    }
    if (bestI < 0 || bestJ < 0) break
    const merged = [...clusters[bestI]!, ...clusters[bestJ]!]
    const next: PointRow[][] = []
    for (let k = 0; k < clusters.length; k++) {
      if (k === bestI || k === bestJ) continue
      next.push(clusters[k]!)
    }
    next.push(merged)
    clusters.length = 0
    clusters.push(...next)
  }

  // 같은 화면인데 아직 떨어진 군집이 있으면 중심 거리로 한 번 더 흡수
  let changed = true
  while (changed && clusters.length > 1) {
    changed = false
    let bestI = -1
    let bestJ = -1
    let bestD = Infinity
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const merged = [...clusters[i]!, ...clusters[j]!]
        if (!fitsOneScreen(merged)) continue
        const d = centerDist(clusters[i]!, clusters[j]!)
        if (d < bestD) {
          bestD = d
          bestI = i
          bestJ = j
        }
      }
    }
    if (bestI < 0 || bestJ < 0) break
    const merged = [...clusters[bestI]!, ...clusters[bestJ]!]
    const next: PointRow[][] = []
    for (let k = 0; k < clusters.length; k++) {
      if (k === bestI || k === bestJ) continue
      next.push(clusters[k]!)
    }
    next.push(merged)
    clusters.length = 0
    clusters.push(...next)
    changed = true
  }

  return clusters
}

function pathLength(path: PointRow[]): number {
  let sum = 0
  for (let i = 1; i < path.length; i++) sum += dist(path[i - 1]!, path[i]!)
  return sum
}

/** 탐욕 NN 시드 — 시작점 고정 (A→C→D→B 함정에 빠질 수 있음) */
function nearestNeighborFrom(start: PointRow, others: PointRow[]): PointRow[] {
  const remaining = [...others]
  const path: PointRow[] = [start]
  while (remaining.length > 0) {
    const cur = path[path.length - 1]!
    let bestIdx = 0
    let bestD = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = dist(cur, remaining[i]!)
      if (d < bestD) {
        bestD = d
        bestIdx = i
      }
    }
    path.push(remaining.splice(bestIdx, 1)[0]!)
  }
  return path
}

/**
 * 최저비용 삽입 — 시작 고정.
 * A-B≈A-C 일 때 막다른 C→D를 먼저 채우지 않고 전체 증가분이 작은 쪽을 고름.
 */
function cheapestInsertionFrom(start: PointRow, others: PointRow[]): PointRow[] {
  const path: PointRow[] = [start]
  const remaining = [...others]
  while (remaining.length > 0) {
    let bestAdd = Infinity
    let bestRi = 0
    let bestPos = 1
    for (let ri = 0; ri < remaining.length; ri++) {
      const p = remaining[ri]!
      for (let pos = 1; pos <= path.length; pos++) {
        const prev = path[pos - 1]!
        const next = pos < path.length ? path[pos]! : null
        const add = next
          ? dist(prev, p) + dist(p, next) - dist(prev, next)
          : dist(prev, p)
        if (add < bestAdd) {
          bestAdd = add
          bestRi = ri
          bestPos = pos
        }
      }
    }
    path.splice(bestPos, 0, remaining.splice(bestRi, 1)[0]!)
  }
  return path
}

/** 열린 경로 2-opt — index 0(시작) 고정 */
function twoOptImprove(path: PointRow[]): PointRow[] {
  if (path.length < 4) return path
  const out = [...path]
  let improved = true
  while (improved) {
    improved = false
    for (let i = 1; i < out.length - 1; i++) {
      for (let k = i + 1; k < out.length; k++) {
        const a = out[i - 1]!
        const b = out[i]!
        const c = out[k]!
        const dNext = k + 1 < out.length ? out[k + 1]! : null
        const before = dist(a, b) + (dNext ? dist(c, dNext) : 0)
        const after = dist(a, c) + (dNext ? dist(b, dNext) : 0)
        if (after + 1e-9 < before) {
          const rev = out.slice(i, k + 1).reverse()
          out.splice(i, k - i + 1, ...rev)
          improved = true
        }
      }
    }
  }
  return out
}

/**
 * Or-opt — 시작 고정. 연속 1~3점을 다른 위치에 옮겨
 * A→C→D→B→E→F 를 A→B→E→F→C→D 형태로 개선.
 */
function orOptImprove(path: PointRow[]): PointRow[] {
  if (path.length < 4) return path
  const out = [...path]
  let improved = true
  while (improved) {
    improved = false
    const baseLen = pathLength(out)
    outer: for (const len of [3, 2, 1]) {
      for (let i = 1; i + len - 1 < out.length; i++) {
        const seg = out.slice(i, i + len)
        const without = [...out.slice(0, i), ...out.slice(i + len)]
        for (let j = 1; j <= without.length; j++) {
          if (j === i) continue
          const cand = [...without.slice(0, j), ...seg, ...without.slice(j)]
          if (pathLength(cand) + 1e-9 < baseLen) {
            out.splice(0, out.length, ...cand)
            improved = true
            break outer
          }
        }
      }
    }
  }
  return out
}

function improvePath(path: PointRow[]): PointRow[] {
  return twoOptImprove(orOptImprove(twoOptImprove(path)))
}

/** 구역 내 — 왼쪽(시작) 고정 열린 경로 최단 (Held-Karp) */
function exactOpenPathFromStart(start: PointRow, others: PointRow[]): PointRow[] {
  const nodes = [start, ...others]
  const n = nodes.length
  if (n <= 2) return nodes

  const d: number[][] = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = dist(nodes[i]!, nodes[j]!)
      d[i]![j] = v
      d[j]![i] = v
    }
  }

  const full = 1 << n
  const INF = Number.POSITIVE_INFINITY
  const dp: number[][] = Array.from({ length: full }, () => Array(n).fill(INF))
  const parent: number[][] = Array.from({ length: full }, () => Array(n).fill(-1))
  dp[1]![0] = 0

  for (let mask = 1; mask < full; mask++) {
    for (let j = 0; j < n; j++) {
      if ((mask & (1 << j)) === 0) continue
      const cur = dp[mask]![j]!
      if (!Number.isFinite(cur)) continue
      for (let k = 0; k < n; k++) {
        if ((mask & (1 << k)) !== 0) continue
        const nextMask = mask | (1 << k)
        const nd = cur + d[j]![k]!
        if (nd < dp[nextMask]![k]!) {
          dp[nextMask]![k] = nd
          parent[nextMask]![k] = j
        }
      }
    }
  }

  const all = full - 1
  let end = 1
  let best = INF
  for (let j = 1; j < n; j++) {
    const v = dp[all]![j]!
    if (v < best) {
      best = v
      end = j
    }
  }

  const orderIdx: number[] = []
  let mask = all
  let cur = end
  while (cur >= 0) {
    orderIdx.push(cur)
    const p = parent[mask]![cur]!
    if (p < 0) break
    mask ^= 1 << cur
    cur = p
  }
  orderIdx.reverse()
  if (orderIdx[0] !== 0) {
    return improvePath(nearestNeighborFrom(start, others))
  }
  return orderIdx.map((i) => nodes[i]!)
}

/**
 * 구역 내 최단 방문 경로 (동일인 전 지점 방문).
 * 1) 가장 왼쪽 = 1번(시작 고정)
 * 2) 나머지 최단 열린 경로
 *    - 소규모: 정확해(DP)
 *    - 그 이상: NN·최저삽입 시드 + 2-opt/Or-opt
 * A-B≈A-C 여도 막다른 C→D를 먼저 도는 A→C→D→B… 대신 A→B→E→F→C→D 선택.
 */
function optimizeVisitPathInZone(pts: PointRow[]): PointRow[] {
  if (pts.length <= 1) return [...pts]
  const sorted = [...pts].sort(compareWestmost)
  const start = sorted[0]!
  const others = sorted.slice(1)
  if (others.length === 0) return [start]
  if (others.length === 1) return [start, others[0]!]

  if (pts.length <= EXACT_PATH_MAX_N) {
    return exactOpenPathFromStart(start, others)
  }

  const candidates = [
    improvePath(nearestNeighborFrom(start, others)),
    improvePath(cheapestInsertionFrom(start, others)),
  ]
  let best = candidates[0]!
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]!
    if (pathLength(c) + 1e-9 < pathLength(best)) best = c
  }
  return best
}

function zoneStartWestmost(pts: PointRow[]): PointRow {
  return [...pts].sort(compareWestmost)[0]!
}

/** 구역 나눔 화면 바깥 여유(m) — 폴리곤이 경계에 딱 붙지 않게 */
const ZONE_EXTENT_BUFFER_M = 5

/**
 * 구역 폴리곤·맞춤용 extent = 구역 나눔 화면(MAX_ZONE_WIDTH×HEIGHT) + buffer.
 * 점 bbox가 아니라 군집 중심 기준 한 화면 범위.
 */
function zoneDivisionExtent(
  ext: [number, number, number, number]
): [number, number, number, number] {
  const [xmin, ymin, xmax, ymax] = ext
  const cx = (xmin + xmax) / 2
  const cy = (ymin + ymax) / 2
  const halfW = MAX_ZONE_WIDTH_M / 2 + ZONE_EXTENT_BUFFER_M
  const halfH = MAX_ZONE_HEIGHT_M / 2 + ZONE_EXTENT_BUFFER_M
  return [cx - halfW, cy - halfH, cx + halfW, cy + halfH]
}

/**
 * 1) 한 화면 단위로 구역 묶기
 * 2) 구역 안에서만 최단 방문 경로
 * 3) 구역 간은 왼쪽 구역부터 끝점→다음 시작점 최근접
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

  const groups = clusterFitOneScreen(located)

  // 구역 내 경로만 최적화
  const paths = groups.map((g) => optimizeVisitPathInZone(g))

  // 구역 간: 가장 왼쪽 구역부터 → 이전 끝점에서 다음 구역(최서쪽 시작점)까지 최근접.
  // 구역 안 번호 1번은 항상 최서쪽 — 연결을 위해 경로를 뒤집지 않음.
  const remainingPaths = [...paths]
  remainingPaths.sort((a, b) =>
    compareWestmost(zoneStartWestmost(a), zoneStartWestmost(b))
  )
  const orderedPaths: PointRow[][] = []
  if (remainingPaths.length > 0) {
    orderedPaths.push(remainingPaths.shift()!)
    while (remainingPaths.length > 0) {
      const prevEnd = orderedPaths[orderedPaths.length - 1]!.at(-1)!
      let bestIdx = 0
      let bestD = Infinity
      for (let i = 0; i < remainingPaths.length; i++) {
        const head = remainingPaths[i]![0]!
        const d = dist(prevEnd, head)
        if (d < bestD) {
          bestD = d
          bestIdx = i
        }
      }
      orderedPaths.push(remainingPaths.splice(bestIdx, 1)[0]!)
    }
  }

  const zones: MeterZone[] = []
  let zoneIdx = 1
  for (const ordered of orderedPaths) {
    zones.push({
      zoneId: `zone-${zoneIdx}`,
      label: `구역${zoneIdx}`,
      navigable: true,
      rowIds: ordered.map((p) => p.row.id),
      extent3857: zoneDivisionExtent(extentOf(ordered)),
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
