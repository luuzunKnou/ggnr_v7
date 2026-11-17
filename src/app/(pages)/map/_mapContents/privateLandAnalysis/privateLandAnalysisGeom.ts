import type { Coordinate } from 'ol/coordinate';
import MultiPolygon from 'ol/geom/MultiPolygon';
import Polygon from 'ol/geom/Polygon';
import type Geometry from 'ol/geom/Geometry';

/** [ax, ay, bx, by] */
type Seg = [number, number, number, number];

/** 절단선 양끝. path — 접선처럼 꺾인 선이면 양끝 포함 전체 꼭짓점 */
export type Chord = [Coordinate, Coordinate] & { path?: Coordinate[] };

/** 절단선 탐색 반경 (지도 좌표 단위) — 하천 폭보다 충분히 크게 */
const SEARCH_HALF = 3000;

export function toAreaGeometry(geom: Geometry | null | undefined): Polygon | MultiPolygon | null {
  if (geom instanceof Polygon || geom instanceof MultiPolygon) return geom;
  return null;
}

export function collectSegments(geom: Polygon | MultiPolygon): Seg[] {
  const polys = geom instanceof Polygon ? [geom.getCoordinates()] : geom.getCoordinates();
  const out: Seg[] = [];
  for (const rings of polys) {
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i += 1) {
        out.push([ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]]);
      }
    }
  }
  return out;
}

function chordAtAngle(segs: Seg[], px: number, py: number, rad: number): [number, number] | null {
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  let tNeg = -Infinity;
  let tPos = Infinity;
  for (const [ax, ay, bx, by] of segs) {
    const ex = bx - ax;
    const ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const wx = ax - px;
    const wy = ay - py;
    const s = (wx * dy - wy * dx) / den;
    if (s < 0 || s > 1) continue;
    const t = (wx * ey - wy * ex) / den;
    if (t < 0 && t > tNeg) tNeg = t;
    else if (t >= 0 && t < tPos) tPos = t;
  }
  if (!Number.isFinite(tNeg) || !Number.isFinite(tPos)) return null;
  return [tNeg, tPos];
}

/**
 * 면 안의 한 점에서 양쪽 경계까지 가장 짧게 가로지르는 선 (하천 폭 방향).
 * 점이 면 밖이면 null.
 */
export function shortestChordAt(geom: Polygon | MultiPolygon, segsAll: Seg[], p: Coordinate): Chord | null {
  if (!geom.intersectsCoordinate(p)) return null;
  return shortestChordInSegs(segsAll, p);
}

/** 면 안이라고 아는 점에서 경계(segs)까지 가장 짧게 가로지르는 선 */
function shortestChordInSegs(segsAll: Seg[], p: Coordinate): Chord | null {
  const [px, py] = p;
  const segs = segsAll.filter(
    ([ax, ay, bx, by]) =>
      Math.max(ax, bx) >= px - SEARCH_HALF &&
      Math.min(ax, bx) <= px + SEARCH_HALF &&
      Math.max(ay, by) >= py - SEARCH_HALF &&
      Math.min(ay, by) <= py + SEARCH_HALF
  );
  if (segs.length === 0) return null;

  type Best = { rad: number; t: [number, number]; len: number };
  const scan = (from: number, to: number, step: number, prev: Best | null): Best | null => {
    let best = prev;
    for (let deg = from; deg < to; deg += step) {
      const rad = (deg * Math.PI) / 180;
      const t = chordAtAngle(segs, px, py, rad);
      if (!t) continue;
      const len = t[1] - t[0];
      if (!best || len < best.len) best = { rad, t, len };
    }
    return best;
  };
  const coarse = scan(0, 180, 3, null);
  if (!coarse) return null;
  const coarseDeg = (coarse.rad * 180) / Math.PI;
  const fine = scan(coarseDeg - 3, coarseDeg + 3.01, 0.5, coarse) ?? coarse;

  const { rad, t } = fine;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  return [
    [px + t[0] * dx, py + t[0] * dy],
    [px + t[1] * dx, py + t[1] * dy],
  ];
}

/** 레이어 도형끼리 맞닿은 경계선(접선) — 꼭짓점 목록 */
export type Seam = Coordinate[];

/**
 * 접선 실제 길이가 하천 폭의 이 배수를 넘으면 하천을 따라 난 경계로 보고 제외.
 * 꺾인 접선(ㄴ자·지류 끝이 큰 하천 안으로 들어온 ㄷ자)은 모양 그대로 긋는다.
 */
