/**
 * 도로구간(tl_sprd_manage) 클라이언트 네트워크.
 * 사유지분석이 실폭도로를 한 면으로 합치듯, 도로구간 조각을 이어 붙여
 * 하나의 경로망으로 쓴 뒤 두 스냅점 사이 중심선 최단경로를 구한다.
 */

import GeoJSON from "ol/format/GeoJSON";
import type { Coordinate } from "ol/coordinate";
import { fetchWfsGeoJsonByBbox } from "@/lib/geoserverWfs";

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

/** 끝점·교차 접합 허용 (사거리 끝점이 수 m 어긋나도 이음) */
const END_JOIN_M = 10;
/** T자·교차: 끝점이 다른 도로 중간에 가까우면 그 위치에서 분할 */
const T_JOIN_M = 10;
/** 구간 추가·경로망 원천 — 도로구간 (조각 → 하나로 이어 붙여 사용) */
const ROAD_LAYER = "tl_sprd_manage";
const WFS_MAX = 2500;
export const BIKE_ROAD_NET_MAX_RES = 12;

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

/**
 * GeoJSON → 도로망 그래프.
 * 1) T자·교차에서 선 분할 2) 끝점 클러스터 접합
 */
export function buildBikeRoadNetFromFeatures(
  features: import("ol/Feature").default[]
): BikeRoadNet {
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

  // 사거리 통과형 교차 — 근처 선만
  for (let i = 0; i < raw.length; i++) {
    const A = raw[i]!;
    for (const j of nearbyLines(i)) {
      if (j <= i) continue;
      const B = raw[j]!;
      let alongA = 0;
      for (let ai = 0; ai < A.length - 1; ai++) {
        const a0 = A[ai]!;
        const a1 = A[ai + 1]!;
        const aSeg = dist(a0, a1);
        let alongB = 0;
        for (let bi = 0; bi < B.length - 1; bi++) {
          const b0 = B[bi]!;
          const b1 = B[bi + 1]!;
          const bSeg = dist(b0, b1);
          const cross = segmentIntersection(a0, a1, b0, b1);
          if (cross) {
            addCut(i, alongA + dist(a0, cross));
            addCut(j, alongB + dist(b0, cross));
          }
          alongB += bSeg;
        }
        alongA += aSeg;
      }
    }
  }

  const splitPieces: Pt[][] = [];
  for (let i = 0; i < raw.length; i++) {
    for (const part of splitPolylineAt(raw[i]!, cuts[i]!)) {
      splitPieces.push(part);
    }
  }

  // 꺾임만 있는 구간(차수 2)은 한 줄로 이어 붙임 — 조각난 도로구간을 실폭처럼 연속 망으로
  const pieces = dissolveDegree2Chains(splitPieces, END_JOIN_M);

  return buildNetFromPieces(pieces, END_JOIN_M);
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

export async function loadBikeRoadNetByBbox(
  bbox: [number, number, number, number],
  opts?: { resolution?: number }
): Promise<BikeRoadNet | null> {
  const res = opts?.resolution;
  if (res != null && res > BIKE_ROAD_NET_MAX_RES) {
    return null;
  }
  const [minX, minY, maxX, maxY] = bbox;
  const dx = (maxX - minX) * 0.12;
  const dy = (maxY - minY) * 0.12;
  const buffered: [number, number, number, number] = [
    minX - dx,
    minY - dy,
    maxX + dx,
    maxY + dy,
  ];
  const json = await fetchWfsGeoJsonByBbox({
    layerName: ROAD_LAYER,
    bbox: buffered,
    srsName: "EPSG:3857",
    maxFeatures: WFS_MAX,
  });
  if (!json?.features?.length) return null;
  const format = new GeoJSON();
  const features = format.readFeatures(json, {
    dataProjection: "EPSG:3857",
    featureProjection: "EPSG:3857",
  });
  return buildBikeRoadNetFromFeatures(features);
}

export type ProjectOnNetOpts = {
  /** 직전 스냅 엣지 — 평행도로로 튀지 않게 우선 */
  preferEdgeId?: number | null;
  /** 선호 엣지 허용 여유 (m). 이보다 멀면 일반 최근접 */
  preferSlackM?: number;
};

/** 점 → 가장 가까운 엣지 투영 (드래그 중엔 preferEdgeId로 고착) */
export function projectOnNet(
  net: BikeRoadNet,
  p: Pt,
  maxDistM: number,
  opts?: ProjectOnNetOpts
): RoadNetHit | null {
  let best: RoadNetHit | null = null;
  let preferred: RoadNetHit | null = null;
  const preferId = opts?.preferEdgeId;
  const slack = opts?.preferSlackM ?? 8;

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
        if (!best || hit.dist < best.dist) best = cand;
        if (
          preferId != null &&
          i === preferId &&
          (!preferred || hit.dist < preferred.dist)
        ) {
          preferred = cand;
        }
      }
      along += dist(a, b);
    }
  }

  if (
    preferred &&
    best &&
    preferred.edgeId === preferId &&
    preferred.dist <= best.dist + slack
  ) {
    return preferred;
  }
  return best;
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
 * 두 투영점 사이 도로 따라 경로 (3857).
 * 같은 선이면 선 위 구간 vs 다른 길로 우회 중 짧은 쪽.
 * 직선 지름길 금지.
 */
