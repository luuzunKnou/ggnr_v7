/**
 * 원본 도로구간(tl_sprd_manage) 경로망 탐색.
 * 안내는 원본 그대로. 경로 그래프는 서버가 교차·근접을 이은 망을 쓴다.
 */

import GeoJSON from "ol/format/GeoJSON";
import type { Coordinate } from "ol/coordinate";

export type Pt = [number, number];

export type RoadNetHit = {
  edgeId: number;
  /** 엣지 위 투영점 (3857) */
  point: Pt;
  /** 엣지 시작→투영점 누적거리(m) */
  alongM: number;
  dist: number;
  from: number;
  to: number;
};

export type BikeRoadNet = {
  nodes: Pt[];
  /** undirected edges: [fromNode, toNode, lengthM] */
  edges: [number, number, number][];
  /** 도로 전체 중심선 좌표 (끝점 접합만, 중간 정점은 기하만) */
  edgeCoords: Pt[][];
};

/**
 * 끝점·근접 접합 거리 (m).
 * 넓히면 안 닿는 옆길이 끌려와 경로가 V자로 꺾임 → 1m.
 */
const END_JOIN_M = 1;
/** T자·교차 근접 분할 (END_JOIN 과 동일) */
const T_JOIN_M = 1;
export const BIKE_ROAD_NET_MAX_RES = 12;
/** 안내선·원천 도로구간 (원본 유지) */
export const ROAD_LAYER = "tl_sprd_manage";
export const ROAD_SOURCE_LAYER = "tl_sprd_manage";

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function edgeLenM(coords: Pt[] | null | undefined): number {
  if (!coords || coords.length < 2) return 0;
  let m = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    if (!a || !b) continue;
    m += dist(a, b);
  }
  return m;
}

function projectOnSegment(
  p: Pt,
  a: Pt,
  b: Pt
): { point: Pt; t: number; dist: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) {
    return { point: a, t: 0, dist: dist(p, a) };
  }
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const point: Pt = [a[0] + dx * t, a[1] + dy * t];
  return { point, t, dist: dist(p, point) };
}

/** 폴리라인 최근접 — alongM·거리 */
function projectOnPolyline(
  p: Pt,
  coords: Pt[]
): { point: Pt; alongM: number; dist: number } | null {
  if (coords.length < 2) return null;
  let best: { point: Pt; alongM: number; dist: number } | null = null;
  let along = 0;
  for (let j = 0; j < coords.length - 1; j++) {
    const a = coords[j]!;
    const b = coords[j + 1]!;
    const hit = projectOnSegment(p, a, b);
    const alongM = along + dist(a, b) * hit.t;
    if (!best || hit.dist < best.dist) {
      best = { point: hit.point, alongM, dist: hit.dist };
    }
    along += dist(a, b);
  }
  return best;
}

function extractLineCoords(geom: {
  getType(): string;
  getCoordinates(): Coordinate[] | Coordinate[][] | Coordinate[][][];
}): Pt[][] {
  const type = geom.getType();
  if (type === "LineString") {
    const c = geom.getCoordinates() as Coordinate[];
    return [c.map((x) => [x[0]!, x[1]!] as Pt)];
  }
  if (type === "MultiLineString") {
    const lines = geom.getCoordinates() as Coordinate[][];
    return lines.map((line) => line.map((x) => [x[0]!, x[1]!] as Pt));
  }
  return [];
}

function pointAtAlong(coords: Pt[], alongM: number): Pt {
  if (coords.length < 2) return coords[0] ?? [0, 0];
  const target = Math.max(0, alongM);
  let acc = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i]!;
    const b = coords[i + 1]!;
    const seg = dist(a, b);
    if (acc + seg >= target - 1e-6) {
      const t = seg < 1e-9 ? 0 : (target - acc) / seg;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    acc += seg;
  }
  return coords[coords.length - 1]!;
}

function sliceEdgeCoords(coords: Pt[], fromAlong: number, toAlong: number): Pt[] {
  const lo = Math.min(fromAlong, toAlong);
  const hi = Math.max(fromAlong, toAlong);
  if (hi - lo < 0.05) {
    return [pointAtAlong(coords, fromAlong)];
  }
  const out: Pt[] = [pointAtAlong(coords, lo)];
  let acc = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i]!;
    const b = coords[i + 1]!;
    const seg = dist(a, b);
    const next = acc + seg;
    if (acc > lo + 1e-6 && acc < hi - 1e-6) {
      if (dist(out[out.length - 1]!, a) > 0.05) out.push(a);
    }
    acc = next;
  }
  const end = pointAtAlong(coords, hi);
  if (dist(out[out.length - 1]!, end) > 0.05) out.push(end);
  if (fromAlong > toAlong) out.reverse();
  return out;
}

