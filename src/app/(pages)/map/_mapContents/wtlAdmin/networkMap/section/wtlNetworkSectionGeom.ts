/** 관망조회 단면도 — 라인·거리·교차 기하 (클라이언트) */

export type Pt3857 = [number, number]

export function meterToProjAtY3857(y3857: number): number {
  const latRad = 2 * Math.atan(Math.exp(y3857 / 6378137)) - Math.PI / 2
  const cosLat = Math.cos(latRad)
  if (!Number.isFinite(cosLat) || cosLat < 0.2) return 1
  return 1 / cosLat
}

export function lineLengthM(coords: Pt3857[]): number {
  if (coords.length < 2) return 0
  const midY = coords.reduce((s, c) => s + c[1], 0) / coords.length
  const m2p = meterToProjAtY3857(midY)
  let total = 0
  for (let i = 1; i < coords.length; i++) {
    total += Math.hypot(coords[i]![0] - coords[i - 1]![0], coords[i]![1] - coords[i - 1]![1]) / m2p
  }
  return total
}

/** 점 → 폴리라인 최근접 지점의 누적 거리(m) */
export function projectDistAlongLineM(coords: Pt3857[], px: number, py: number): number {
  if (coords.length < 2) return 0
  const midY = coords.reduce((s, c) => s + c[1], 0) / coords.length
  const m2p = meterToProjAtY3857(midY)
  let bestD2 = Infinity
  let bestDist = 0
  let walked = 0
  for (let i = 1; i < coords.length; i++) {
    const ax = coords[i - 1]![0]
    const ay = coords[i - 1]![1]
    const bx = coords[i]![0]
    const by = coords[i]![1]
    const dx = bx - ax
    const dy = by - ay
    const segLenProj = Math.hypot(dx, dy)
    const segLenM = segLenProj / m2p
    let t = 0
    if (segLenProj > 1e-9) {
      t = ((px - ax) * dx + (py - ay) * dy) / (segLenProj * segLenProj)
      t = Math.min(1, Math.max(0, t))
    }
    const qx = ax + dx * t
    const qy = ay + dy * t
    const d2 = (px - qx) ** 2 + (py - qy) ** 2
    if (d2 < bestD2) {
      bestD2 = d2
      bestDist = walked + segLenM * t
    }
    walked += segLenM
  }
  return bestDist
}

/**
 * 횡단 — 절단선과 관 라인의 실제 교차점만 (없으면 null).
 */
export function pipeCutIntersect3857(
  cut: Pt3857[],
  pipe: Pt3857[]
): { x: number; y: number; distM: number } | null {
  if (cut.length < 2 || pipe.length < 2) return null
  for (let i = 1; i < cut.length; i++) {
    const a0 = cut[i - 1]!
    const a1 = cut[i]!
    for (let j = 1; j < pipe.length; j++) {
      const b0 = pipe[j - 1]!
      const b1 = pipe[j]!
      const hit = segmentIntersect(a0, a1, b0, b1)
      if (hit) {
        return { x: hit[0], y: hit[1], distM: projectDistAlongLineM(cut, hit[0], hit[1]) }
      }
    }
  }
  return null
}

/** 점 → 폴리라인 최근접 거리(지표 m) */
export function distToLineM(coords: Pt3857[], px: number, py: number): number {
  if (coords.length < 2) return Infinity
  const midY = coords.reduce((s, c) => s + c[1], 0) / coords.length
  const m2p = meterToProjAtY3857(midY)
  let best = Infinity
  for (let i = 1; i < coords.length; i++) {
    const ax = coords[i - 1]![0]
    const ay = coords[i - 1]![1]
    const bx = coords[i]![0]
    const by = coords[i]![1]
    const dx = bx - ax
    const dy = by - ay
    const segLenProj = Math.hypot(dx, dy)
    let t = 0
    if (segLenProj > 1e-9) {
      t = ((px - ax) * dx + (py - ay) * dy) / (segLenProj * segLenProj)
      t = Math.min(1, Math.max(0, t))
    }
    const qx = ax + dx * t
    const qy = ay + dy * t
    const d = Math.hypot(px - qx, py - qy) / m2p
    if (d < best) best = d
  }
  return best
}