export function netPath(
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
    // 합친 긴 선이 블록을 한 바퀴 도는 경우 — 끝점 우회가 더 짧으면 그쪽
    const via = netPathViaGraph(net, from, to);
    const viaLen = via && via.length >= 2 ? edgeLenM(via) : Infinity;
    if (via && viaLen + 0.5 < directLen) return via;
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

/**
 * 드래그 한 스텝 — 최단경로(Dijkstra) 사용 안 함.
 * 같은 선 슬라이스, 또는 사거리에서 맞닿은 선으로만 한 칸 꺾기.
 */
export function netPathFollowStep(
  net: BikeRoadNet,
  from: RoadNetHit,
  to: RoadNetHit
): Pt[] | null {
  const fromCoords = net.edgeCoords[from.edgeId];
  const toCoords = net.edgeCoords[to.edgeId];
  if (!fromCoords || !toCoords) return null;

  if (from.edgeId === to.edgeId) {
    const sliced = sliceEdgeCoords(fromCoords, from.alongM, to.alongM);
    if (sliced.length < 2) {
      return dist(from.point, to.point) < 0.5 ? [from.point, to.point] : null;
    }
    const stepLen = edgeLenM(sliced);
    const crow = dist(from.point, to.point);
    if (crow > 2 && stepLen > Math.max(crow * 2.2, crow + 20)) {
      return null;
    }
    return sliced;
  }

  // 사거리·T자: 공유 노드(또는 끝점이 가까운 노드)로만 한 번 꺾기
  const hop = junctionHop(net, from, to);
  if (!hop) return null;
  const stepLen = edgeLenM(hop);
  const crow = dist(from.point, to.point);
  if (stepLen > Math.max(crow * 2.5, crow + 30, 45)) return null;
  return hop;
}

/** 두 엣지가 맞닿는 지점으로만 연결 (다중 우회 금지) */
function junctionHop(
  net: BikeRoadNet,
  from: RoadNetHit,
  to: RoadNetHit
): Pt[] | null {
  const fromCoords = net.edgeCoords[from.edgeId];
  const toCoords = net.edgeCoords[to.edgeId];
  if (!fromCoords || !toCoords) return null;
  const fromLen = edgeLenM(fromCoords);
  const toLen = edgeLenM(toCoords);

  type End = { node: number; along: number; pt: Pt };
  const fromEnds: End[] = [
    { node: from.from, along: 0, pt: fromCoords[0]! },
    {
      node: from.to,
      along: fromLen,
      pt: fromCoords[fromCoords.length - 1]!,
    },
  ];
  const toEnds: End[] = [
    { node: to.from, along: 0, pt: toCoords[0]! },
    { node: to.to, along: toLen, pt: toCoords[toCoords.length - 1]! },
  ];

  let best: { fe: End; te: End; d: number } | null = null;
  for (const fe of fromEnds) {
    for (const te of toEnds) {
      const sameNode = fe.node === te.node;
      const near = dist(fe.pt, te.pt) <= END_JOIN_M;
      if (!sameNode && !near) continue;
      const d = dist(fe.pt, te.pt);
      if (!best || d < best.d) best = { fe, te, d };
    }
  }
  if (!best) return null;

  // 현재 위치가 해당 끝점과 너무 멀면(아직 사거리 전) 꺾지 않음
  const toJunction = Math.abs(from.alongM - best.fe.along);
  if (toJunction > 35 && dist(from.point, best.fe.pt) > 35) return null;

  const part1 = sliceEdgeCoords(fromCoords, from.alongM, best.fe.along);
  const part2 = sliceEdgeCoords(toCoords, best.te.along, to.alongM);
  const out: Pt[] = [];
  appendPath(out, part1.length ? part1 : [from.point]);
  if (best.d > 0.05) appendPath(out, [best.te.pt]);
  appendPath(out, part2.length ? part2 : [to.point]);
  return out.length >= 2 ? out : null;
}

/**
 * 드래그 스냅 — 직전 도로·진행 방향·사거리 연결을 보고 고름.
 * 최단거리 도로로 마음대로 튀지 않게 함.
 */
export function projectOnNetForDrag(
  net: BikeRoadNet,
  p: Pt,
  maxDistM: number,
  from: RoadNetHit,
  moveVec: Pt | null
): RoadNetHit | null {
  const fromCoords = net.edgeCoords[from.edgeId];
  if (!fromCoords) {
    return projectOnNet(net, p, maxDistM);
  }
  const fromLen = edgeLenM(fromCoords);
  const nearStart = from.alongM < 28;
  const nearEnd = from.alongM > fromLen - 28;

  const moveLen = moveVec ? Math.hypot(moveVec[0], moveVec[1]) : 0;
  const hasMove = moveLen > 1e-3;
  const mx = hasMove ? moveVec![0] / moveLen : 0;
  const my = hasMove ? moveVec![1] / moveLen : 0;

  type Cand = RoadNetHit & { score: number };
  let best: Cand | null = null;

  for (let i = 0; i < net.edgeCoords.length; i++) {
    const coords = net.edgeCoords[i];
    if (!coords || coords.length < 2) continue;
    const [ef, et] = net.edges[i]!;
    let along = 0;
    for (let j = 0; j < coords.length - 1; j++) {
      const a = coords[j]!;
      const b = coords[j + 1]!;
      const hit = projectOnSegment(p, a, b);
      const alongM = along + dist(a, b) * hit.t;
      along += dist(a, b);
      if (hit.dist > maxDistM) continue;

      let score = -hit.dist;

      if (i === from.edgeId) {
        // 같은 선 유지 보너스 — 사거리 근처면 약하게
        score += nearStart || nearEnd ? 6 : 14;
        // 진행 방향과 along 변화가 맞으면 가산
        if (hasMove) {
          const dAlong = alongM - from.alongM;
          const alongDir: Pt =
            dAlong >= 0
              ? [b[0] - a[0], b[1] - a[1]]
              : [a[0] - b[0], a[1] - b[1]];
          const al = Math.hypot(alongDir[0], alongDir[1]) || 1;
          const align = (alongDir[0] / al) * mx + (alongDir[1] / al) * my;
          score += align * 10;
        }
      } else {
        const shares =
          ef === from.from ||
          ef === from.to ||
          et === from.from ||
          et === from.to;
        const endNear =
          dist(coords[0]!, fromCoords[0]!) <= END_JOIN_M ||
          dist(coords[0]!, fromCoords[fromCoords.length - 1]!) <= END_JOIN_M ||
          dist(coords[coords.length - 1]!, fromCoords[0]!) <= END_JOIN_M ||
          dist(coords[coords.length - 1]!, fromCoords[fromCoords.length - 1]!) <=
            END_JOIN_M;

        if (!shares && !endNear) {
          // 연결 안 된 도로 — 강하게 감점 (최단으로 튀는 것 방지)
          score -= 40;
        } else if (!(nearStart || nearEnd)) {
          // 아직 사거리 전인데 다른 선으로 점프 — 감점
          score -= 18;
        } else {
          // 사거리에서 옆길로 — 드래그 방향 정렬이 중요
          score += 8;
          if (hasMove) {
            const vx = hit.point[0] - from.point[0];
            const vy = hit.point[1] - from.point[1];
            const vl = Math.hypot(vx, vy) || 1;
            const align = (vx / vl) * mx + (vy / vl) * my;
            score += align * 22;
          }
        }
      }

      if (!best || score > best.score) {
        best = {
          edgeId: i,
          point: hit.point,
          alongM,
          dist: hit.dist,
          from: ef,
          to: et,
          score,
        };
      }
    }
  }
  return best;
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

  const out: Pt[] = [];

  {
    const firstReal = nodeChain[1];
    if (firstReal == null) return null;
    if (firstReal === startA) {
      appendPath(out, sliceEdgeCoords(fromCoords, from.alongM, 0));
    } else if (firstReal === startB) {
      appendPath(out, sliceEdgeCoords(fromCoords, from.alongM, fromLen));
    } else {
      return null;
    }
  }

  for (let i = 1; i < nodeChain.length - 1; i++) {
    const a = nodeChain[i]!;
    const b = nodeChain[i + 1]!;
    if (b === endNode) break;
    const edgeId = prevEdge.get(b);
    if (edgeId == null) return null;
    // 끝점 가상 이동(from/to 엣지)은 앞·뒤 slice에서 이미 반영
    if (edgeId === from.edgeId || edgeId === to.edgeId) {
      continue;
    }
    const coords = net.edgeCoords[edgeId]!;
    const [ef, et] = net.edges[edgeId]!;
    if (a === ef && b === et) {
      appendPath(out, coords);
    } else if (a === et && b === ef) {
      appendPath(out, [...coords].reverse());
    } else {
      return null;
    }
  }

  {
    const lastReal = nodeChain[nodeChain.length - 2];
    if (lastReal == null) return null;
    if (lastReal === endA) {
      appendPath(out, sliceEdgeCoords(toCoords, 0, to.alongM));
    } else if (lastReal === endB) {
      appendPath(out, sliceEdgeCoords(toCoords, toLen, to.alongM));
    } else {
      return null;
    }
  }

  if (out.length < 2) return null;
  return out;
}

/** 스냅 허용 거리 (합친 도로구간 중심선) */
export function snapTolM(resolution: number): number {
  return Math.max(10, resolution * 16);
}

export { neighbors, dist as ptDist, ROAD_LAYER };
