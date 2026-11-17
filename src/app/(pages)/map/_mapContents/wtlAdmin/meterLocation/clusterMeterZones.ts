import { transformCoordinate } from '../../../_mapComponents/services/coordinateService'
import type { MeterLocateResult } from './locateMeterAddresses'

/**
 * 한 구역 = 축척막대 ~35m일 때 한 화면에 담기는 범위.
 * (가로 420m × 세로 210m — 격자 스냅 없이 연속 군집)
 */
const MAX_ZONE_WIDTH_M = 420
const MAX_ZONE_HEIGHT_M = 210

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
      const d = Math.hypot(p.x - q.x, p.y - q.y)
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

function padExtent(
  ext: [number, number, number, number]
): [number, number, number, number] {
  let [xmin, ymin, xmax, ymax] = ext
  const w = xmax - xmin
  const h = ymax - ymin
  if (w < 2 && h < 2) {
    const cx = (xmin + xmax) / 2
    const cy = (ymin + ymax) / 2
    const pad = 40
    return [cx - pad, cy - pad, cx + pad, cy + pad]
  }
  return [xmin, ymin, xmax, ymax]
}

/**
 * 위치 있는 계량기를 한 화면(420×210m) 단위로 구역 묶기.
 * 못 찾은 항목은 「미확인」.
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
    zones.push({
      zoneId: `zone-${zoneIdx}`,
      label: `구역${zoneIdx}`,
      navigable: true,
      rowIds: g.map((p) => p.row.id),
      extent3857: padExtent(extentOf(g)),
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