const SEAM_MAX_PATH_WIDTH_FACTOR = 4;
/** 접선 길이가 이 위치 하천 폭(가장 짧은 가로선) × 이 배수보다 길면 하천을 가로지르는 접선이 아님 */
const SEAM_MAX_WIDTH_FACTOR = 2.5;

function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax;
  const ey = by - ay;
  const len2 = ex * ex + ey * ey;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / len2)) : 0;
  return Math.hypot(px - (ax + t * ex), py - (ay + t * ey));
}

function polylineDist(line: Seam, p: Coordinate): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i += 1) {
    const d = pointSegDist(p[0], p[1], line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}

/** 접선 토막 끝끼리 이 거리 안이면 같은 접선으로 잇는다 (지도 좌표 단위) */
const SEAM_JOIN_EPS = 0.5;
/** 접선 양끝이 면 경계에서 이 거리(폭 대비 비율·최소값) 안이어야 하천을 끝까지 가로지른 것으로 본다 */
const SEAM_EDGE_RATIO = 0.05;
const SEAM_EDGE_MIN = 0.5;
/** 이을 토막 수 상한 — 실데이터는 이웃 도형 꼭짓점이 어긋나 한 접선이 여러 토막으로 끊긴다(길이는 폭 판정이 막음) */
const SEAM_JOIN_MAX = 60;

function segsDist(segs: Seg[], p: Coordinate): number {
  let best = Infinity;
  for (const [ax, ay, bx, by] of segs) {
    const d = pointSegDist(p[0], p[1], ax, ay, bx, by);
    if (d < best) best = d;
  }
  return best;
}

function samePt(a: Coordinate, b: Coordinate): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= SEAM_JOIN_EPS;
}

function unit(from: Coordinate, to: Coordinate): Coordinate | null {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  return len > 1e-9 ? [(to[0] - from[0]) / len, (to[1] - from[1]) / len] : null;
}

/**
 * 다른 도형 경계가 만나는 점에서 끊긴 접선 토막을, 끝이 면 경계에 닿을 때까지 이어 붙인다.
 * 한 점에서 여러 토막이 갈라지면 가장 곧게 이어지는 토막을 고른다.
 */
function joinSeam(seams: Seam[], start: number, onEdge: (c: Coordinate) => boolean): Seam {
  let line = seams[start];
  const used = new Set([start]);
  /** atTail — 꼬리 쪽으로 이을지. 이어질 토막을 끝점부터 바깥 방향 순서로 */
  const bestNext = (atTail: boolean): { i: number; pts: Coordinate[] } | null => {
    const end = atTail ? line[line.length - 1] : line[0];
    const inner = atTail ? line[line.length - 2] : line[1];
    const dir = unit(inner, end);
    let best: { i: number; pts: Coordinate[]; cos: number } | null = null;
    for (let i = 0; i < seams.length; i += 1) {
      if (used.has(i) || seams[i].length < 2) continue;
      const s = seams[i];
      const pts = samePt(end, s[0]) ? s : samePt(end, s[s.length - 1]) ? [...s].reverse() : null;
      if (!pts) continue;
      const d = unit(pts[0], pts[1]);
      const cos = dir && d ? dir[0] * d[0] + dir[1] * d[1] : 0;
      if (!best || cos > best.cos) best = { i, pts, cos };
    }
    return best;
  };
  for (let step = 0; step < SEAM_JOIN_MAX; step += 1) {
    const extendTail = !onEdge(line[line.length - 1]);
    const extendHead = !onEdge(line[0]);
    if (!extendHead && !extendTail) break;
    const next = extendTail ? bestNext(true) : null;
    if (next) {
      line = [...line, ...next.pts.slice(1)];
      used.add(next.i);
      continue;
    }
    const prev = extendHead ? bestNext(false) : null;
    if (!prev) break;
    line = [...[...prev.pts].reverse().slice(0, -1), ...line];
    used.add(prev.i);
  }
  return line;
}