/** 분할 위치에서 폴리라인을 여러 조각으로 */
function splitPolylineAt(coords: Pt[], cuts: number[]): Pt[][] {
  const len = edgeLenM(coords);
  const uniq = [...new Set(cuts.map((c) => Math.max(0, Math.min(len, c))))]
    .filter((c) => c > 0.4 && c < len - 0.4)
    .sort((a, b) => a - b);
  if (uniq.length === 0) return [coords];

  const parts: Pt[][] = [];
  let prev = 0;
  for (const c of uniq) {
    const part = sliceEdgeCoords(coords, prev, c);
    if (part.length >= 2 && edgeLenM(part) >= 0.05) parts.push(part);
    prev = c;
  }
  const last = sliceEdgeCoords(coords, prev, len);
  if (last.length >= 2 && edgeLenM(last) >= 0.05) parts.push(last);
  return parts.length ? parts : [coords];
}

/** 두 선분 교차 (끝점 근처 제외) */
function segmentIntersection(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const ax = b[0] - a[0];
  const ay = b[1] - a[1];
  const cx = d[0] - c[0];
  const cy = d[1] - c[1];
  const den = ax * cy - ay * cx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * cy - (c[1] - a[1]) * cx) / den;
  const u = ((c[0] - a[0]) * ay - (c[1] - a[1]) * ax) / den;
  if (t < 0.02 || t > 0.98 || u < 0.02 || u > 0.98) return null;
  return [a[0] + t * ax, a[1] + t * ay];
}

/** 두 선분 최근접 — 사거리에서 살짝 어긋난 선도 같은 노드로 이으려고 */
function closestApproachSegments(
  a0: Pt,
  a1: Pt,
  b0: Pt,
  b1: Pt
): { ta: number; tb: number; d: number; dirDot: number } | null {
  const ax = a1[0] - a0[0];
  const ay = a1[1] - a0[1];
  const bx = b1[0] - b0[0];
  const by = b1[1] - b0[1];
  const aLen = Math.hypot(ax, ay);
  const bLen = Math.hypot(bx, by);
  if (aLen < 1e-9 || bLen < 1e-9) return null;
  const dirDot = (ax * bx + ay * by) / (aLen * bLen);

  const samples: { ta: number; tb: number; d: number }[] = [];
  // 끝점→상대 선분 투영 4개 + 클램프된 무한직선 최근접
  {
    const ha0 = projectOnSegment(a0, b0, b1);
    samples.push({ ta: 0, tb: ha0.t, d: ha0.dist });
    const ha1 = projectOnSegment(a1, b0, b1);
    samples.push({ ta: 1, tb: ha1.t, d: ha1.dist });
    const hb0 = projectOnSegment(b0, a0, a1);
    samples.push({ ta: hb0.t, tb: 0, d: hb0.dist });
    const hb1 = projectOnSegment(b1, a0, a1);
    samples.push({ ta: hb1.t, tb: 1, d: hb1.dist });
  }
  {
    const rx = a0[0] - b0[0];
    const ry = a0[1] - b0[1];
    const aa = ax * ax + ay * ay;
    const bb = bx * bx + by * by;
    const ab = ax * bx + ay * by;
    const ar = ax * rx + ay * ry;
    const br = bx * rx + by * ry;
    const den = aa * bb - ab * ab;
    if (Math.abs(den) > 1e-12) {
      let ta = (ab * br - bb * ar) / den;
      let tb = (aa * br - ab * ar) / den;
      ta = Math.max(0, Math.min(1, ta));
      tb = Math.max(0, Math.min(1, tb));
      const pa: Pt = [a0[0] + ax * ta, a0[1] + ay * ta];
      const pb: Pt = [b0[0] + bx * tb, b0[1] + by * tb];
      samples.push({ ta, tb, d: dist(pa, pb) });
    }
  }

  let best: { ta: number; tb: number; d: number } | null = null;
  for (const s of samples) {
    if (!best || s.d < best.d) best = s;
  }
  if (!best) return null;
  return { ...best, dirDot };
}

/**
 * GeoJSON → 도로망 그래프.
 * 1) T자·교차에서 선 분할 2) 끝점 클러스터 접합
 */
export type BuildBikeRoadNetOpts = {
  /**
   * 빠른 구축 — 교차·근접 분할·degree2 dissolve 생략.
   * 그리기 모달 등 반응성 우선 시 사용.
   */
  fast?: boolean;
  /**
   * 교차·T접합은 하되 degree2 긴 선 합치기만 생략.
   * 서버 통판 로딩 단축용 (사거리 연결 유지).
   */
  skipDissolve?: boolean;
};

