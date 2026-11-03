import { fromLonLat } from "ol/proj";

export type RoadLedgerVideoTrack = {
  /** done=자동 맞춤 완료, failed=분석 실패, none=분석 전 */
  status: "done" | "failed" | "none";
  /** 분석 요청이 걸려 있어 서버가 곧 (다시) 분석함 */
  queued?: boolean;
  direction?: "forward" | "reverse";
  durationSec?: number;
  routeLengthM: number;
  /** 경위도 노선 — anchors 의 노선 거리 기준선 */
  line: [number, number][];
  /** [영상 초, 노선 시작 기준 m] */
  anchors: [number, number][];
  /** anchors 와 같은 순서 — 영상 속 차 정면(도, 영상 가운데 0·오른쪽 +) */
  fronts?: number[];
  loops: [number, number][];
  message?: string;
  analyzedAt?: string;
};

/** 지도 좌표(3857)로 바꾼 노선과 누적 길이 */
export type RoadLedgerVideoRoute = {
  coords: [number, number][];
  cum: number[];
  total: number;
};

export function buildRoadLedgerVideoRoute(lineLonLat: [number, number][]): RoadLedgerVideoRoute | null {
  const coords = lineLonLat
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => fromLonLat(p) as [number, number]);
  if (coords.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < coords.length; i += 1) {
    cum.push(cum[i - 1]! + Math.hypot(coords[i]![0] - coords[i - 1]![0], coords[i]![1] - coords[i - 1]![1]));
  }
  const total = cum[cum.length - 1]!;
  return total > 0 ? { coords, cum, total } : null;
}

/** 파일명으로 추정하는 방향 — 분석 전 시간 비율 위치에 쓴다 */
export function roadLedgerVideoFallbackReverse(fileName: string): boolean {
  return fileName.includes("하행");
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** 영상 시각 → 노선 비율(0=노선 시작, 1=끝) */
export function roadLedgerVideoFracAtTime(
  track: RoadLedgerVideoTrack | null,
  t: number,
  duration: number,
  fallbackReverse: boolean
): number {
  const a = track?.status === "done" ? track.anchors : [];
  if (a.length >= 2 && track!.routeLengthM > 0) {
    if (t <= a[0]![0]) return clamp01(a[0]![1] / track!.routeLengthM);
    for (let i = 1; i < a.length; i += 1) {
      const [t1, m1] = a[i]!;
      if (t <= t1) {
        const [t0, m0] = a[i - 1]!;
        const k = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
        return clamp01((m0 + (m1 - m0) * k) / track!.routeLengthM);
      }
    }
    return clamp01(a[a.length - 1]![1] / track!.routeLengthM);
  }
  const f = duration > 0 ? clamp01(t / duration) : 0;
  return fallbackReverse ? 1 - f : f;
}

/** 영상 시각의 차 정면이 360° 영상에서 어느 방향인지(도, 영상 가운데 0·오른쪽 +). 자료 없으면 0 */
export function roadLedgerVideoFrontAtTime(track: RoadLedgerVideoTrack | null, t: number): number {
  const a = track?.status === "done" ? track.anchors : [];
  const f = track?.fronts;
  if (!f || f.length !== a.length || a.length === 0) return 0;
  let i = 1;
  while (i < a.length - 1 && a[i]![0] < t) i += 1;
  const t0 = a[i - 1]![0];
  const t1 = a[i]![0];
  const k = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
  const d = ((f[i]! - f[i - 1]! + 540) % 360) - 180;
  return f[i - 1]! + d * k;
}

/** 노선 비율 → 영상 시각. 같은 곳을 여러 번 지나면(교차로 회전) 처음 지나는 시각 */
export function roadLedgerVideoTimeAtFrac(
  track: RoadLedgerVideoTrack | null,
  frac: number,
  duration: number,
  fallbackReverse: boolean
): number {
  const a = track?.status === "done" ? track.anchors : [];
  if (a.length >= 2 && track!.routeLengthM > 0) {
    const target = clamp01(frac) * track!.routeLengthM;
    for (let i = 1; i < a.length; i += 1) {
      const [t0, m0] = a[i - 1]!;
      const [t1, m1] = a[i]!;
      if ((target - m0) * (target - m1) <= 0 && m0 !== m1) {
        return t0 + ((target - m0) / (m1 - m0)) * (t1 - t0);
      }
    }
    let best = a[0]!;
    for (const p of a) if (Math.abs(p[1] - target) < Math.abs(best[1] - target)) best = p;
    return best[0];
  }
  const f = fallbackReverse ? 1 - clamp01(frac) : clamp01(frac);
  return f * Math.max(0, duration);
}

/** 노선 비율 → 지도 좌표·진행 방향(라디안, 북쪽 0 시계방향) */
export function roadLedgerVideoPointAtFrac(
  route: RoadLedgerVideoRoute,
  frac: number,
  travelReverse: boolean
): { coord: [number, number]; heading: number } {
  const d = clamp01(frac) * route.total;
  let i = 1;
  while (i < route.cum.length - 1 && route.cum[i]! < d) i += 1;
  const p0 = route.coords[i - 1]!;
  const p1 = route.coords[i]!;
  const seg = route.cum[i]! - route.cum[i - 1]!;
  const k = seg > 0 ? (d - route.cum[i - 1]!) / seg : 0;
  const coord: [number, number] = [p0[0] + (p1[0] - p0[0]) * k, p0[1] + (p1[1] - p0[1]) * k];
  let heading = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
  if (travelReverse) heading += Math.PI;
  return { coord, heading };
}

/** 지도 좌표 → 노선 위 가장 가까운 비율과 거리(지도 단위) */
export function roadLedgerVideoNearestFrac(
  route: RoadLedgerVideoRoute,
  coord: [number, number]
): { frac: number; dist: number } {
  let best = { frac: 0, dist: Infinity };
  for (let i = 1; i < route.coords.length; i += 1) {
    const [ax, ay] = route.coords[i - 1]!;
    const [bx, by] = route.coords[i]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const k = len2 > 0 ? Math.min(1, Math.max(0, ((coord[0] - ax) * dx + (coord[1] - ay) * dy) / len2)) : 0;
    const px = ax + dx * k;
    const py = ay + dy * k;
    const dist = Math.hypot(coord[0] - px, coord[1] - py);
    if (dist < best.dist) {
      best = { frac: (route.cum[i - 1]! + Math.sqrt(len2) * k) / route.total, dist };
    }
  }
  return best;
}

/** 노선 비율 구간 [a, b] 의 지도 좌표 */
export function roadLedgerVideoSlice(route: RoadLedgerVideoRoute, a: number, b: number): [number, number][] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const start = roadLedgerVideoPointAtFrac(route, lo, false).coord;
  const end = roadLedgerVideoPointAtFrac(route, hi, false).coord;
  const out: [number, number][] = [start];
  for (let i = 0; i < route.coords.length; i += 1) {
    const f = route.cum[i]! / route.total;
    if (f > lo && f < hi) out.push(route.coords[i]!);
  }
  out.push(end);
  return out;
}