/** 접선 끝에서 바깥 경계가 이 각도 안으로 곧게 이어지면 그 경계를 따라 선을 늘인다 */
const EDGE_FOLLOW_COS = Math.cos((20 * Math.PI) / 180);
const EDGE_FOLLOW_STEPS = 60;
/** 접선 휨(양끝 직선 길이 대비)이 이 이하일 때만 경계를 따라 늘인다 */
const EDGE_FOLLOW_MAX_BEND = 0.15;
/** 경계 따라 늘이는 길이 상한(접선 길이 대비) — 이웃 도형이 훨씬 넓을 때 대비 */
const EDGE_FOLLOW_MAX_RATIO = 4;

/**
 * 접선 끝이 바깥 경계에 닿은 뒤에도 경계가 접선 방향으로 곧게 이어지면(이웃 도형이 먼저 끝난 경우),
 * 경계가 꺾이는 곳까지 따라가 늘린다. maxAdd 안에서 꺾이는 곳을 못 만나면(둑을 따라 계속 이어짐) 늘리지 않는다.
 */
function followEdge(line: Seam, segs: Seg[], tol: number, maxAdd: number): Seam {
  const walk = (end: Coordinate, inner: Coordinate): Coordinate[] => {
    const out: Coordinate[] = [];
    let cur = end;
    let dir = unit(inner, end);
    let added = 0;
    if (maxAdd <= 0) return out;
    for (let step = 0; step < EDGE_FOLLOW_STEPS && dir; step += 1) {
      let best: { q: Coordinate; cos: number; len: number } | null = null;
      for (const [ax, ay, bx, by] of segs) {
        if (pointSegDist(cur[0], cur[1], ax, ay, bx, by) > tol) continue;
        for (const q of [
          [ax, ay],
          [bx, by],
        ] as Coordinate[]) {
          const len = Math.hypot(q[0] - cur[0], q[1] - cur[1]);
          if (len <= tol) continue;
          const cos = (dir[0] * (q[0] - cur[0]) + dir[1] * (q[1] - cur[1])) / len;
          if (!best || cos > best.cos) best = { q, cos, len };
        }
      }
      if (best && best.cos < EDGE_FOLLOW_COS) return out;
      if (!best || added + best.len > maxAdd) return [];
      out.push(best.q);
      added += best.len;
      dir = unit(cur, best.q);
      cur = best.q;
    }
    return [];
  };
  const tail = walk(line[line.length - 1], line[line.length - 2]);
  const head = walk(line[0], line[1]);
  return [...[...head].reverse(), ...line, ...tail];
}

/**
 * 커서가 maxDist 안에서 하천을 가로지르는 접선에 가까우면 그 접선 양끝을 절단선으로 쓴다.
 * 끊긴 접선 토막은 이어 붙이고, 양끝이 면 경계(segs)에 닿지 않으면(하천 중간에서 끝나면) 제외.
 * 하천 방향으로 길게 난 접선·많이 휜 접선도 제외. 해당 없으면 null.
 * minEdgeTol — 면·접선을 화면 해상도로 단순화해 받은 경우 그 오차만큼 경계 판정을 늦춤.
 */