export function buildBikeRoadNetFromFeatures(
  features: import("ol/Feature").default[],
  opts?: BuildBikeRoadNetOpts
): BikeRoadNet {
  const fast = opts?.fast === true;
  const skipDissolve = opts?.skipDissolve === true || fast;
  // fast만 근접통과 생략 — quick으로 빼면 사거리 어긋난 도로가 안 이어져 경로가 이상해짐
  const skipNearCross = fast;
  const raw: Pt[][] = [];
  for (const f of features) {
    const geom = f.getGeometry();
    if (!geom) continue;
    for (const line of extractLineCoords(
      geom as unknown as {
        getType(): string;
        getCoordinates(): Coordinate[] | Coordinate[][] | Coordinate[][][];
      }
    )) {
      if (line.length < 2) continue;
      if (edgeLenM(line) < 0.05) continue;
      raw.push(line.map((p) => [p[0], p[1]] as Pt));
    }
  }

  // bbox 그리드 — T접합·교차 후보만 좁힘 (전체 O(n²) 방지)
  const gridCell = Math.max(40, END_JOIN_M * 4);
  const lineBoxes = raw.map((line) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of line) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    }
    return { minX, minY, maxX, maxY };
  });
  const lineGrid = new Map<string, number[]>();
  for (let i = 0; i < raw.length; i++) {
    const b = lineBoxes[i]!;
    const x0 = Math.floor(b.minX / gridCell);
    const x1 = Math.floor(b.maxX / gridCell);
    const y0 = Math.floor(b.minY / gridCell);
    const y1 = Math.floor(b.maxY / gridCell);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const key = `${gx}_${gy}`;
        if (!lineGrid.has(key)) lineGrid.set(key, []);
        lineGrid.get(key)!.push(i);
      }
    }
  }
  const nearbyLines = (i: number): number[] => {
    const b = lineBoxes[i]!;
    const pad = T_JOIN_M;
    const x0 = Math.floor((b.minX - pad) / gridCell);
    const x1 = Math.floor((b.maxX + pad) / gridCell);
    const y0 = Math.floor((b.minY - pad) / gridCell);
    const y1 = Math.floor((b.maxY + pad) / gridCell);
    const seen = new Set<number>();
    const out: number[] = [];
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        for (const j of lineGrid.get(`${gx}_${gy}`) ?? []) {
          if (j === i || seen.has(j)) continue;
          seen.add(j);
          out.push(j);
        }
      }
    }
    return out;
  };

  const cuts: number[][] = raw.map(() => []);
  const addCut = (li: number, along: number) => {
    cuts[li]!.push(along);
  };

  // T접합: 끝점이 옆 도로 중간에 붙으면 분할
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i]!;
    const ends: Pt[] = [line[0]!, line[line.length - 1]!];
    for (const ep of ends) {
      for (const j of nearbyLines(i)) {
        const hit = projectOnPolyline(ep, raw[j]!);
        if (!hit || hit.dist > T_JOIN_M) continue;
        const otherLen = edgeLenM(raw[j]!);
        if (hit.alongM <= T_JOIN_M || hit.alongM >= otherLen - T_JOIN_M) continue;
        addCut(j, hit.alongM);
      }
    }
  }

  // 사거리 교차·근접통과 — 경로 품질에 필수(끄면 블록 우회).
  // 속도: 선분 bbox가 멀면 closestApproach 자체를 호출하지 않음(품질 유지).
  if (!fast) {
    const nearPad = T_JOIN_M;
    for (let i = 0; i < raw.length; i++) {
      const A = raw[i]!;
      const lenA = edgeLenM(A);
      const boxA = lineBoxes[i]!;
      for (const j of nearbyLines(i)) {
        if (j <= i) continue;
        const B = raw[j]!;
        const lenB = edgeLenM(B);
        const boxB = lineBoxes[j]!;
        // 폴리라인 bbox가 이미 멀면 선분 루프 스킵
        if (
          boxA.maxX + nearPad < boxB.minX ||
          boxB.maxX + nearPad < boxA.minX ||
          boxA.maxY + nearPad < boxB.minY ||
          boxB.maxY + nearPad < boxA.minY
        ) {
          continue;
        }
        let alongA = 0;
        for (let ai = 0; ai < A.length - 1; ai++) {
          const a0 = A[ai]!;
          const a1 = A[ai + 1]!;
          const aSeg = dist(a0, a1);
          const aMinX = Math.min(a0[0], a1[0]) - nearPad;
          const aMaxX = Math.max(a0[0], a1[0]) + nearPad;
          const aMinY = Math.min(a0[1], a1[1]) - nearPad;
          const aMaxY = Math.max(a0[1], a1[1]) + nearPad;
          let alongB = 0;
          for (let bi = 0; bi < B.length - 1; bi++) {
            const b0 = B[bi]!;
            const b1 = B[bi + 1]!;
            const bSeg = dist(b0, b1);
            const bMinX = Math.min(b0[0], b1[0]);
            const bMaxX = Math.max(b0[0], b1[0]);
            const bMinY = Math.min(b0[1], b1[1]);
            const bMaxY = Math.max(b0[1], b1[1]);
            // 선분 bbox 멀면 교차·근접 모두 불필요
            if (
              aMaxX < bMinX ||
              bMaxX < aMinX ||
              aMaxY < bMinY ||
              bMaxY < aMinY
            ) {
              alongB += bSeg;
              continue;
            }
            const cross = segmentIntersection(a0, a1, b0, b1);
            if (cross) {
              addCut(i, alongA + dist(a0, cross));
              addCut(j, alongB + dist(b0, cross));
            } else if (!skipNearCross) {
              const near = closestApproachSegments(a0, a1, b0, b1);
              if (
                near &&
                near.d <= T_JOIN_M &&
                near.d > 0.05 &&
                Math.abs(near.dirDot) < 0.92
              ) {
                const ca = alongA + aSeg * near.ta;
                const cb = alongB + bSeg * near.tb;
                if (ca > T_JOIN_M && ca < lenA - T_JOIN_M) addCut(i, ca);
                if (cb > T_JOIN_M && cb < lenB - T_JOIN_M) addCut(j, cb);
              }
            }
            alongB += bSeg;
          }
          alongA += aSeg;
        }
      }
    }
  }

  const splitPieces: Pt[][] = [];
  for (let i = 0; i < raw.length; i++) {
    for (const part of splitPolylineAt(raw[i]!, cuts[i]!)) {
      splitPieces.push(part);
    }
  }

  // dissolve는 비용 큼 — skipDissolve/fast면 조각 그대로 노드 접합만
  const pieces = skipDissolve
    ? splitPieces
    : dissolveDegree2Chains(splitPieces, END_JOIN_M);

  // 끝점 클러스터 + 사거리 근접 노드를 통판으로 이음
  return linkNearbyNodes(buildNetFromPieces(pieces, END_JOIN_M), END_JOIN_M);
}