/**
 * 종단 — 관로 버텍스를 절단선에 투영한 거리 구간.
 */
export function pipeSpanAlongLineM(
  cut: Pt3857[],
  pipe: Pt3857[]
): { fromM: number; toM: number; midM: number } | null {
  if (cut.length < 2 || pipe.length < 2) return null
  let minD = Infinity
  let maxD = -Infinity
  for (const p of pipe) {
    const d = projectDistAlongLineM(cut, p[0], p[1])
    if (d < minD) minD = d
    if (d > maxD) maxD = d
  }
  if (!Number.isFinite(minD) || !Number.isFinite(maxD)) return null
  if (maxD - minD < 0.05) {
    // 점이면 짧은 구간으로 보이게
    const mid = (minD + maxD) / 2
    return { fromM: mid - 0.4, toM: mid + 0.4, midM: mid }
  }
  return { fromM: minD, toM: maxD, midM: (minD + maxD) / 2 }
}

function segmentIntersect(
  a0: Pt3857,
  a1: Pt3857,
  b0: Pt3857,
  b1: Pt3857
): Pt3857 | null {
  const ax = a1[0] - a0[0]
  const ay = a1[1] - a0[1]
  const bx = b1[0] - b0[0]
  const by = b1[1] - b0[1]
  const den = ax * by - ay * bx
  if (Math.abs(den) < 1e-12) return null
  const t = ((b0[0] - a0[0]) * by - (b0[1] - a0[1]) * bx) / den
  const u = ((b0[0] - a0[0]) * ay - (b0[1] - a0[1]) * ax) / den
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return [a0[0] + ax * t, a0[1] + ay * t]
}

/**
 * 절단선 밑변 + 좌측 깊이(halfWidthM) 사각형 링 (EPSG:3857, 닫힘).
 * ThreeJs `sectionRectRing3857` 과 동일 규칙.
 */
export function sectionCutRectRing3857(
  start3857: Pt3857,
  end3857: Pt3857,
  halfWidthM: number
): Pt3857[] {
  let ax = start3857[0]
  let ay = start3857[1]
  let bx = end3857[0]
  let by = end3857[1]
  // 좌→우(서→동) 정규화
  if (bx < ax || (bx === ax && by < ay)) {
    ;[ax, ay, bx, by] = [bx, by, ax, ay]
  }
  const my = (ay + by) / 2
  let dx = bx - ax
  let dy = by - ay
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) {
    const m2p = meterToProjAtY3857(my)
    const h = Math.max(1, halfWidthM) * m2p
    return [
      [ax - h, ay - h],
      [ax + h, ay - h],
      [ax + h, ay + h],
      [ax - h, ay + h],
      [ax - h, ay - h],
    ]
  }
  dx /= len
  dy /= len
  const m2p = meterToProjAtY3857(my)
  const depthProj = Math.max(1, halfWidthM) * m2p
  const ox = -dy * depthProj
  const oy = dx * depthProj
  return [
    [ax, ay],
    [bx, by],
    [bx + ox, by + oy],
    [ax + ox, ay + oy],
    [ax, ay],
  ]
}

/** WKT LineString(EPSG:5181) → 좌표 5181 */
export function parseLineWkt5181(wkt: string): Pt3857[] {
  const m = String(wkt ?? '').match(/LINESTRING\s*\(([^)]+)\)/i)
  if (!m?.[1]) return []
  const out: Pt3857[] = []
  for (const part of m[1].split(',')) {
    const nums = part.trim().split(/\s+/).map(Number)
    if (nums.length >= 2 && Number.isFinite(nums[0]) && Number.isFinite(nums[1])) {
      out.push([nums[0]!, nums[1]!])
    }
  }
  return out
}