export function seamChordNear(
  seams: Seam[],
  p: Coordinate,
  maxDist: number,
  widthChord: Chord | null,
  segs: Seg[],
  minEdgeTol = 0
): Chord | null {
  if (seams.length === 0 || !widthChord) return null;
  const cursorWidth = Math.hypot(widthChord[1][0] - widthChord[0][0], widthChord[1][1] - widthChord[0][1]);
  let best: { chord: Chord; d: number } | null = null;
  for (let idx = 0; idx < seams.length; idx += 1) {
    if (seams[idx].length < 2 || polylineDist(seams[idx], p) > maxDist) continue;
    /** 합류부 꼭짓점 근처는 커서 위치 폭이 아주 짧게 잡히므로 접선 가운데 폭과 큰 쪽을 쓴다 */
    const s = seams[idx];
    const m0 = s[Math.floor((s.length - 1) / 2)];
    const m1 = s[Math.ceil((s.length - 1) / 2)];
    const seamMid: Coordinate = [(m0[0] + m1[0]) / 2, (m0[1] + m1[1]) / 2];
    const midChord = shortestChordInSegs(segs, seamMid);
    const midWidth = midChord ? Math.hypot(midChord[1][0] - midChord[0][0], midChord[1][1] - midChord[0][1]) : 0;
    const width = Math.max(cursorWidth, midWidth);
    const edgeTol = Math.max(SEAM_EDGE_MIN, width * SEAM_EDGE_RATIO, minEdgeTol);
    const onEdge = (c: Coordinate) => segsDist(segs, c) <= edgeTol;
    const joined = joinSeam(seams, idx, onEdge);
    if (joined.length < 2 || !onEdge(joined[0]) || !onEdge(joined[joined.length - 1])) continue;
    const ja = joined[0];
    const jb = joined[joined.length - 1];
    const jLen = Math.hypot(jb[0] - ja[0], jb[1] - ja[1]);
    if (jLen < 1e-6 || jLen > width * SEAM_MAX_WIDTH_FACTOR) continue;
    let pathLen = 0;
    for (let i = 0; i < joined.length - 1; i += 1) {
      pathLen += Math.hypot(joined[i + 1][0] - joined[i][0], joined[i + 1][1] - joined[i][1]);
    }
    if (pathLen > width * SEAM_MAX_PATH_WIDTH_FACTOR) continue;
    /** 곧은 접선만 경계를 따라 늘인다 — 꺾인 접선(ㄴ·ㄷ자)은 끝에서 지류 둑이 같은 방향으로 이어져도 늘이지 않음 */
    const bend = Math.max(...joined.map((c) => pointSegDist(c[0], c[1], ja[0], ja[1], jb[0], jb[1])));
    const line =
      bend <= jLen * EDGE_FOLLOW_MAX_BEND
        ? followEdge(joined, segs, edgeTol, Math.max(width * SEAM_MAX_WIDTH_FACTOR - jLen, jLen * EDGE_FOLLOW_MAX_RATIO))
        : joined;
    const a = line[0];
    const b = line[line.length - 1];
    const d = polylineDist(joined, p);
    if (d <= maxDist && (!best || d < best.d)) {
      const chord: Chord = [a, b];
      if (line.length > 2) chord.path = line;
      best = { chord, d };
    }
  }
  return best?.chord ?? null;
}

function cross(ox: number, oy: number, ax: number, ay: number, bx: number, by: number): number {
  return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
}

function chordsCross(a: Chord, b: Chord): boolean {
  const [[ax1, ay1], [ax2, ay2]] = a;
  const [[bx1, by1], [bx2, by2]] = b;
  const d1 = cross(bx1, by1, bx2, by2, ax1, ay1);
  const d2 = cross(bx1, by1, bx2, by2, ax2, ay2);
  const d3 = cross(ax1, ay1, ax2, ay2, bx1, by1);
  const d4 = cross(ax1, ay1, ax2, ay2, bx2, by2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** 시작·끝 중심 간 최소 거리 (지도 좌표 단위, 웹메르카토르 — 한국 기준 약 1.25배 m) */
const MIN_CHORD_GAP = 10;

/** 서버 계산 전 바로 걸러낼 수 있는 잘못된 시작·끝선. 문제 없으면 null */
export function invalidChordPair(c1: Chord, c2: Chord): string | null {
  if (chordsCross(c1, c2)) return '시작선과 끝선이 서로 겹칩니다. 끝 위치를 다시 지정하세요.';
  const m1: Coordinate = [(c1[0][0] + c1[1][0]) / 2, (c1[0][1] + c1[1][1]) / 2];
  const m2: Coordinate = [(c2[0][0] + c2[1][0]) / 2, (c2[0][1] + c2[1][1]) / 2];
  if (Math.hypot(m1[0] - m2[0], m1[1] - m2[1]) < MIN_CHORD_GAP) {
    return '시작과 끝이 너무 가깝습니다. 구간을 조금 더 벌려 지정하세요.';
  }
  return null;
}

/**
 * 커서가 면 밖이면 maxDist 안의 가장 가까운 경계 지점 바로 안쪽으로 붙임.
 * 하천을 따라 끝 위치를 끌 때 제방 밖으로 살짝 벗어나도 끊기지 않게 한다.
 */
export function snapInside(geom: Polygon | MultiPolygon, p: Coordinate, maxDist: number): Coordinate | null {
  if (geom.intersectsCoordinate(p)) return p;
  const q = geom.getClosestPoint(p);
  if (Math.hypot(q[0] - p[0], q[1] - p[1]) > maxDist) return null;
  for (const r of [0.5, 1.5, 3]) {
    for (let k = 0; k < 8; k += 1) {
      const a = (k * Math.PI) / 4;
      const c: Coordinate = [q[0] + r * Math.cos(a), q[1] + r * Math.sin(a)];
      if (geom.intersectsCoordinate(c)) return c;
    }
  }
  return null;
}