/**
 * 가까운 노드끼리 짧은 링크로 연결 — 이중선·사거리 중심선이
 * 살짝 어긋나도 통판처럼 한 망으로 이어지게 함.
 */
function linkNearbyNodes(net: BikeRoadNet, joinM: number): BikeRoadNet {
  const { nodes, edges, edgeCoords } = net;
  if (nodes.length < 2) return net;

  const linked = new Set<string>();
  for (const [a, b] of edges) {
    linked.add(`${Math.min(a, b)}_${Math.max(a, b)}`);
  }

  const cell = Math.max(8, joinM);
  const bucket = new Map<string, number[]>();
  const nextEdges: [number, number, number][] = [...edges];
  const nextCoords: Pt[][] = edgeCoords.map((c) => c.map((p) => [p[0], p[1]] as Pt));

  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i]!;
    const gx = Math.floor(p[0] / cell);
    const gy = Math.floor(p[1] / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of bucket.get(`${gx + dx}_${gy + dy}`) ?? []) {
          const q = nodes[j]!;
          const d = dist(p, q);
          if (d < 0.05 || d > joinM) continue;
          const key = `${Math.min(i, j)}_${Math.max(i, j)}`;
          if (linked.has(key)) continue;
          linked.add(key);
          nextEdges.push([i, j, d]);
          nextCoords.push([
            [p[0], p[1]],
            [q[0], q[1]],
          ]);
        }
      }
    }
    const key = `${gx}_${gy}`;
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key)!.push(i);
  }

  return { nodes, edges: nextEdges, edgeCoords: nextCoords };
}

/** GeoJSON FeatureCollection → 도로망 (서버·클라이언트 공용) */
export function buildBikeRoadNetFromGeoJson(
  json: { type?: string; features?: unknown[] },
  opts?: BuildBikeRoadNetOpts
): BikeRoadNet {
  const format = new GeoJSON();
  const features = format.readFeatures(json, {
    dataProjection: "EPSG:3857",
    featureProjection: "EPSG:3857",
  });
  return buildBikeRoadNetFromFeatures(features, opts);
}

/** 끝점이 가까운 조각들을 클러스터로 묶고, 분기·사거리가 아닌 곳은 한 선으로 합침 */
function dissolveDegree2Chains(input: Pt[][], joinM: number): Pt[][] {
  if (input.length <= 1) return input;

  type End = { p: Pt; piece: number; atStart: boolean };
  const ends: End[] = [];
  for (let i = 0; i < input.length; i++) {
    const line = input[i]!;
    if (line.length < 2) continue;
    ends.push({ p: line[0]!, piece: i, atStart: true });
    ends.push({ p: line[line.length - 1]!, piece: i, atStart: false });
  }
  if (ends.length < 2) return input;

  const parent = ends.map((_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r]!;
    let c = x;
    while (c !== r) {
      const n = parent[c]!;
      parent[c] = r;
      c = n;
    }
    return r;
  };
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const cell = joinM;
  const bucket = new Map<string, number[]>();
  for (let i = 0; i < ends.length; i++) {
    const p = ends[i]!.p;
    const gx = Math.floor(p[0] / cell);
    const gy = Math.floor(p[1] / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of bucket.get(`${gx + dx}_${gy + dy}`) ?? []) {
          if (dist(p, ends[j]!.p) <= joinM) unite(i, j);
        }
      }
    }
    const key = `${gx}_${gy}`;
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key)!.push(i);
  }

  type Link = { piece: number; other: number; leaveAtStart: boolean };
  const adj = new Map<number, Link[]>();
  const addLink = (cluster: number, link: Link) => {
    if (!adj.has(cluster)) adj.set(cluster, []);
    adj.get(cluster)!.push(link);
  };

  const startCluster = new Map<number, number>();
  const endCluster = new Map<number, number>();
  for (let i = 0; i < ends.length; i++) {
    const e = ends[i]!;
    const c = find(i);
    if (e.atStart) startCluster.set(e.piece, c);
    else endCluster.set(e.piece, c);
  }

  const livePieces = new Set<number>();
  for (const e of ends) livePieces.add(e.piece);

  for (const pi of livePieces) {
    const a = startCluster.get(pi);
    const b = endCluster.get(pi);
    if (a == null || b == null || a === b) continue;
    addLink(a, { piece: pi, other: b, leaveAtStart: false });
    addLink(b, { piece: pi, other: a, leaveAtStart: true });
  }

  const degree = (c: number) => (adj.get(c) ?? []).length;
  const usedPiece = new Set<number>();
  const out: Pt[][] = [];

  const walk = (startClusterId: number, first: Link) => {
    const coords: Pt[] = [];
    let cluster = startClusterId;
    let link: Link | null = first;
    while (link && !usedPiece.has(link.piece)) {
      usedPiece.add(link.piece);
      const line = input[link.piece]!;
      const forward = !link.leaveAtStart;
      const part = forward ? line : [...line].reverse();
      if (coords.length === 0) {
        for (const p of part) coords.push([p[0], p[1]]);
      } else {
        for (let i = 1; i < part.length; i++) {
          coords.push([part[i]![0], part[i]![1]]);
        }
      }
      cluster = link.other;
      // 차수 2면 반대쪽 미사용 링크로 계속
      if (degree(cluster) !== 2) break;
      const next = (adj.get(cluster) ?? []).find((l) => !usedPiece.has(l.piece));
      link = next ?? null;
    }
    if (coords.length >= 2) out.push(coords);
  };

  // 분기·막다른 곳에서 시작
  for (const [c, links] of adj) {
    if (degree(c) === 2) continue;
    for (const link of links) {
      if (usedPiece.has(link.piece)) continue;
      walk(c, link);
    }
  }
  // 순수 루프(모두 차수 2)
  for (const [c, links] of adj) {
    for (const link of links) {
      if (usedPiece.has(link.piece)) continue;
      walk(c, link);
    }
  }
  // 고립·미연결
  for (const pi of livePieces) {
    if (usedPiece.has(pi)) continue;
    const line = input[pi]!;
    if (line.length >= 2) out.push(line.map((p) => [p[0], p[1]] as Pt));
  }
  return out.length ? out : input;
}

function buildNetFromPieces(pieces: Pt[][], joinM: number): BikeRoadNet {
  const cell = joinM;
  const bucket = new Map<string, number[]>();
  const ends: { p: Pt; piece: number; atStart: boolean }[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const line = pieces[i]!;
    if (line.length < 2) continue;
    ends.push({ p: line[0]!, piece: i, atStart: true });
    ends.push({ p: line[line.length - 1]!, piece: i, atStart: false });
  }
  const parent = ends.map((_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r]!;
    let c = x;
    while (c !== r) {
      const n = parent[c]!;
      parent[c] = r;
      c = n;
    }
    return r;
  };
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < ends.length; i++) {
    const p = ends[i]!.p;
    const gx = Math.floor(p[0] / cell);
    const gy = Math.floor(p[1] / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${gx + dx}_${gy + dy}`;
        for (const j of bucket.get(key) ?? []) {
          if (dist(p, ends[j]!.p) <= joinM) unite(i, j);
        }
      }
    }
    const key = `${gx}_${gy}`;
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key)!.push(i);
  }

  const clusterNode = new Map<number, number>();
  const nodes: Pt[] = [];
  const edges: [number, number, number][] = [];
  const edgeCoords: Pt[][] = [];

  const nodeOfEnd = (endIdx: number): number => {
    const root = find(endIdx);
    let n = clusterNode.get(root);
    if (n != null) return n;
    let sx = 0;
    let sy = 0;
    let c = 0;
    for (let i = 0; i < ends.length; i++) {
      if (find(i) === root) {
        sx += ends[i]!.p[0];
        sy += ends[i]!.p[1];
        c++;
      }
    }
    n = nodes.length;
    nodes.push([sx / Math.max(1, c), sy / Math.max(1, c)]);
    clusterNode.set(root, n);
    return n;
  };

  const startEndIdx = new Map<number, number>();
  const lastEndIdx = new Map<number, number>();
  for (let i = 0; i < ends.length; i++) {
    const e = ends[i]!;
    if (e.atStart) startEndIdx.set(e.piece, i);
    else lastEndIdx.set(e.piece, i);
  }

  for (let i = 0; i < pieces.length; i++) {
    if (!startEndIdx.has(i) || !lastEndIdx.has(i)) continue;
    const coords = pieces[i]!.map((p) => [p[0], p[1]] as Pt);
    const from = nodeOfEnd(startEndIdx.get(i)!);
    const to = nodeOfEnd(lastEndIdx.get(i)!);
    if (from === to) continue;
    coords[0] = [nodes[from]![0], nodes[from]![1]];
    coords[coords.length - 1] = [nodes[to]![0], nodes[to]![1]];
    const len = edgeLenM(coords);
    if (len < 0.05) continue;
    edges.push([from, to, len]);
    edgeCoords.push(coords);
  }

  return { nodes, edges, edgeCoords };
}

export type BikeRoadNetLoadResult = {
  net: BikeRoadNet;
  /** 실제 조회에 쓴 bbox (캐시 판별용) */
  bufferedBbox: [number, number, number, number];
  /**
   * 원본 도로구간 좌표 (안내선용).
   * 그래프용으로 자른 edgeCoords 와 분리 — 화면은 원본 모양 유지.
   */
  guideLines?: Pt[][];
};

/** 화면 extent가 캐시 bbox 안쪽(여유 포함)에 있으면 재로드 불필요 */
export function netCacheCoversView(
  cached: [number, number, number, number],
  view: [number, number, number, number],
  marginRatio = 0.08
): boolean {
  const [cx0, cy0, cx1, cy1] = cached;
  const [vx0, vy0, vx1, vy1] = view;
  const mx = (cx1 - cx0) * marginRatio;
  const my = (cy1 - cy0) * marginRatio;
  return (
    vx0 >= cx0 + mx &&
    vy0 >= cy0 + my &&
    vx1 <= cx1 - mx &&
    vy1 <= cy1 - my
  );
}

/** 두 bbox 합집합 */
export function unionBbox3857(
  a: [number, number, number, number],
  b: [number, number, number, number]
): [number, number, number, number] {
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}

/**
 * 인접 타일 도로망 합치기 — 이동 시 기존 망을 버리지 않고 확장.
 * (교체하면 찍은 점이 엉뚱한 도로에 붙음)
 */
export function mergeBikeRoadNets(a: BikeRoadNet, b: BikeRoadNet): BikeRoadNet {
  const pieces = [...a.edgeCoords, ...b.edgeCoords].filter((c) => c.length >= 2);
  if (pieces.length === 0) {
    return { nodes: [], edges: [], edgeCoords: [] };
  }
  return linkNearbyNodes(buildNetFromPieces(pieces, END_JOIN_M), END_JOIN_M);
}

/** 점 → 가장 가까운 엣지 투영 */
export function projectOnNet(
  net: BikeRoadNet,
  p: Pt,
  maxDistM: number
): RoadNetHit | null {
  const hits = projectOnNetAll(net, p, maxDistM, 1);
  return hits[0] ?? null;
}

/** 점 근처 엣지 투영들 (엣지당 1개, 거리순) — 우회 의심 시 대체 스냅용 */
function projectOnNetAll(
  net: BikeRoadNet,
  p: Pt,
  maxDistM: number,
  limit: number
): RoadNetHit[] {
  const byEdge = new Map<number, RoadNetHit>();

  for (let i = 0; i < net.edgeCoords.length; i++) {
    const coords = net.edgeCoords[i]!;
    const [from, to] = net.edges[i]!;
    let along = 0;
    for (let j = 0; j < coords.length - 1; j++) {
      const a = coords[j]!;
      const b = coords[j + 1]!;
      const hit = projectOnSegment(p, a, b);
      const alongM = along + dist(a, b) * hit.t;
      if (hit.dist <= maxDistM) {
        const cand: RoadNetHit = {
          edgeId: i,
          point: hit.point,
          alongM,
          dist: hit.dist,
          from,
          to,
        };
        const prev = byEdge.get(i);
        if (!prev || hit.dist < prev.dist) byEdge.set(i, cand);
      }
      along += dist(a, b);
    }
  }

  return [...byEdge.values()]
    .sort((a, b) => a.dist - b.dist)
    .slice(0, Math.max(1, limit));
}

function neighbors(
  net: BikeRoadNet,
  node: number
): { to: number; w: number; edgeId: number }[] {
  const out: { to: number; w: number; edgeId: number }[] = [];
  for (let i = 0; i < net.edges.length; i++) {
    const [a, b, w] = net.edges[i]!;
    if (a === node) out.push({ to: b, w, edgeId: i });
    else if (b === node) out.push({ to: a, w, edgeId: i });
  }
  return out;
}

function appendPath(out: Pt[], next: Pt[]) {
  for (const p of next) {
    if (!out.length || dist(out[out.length - 1]!, p) > 0.05) out.push(p);
  }
}

/**
 * 사거리를 지나 짧게 나갔다 꺾인 꼭짓점만 제거.
 * 블록 모서리(직각·긴 변)는 건드리지 않음 — 좌·우 한쪽만 잘라 반대가 뜨는 일 방지.
 */
function trimJunctionSpurs(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts.map((p) => [p[0], p[1]] as Pt);
  const out: Pt[] = [[pts[0]![0], pts[0]![1]]];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = out[out.length - 1]!;
    const cur = pts[i]!;
    const next = pts[i + 1]!;
    const d01 = dist(prev, cur);
    const d12 = dist(cur, next);
    const d02 = dist(prev, next);
    if (d02 <= END_JOIN_M + 4 && d01 + d12 > d02 * 1.25 + 1.5) {
      continue;
    }
    const ax = cur[0] - prev[0];
    const ay = cur[1] - prev[1];
    const bx = next[0] - cur[0];
    const by = next[1] - cur[1];
    const al = Math.hypot(ax, ay);
    const bl = Math.hypot(bx, by);
    if (al > 0.5 && bl > 0.5) {
      const dot = (ax / al) * (bx / bl) + (ay / al) * (by / bl);
      if (dot < -0.35 && Math.min(d01, d12) <= END_JOIN_M + 4) continue;
    }
    out.push([cur[0], cur[1]]);
  }
  out.push([pts[pts.length - 1]![0], pts[pts.length - 1]![1]]);
  return out.length >= 2 ? out : pts.map((p) => [p[0], p[1]] as Pt);
}

/**
 * 두 투영점 사이 도로 따라 경로 (3857).
 * 같은 선이면 선 위 구간 vs 다른 길로 우회 중 짧은 쪽.
 * 직선 지름길 금지. 블록 한 바퀴 우회가 의심되면 근처 다른 스냅 조합도 본다.
 */
export function netPath(
  net: BikeRoadNet,
  from: RoadNetHit,
  to: RoadNetHit
): Pt[] | null {
  let best = netPathCore(net, from, to);
  let bestLen = best && best.length >= 2 ? edgeLenM(best) : Infinity;
  const crow = dist(from.point, to.point);

  // 가까운데 한 바퀴 도는 경우 — 근처 다른 도로 스냅으로 재탐색
  const detour =
    Number.isFinite(bestLen) &&
    crow < 160 &&
    bestLen > Math.max(crow * 2.2, crow + 35);
  if (detour) {
    const tol = Math.max(22, crow * 0.35);
    const fromHits = projectOnNetAll(net, from.point, tol, 8);
    const toHits = projectOnNetAll(net, to.point, tol, 8);
    for (const a of fromHits) {
      for (const b of toHits) {
        const p = netPathCore(net, a, b);
        if (!p || p.length < 2) continue;
        const len = edgeLenM(p);
        if (len + 0.5 < bestLen) {
          best = p;
          bestLen = len;
        }
      }
    }
  }

  return best;
}

function netPathCore(
  net: BikeRoadNet,
  from: RoadNetHit,
  to: RoadNetHit
): Pt[] | null {
  if (from.edgeId === to.edgeId) {
    const coords = net.edgeCoords[from.edgeId];
    if (!coords) return null;
    const direct = sliceEdgeCoords(coords, from.alongM, to.alongM);
    const directLen =
      direct.length >= 2 ? edgeLenM(direct) : Math.abs(from.alongM - to.alongM);
    const crow = dist(from.point, to.point);
    // 합친 긴 선이 블록을 한 바퀴 도는 경우 — 끝점 우회가 더 짧으면 그쪽
    const via = netPathViaGraph(net, from, to);
    const viaLen = via && via.length >= 2 ? edgeLenM(via) : Infinity;
    if (via && viaLen + 0.5 < directLen) return via;
    // 선 위 직행이 직선보다 훨씬 길면(한 바퀴) 직행 우선하지 않음
    if (directLen > Math.max(crow * 2.2, crow + 35)) {
      if (via && via.length >= 2) return via;
      return null;
    }
    if (direct.length >= 2) return direct;
    return via;
  }

  const out = netPathViaGraph(net, from, to);
  if (!out || out.length < 2) return null;

  const pathLen = edgeLenM(out);
  const straight = dist(from.point, to.point);
  if (straight > 40 && pathLen < straight * 1.05 && out.length <= 3) {
    return null;
  }
  return out;
}

/** Dijkstra — from/to 엣지를 끝점 경유로 연결 */
function netPathViaGraph(
  net: BikeRoadNet,
  from: RoadNetHit,
  to: RoadNetHit
): Pt[] | null {
  type Adj = { to: number; w: number; edgeId: number };
  const adj = new Map<number, Adj[]>();
  const add = (a: number, b: number, w: number, edgeId: number) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ to: b, w, edgeId });
  };

  for (let i = 0; i < net.edges.length; i++) {
    if (i === from.edgeId || i === to.edgeId) continue;
    const [a, b, w] = net.edges[i]!;
    add(a, b, w, i);
    add(b, a, w, i);
  }

  const startA = from.from;
  const startB = from.to;
  const endA = to.from;
  const endB = to.to;
  const fromCoords = net.edgeCoords[from.edgeId];
  const toCoords = net.edgeCoords[to.edgeId];
  if (!fromCoords || !toCoords) return null;
  const fromLen = edgeLenM(fromCoords);
  const toLen = edgeLenM(toCoords);

  const startNode = -1;
  const endNode = -2;
  add(startNode, startA, from.alongM, from.edgeId);
  add(startA, startNode, from.alongM, from.edgeId);
  add(startNode, startB, Math.max(0, fromLen - from.alongM), from.edgeId);
  add(startB, startNode, Math.max(0, fromLen - from.alongM), from.edgeId);
  add(endNode, endA, to.alongM, to.edgeId);
  add(endA, endNode, to.alongM, to.edgeId);
  add(endNode, endB, Math.max(0, toLen - to.alongM), to.edgeId);
  add(endB, endNode, Math.max(0, toLen - to.alongM), to.edgeId);

  // 같은 엣지: 끝점만 거쳐 다시 들어오는 경로(링·우회) 탐색용으로
  // from/to가 동일 엣지여도 start↔end 연결은 끝점 가중치로만 둠 (선 위 직행은 netPath에서 따로)

  const distMap = new Map<number, number>();
  const prevNode = new Map<number, number>();
  const prevEdge = new Map<number, number>();
  const pq: { n: number; d: number }[] = [{ n: startNode, d: 0 }];
  distMap.set(startNode, 0);

  while (pq.length) {
    let bestI = 0;
    for (let i = 1; i < pq.length; i++) {
      if (pq[i]!.d < pq[bestI]!.d) bestI = i;
    }
    const cur = pq.splice(bestI, 1)[0]!;
    if (cur.n === endNode) break;
    if ((distMap.get(cur.n) ?? Infinity) < cur.d - 1e-6) continue;
    for (const e of adj.get(cur.n) ?? []) {
      const nd = cur.d + e.w;
      if (nd < (distMap.get(e.to) ?? Infinity)) {
        distMap.set(e.to, nd);
        prevNode.set(e.to, cur.n);
        prevEdge.set(e.to, e.edgeId);
        pq.push({ n: e.to, d: nd });
      }
    }
  }

  if (!distMap.has(endNode)) return null;

  const nodeChain: number[] = [];
  let n: number | undefined = endNode;
  while (n !== undefined) {
    nodeChain.push(n);
    if (n === startNode) break;
    n = prevNode.get(n);
  }
  nodeChain.reverse();
  if (nodeChain[0] !== startNode) return null;

  const firstReal = nodeChain[1];
  if (firstReal == null) return null;
  let leaveAlong: number;
  if (firstReal === startA) leaveAlong = 0;
  else if (firstReal === startB) leaveAlong = fromLen;
  else return null;

  const lastReal = nodeChain[nodeChain.length - 2];
  if (lastReal == null) return null;
  let enterAlong: number;
  if (lastReal === endA) enterAlong = 0;
  else if (lastReal === endB) enterAlong = toLen;
  else return null;

  // 중간 도로 먼저 구성 — 출발/도착 끝점 과잉(모서리 튀어나옴) 보정에 사용
  const mid: Pt[] = [];
  for (let i = 1; i < nodeChain.length - 1; i++) {
    const a = nodeChain[i]!;
    const b = nodeChain[i + 1]!;
    if (b === endNode) break;
    const edgeId = prevEdge.get(b);
    if (edgeId == null) return null;
    if (edgeId === from.edgeId || edgeId === to.edgeId) continue;
    const coords = net.edgeCoords[edgeId]!;
    const [ef, et] = net.edges[edgeId]!;
    if (a === ef && b === et) {
      appendPath(mid, coords);
    } else if (a === et && b === ef) {
      appendPath(mid, [...coords].reverse());
    } else {
      return null;
    }
  }

  // 도착: 이전 지점이 목표 도로의 [끝점↔목표] 구간에 있으면 그 지점부터
  // (끝으로 나갔다 오는 튀어나옴 제거 — 출발 보정과 대칭)
  {
    const prevHint = mid.length > 0 ? mid[mid.length - 1]! : from.point;
    const onTo = projectOnPolyline(prevHint, toCoords);
    if (onTo && onTo.dist <= END_JOIN_M + 2) {
      const lo = Math.min(enterAlong, to.alongM);
      const hi = Math.max(enterAlong, to.alongM);
      if (onTo.alongM >= lo - 1 && onTo.alongM <= hi + 1) {
        enterAlong = onTo.alongM;
      }
    }
  }

  const tail = sliceEdgeCoords(toCoords, enterAlong, to.alongM);
  if (tail.length < 1) return null;

  // 출발: 다음 지점이 출발 도로의 [클릭↔끝점] 구간에 있으면 그 지점까지만
  {
    const nextHint = mid.length > 0 ? mid[0]! : tail[0]!;
    const onFrom = projectOnPolyline(nextHint, fromCoords);
    if (onFrom && onFrom.dist <= END_JOIN_M + 2) {
      const lo = Math.min(from.alongM, leaveAlong);
      const hi = Math.max(from.alongM, leaveAlong);
      if (onFrom.alongM >= lo - 1 && onFrom.alongM <= hi + 1) {
        leaveAlong = onFrom.alongM;
      }
    }
  }

  const head = sliceEdgeCoords(fromCoords, from.alongM, leaveAlong);
  const out: Pt[] = [];
  appendPath(out, head);
  appendPath(out, mid);
  appendPath(out, tail);

  if (out.length < 2) return null;
  const cleaned = trimJunctionSpurs(out);
  cleaned[0] = [from.point[0], from.point[1]];
  cleaned[cleaned.length - 1] = [to.point[0], to.point[1]];
  return cleaned.length >= 2 ? cleaned : out;
}

/** 스냅 허용 거리 (합친 도로구간 중심선) */
export function snapTolM(resolution: number): number {
  return Math.max(10, resolution * 16);
}

export { neighbors, dist as ptDist };
