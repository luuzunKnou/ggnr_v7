/**
 * 도로구간(tl_sprd_manage) 클라이언트 네트워크.
 * 누수 따라그리기 netPath 패턴을 도로 중심선용으로 이식.
 */

import GeoJSON from "ol/format/GeoJSON";
import type { Coordinate } from "ol/coordinate";
import { getLength } from "ol/sphere";
import LineString from "ol/geom/LineString";
import { fetchWfsGeoJsonByBbox } from "@/lib/geoserverWfs";

export type Pt = [number, number];

export type RoadNetHit = {
  edgeId: number;
  /** 엣지 위 투영점 (3857) */
  point: Pt;
  /** 0..1 along edge */
  t: number;
  dist: number;
  from: number;
  to: number;
};

export type BikeRoadNet = {
  nodes: Pt[];
  /** undirected edges: [fromNode, toNode, lengthM] */
  edges: [number, number, number][];
  /** edge polyline samples (at least endpoints) */
  edgeCoords: Pt[][];
};

const JOIN_M = 2.5;
const ROAD_LAYER = "tl_sprd_manage";
const WFS_MAX = 4000;

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function edgeLenM(coords: Pt[]): number {
  if (coords.length < 2) return 0;
  return getLength(new LineString(coords));
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

function findOrAddNode(nodes: Pt[], p: Pt, joinM: number): number {
  for (let i = 0; i < nodes.length; i++) {
    if (dist(nodes[i]!, p) <= joinM) return i;
  }
  nodes.push(p);
  return nodes.length - 1;
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

/** GeoJSON FeatureCollection(3857) → 도로망 그래프 */
export function buildBikeRoadNetFromFeatures(
  features: import("ol/Feature").default[]
): BikeRoadNet {
  const nodes: Pt[] = [];
  const edges: [number, number, number][] = [];
  const edgeCoords: Pt[][] = [];

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
      // 연속 정점마다 엣지 (교차 연결은 끝점 JOIN으로)
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i]!;
        const b = line[i + 1]!;
        if (dist(a, b) < 0.05) continue;
        const from = findOrAddNode(nodes, a, JOIN_M);
        const to = findOrAddNode(nodes, b, JOIN_M);
        if (from === to) continue;
        const coords: Pt[] = [nodes[from]!, nodes[to]!];
        const len = edgeLenM(coords);
        edges.push([from, to, len]);
        edgeCoords.push(coords);
      }
    }
  }

  return { nodes, edges, edgeCoords };
}

export async function loadBikeRoadNetByBbox(
  bbox: [number, number, number, number]
): Promise<BikeRoadNet | null> {
  const [minX, minY, maxX, maxY] = bbox;
  const dx = (maxX - minX) * 0.1;
  const dy = (maxY - minY) * 0.1;
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

/** 점 → 가장 가까운 엣지 투영 */
export function projectOnNet(
  net: BikeRoadNet,
  p: Pt,
  maxDistM: number
): RoadNetHit | null {
  let best: RoadNetHit | null = null;
  for (let i = 0; i < net.edgeCoords.length; i++) {
    const coords = net.edgeCoords[i]!;
    const [from, to] = net.edges[i]!;
    for (let j = 0; j < coords.length - 1; j++) {
      const hit = projectOnSegment(p, coords[j]!, coords[j + 1]!);
      if (hit.dist > maxDistM) continue;
      if (!best || hit.dist < best.dist) {
        best = {
          edgeId: i,
          point: hit.point,
          t: hit.t,
          dist: hit.dist,
          from,
          to,
        };
      }
    }
  }
  return best;
}

function neighbors(net: BikeRoadNet, node: number): { to: number; w: number; edgeId: number }[] {
  const out: { to: number; w: number; edgeId: number }[] = [];
  for (let i = 0; i < net.edges.length; i++) {
    const [a, b, w] = net.edges[i]!;
    if (a === node) out.push({ to: b, w, edgeId: i });
    else if (b === node) out.push({ to: a, w, edgeId: i });
  }
  return out;
}

/**
 * 두 투영점 사이 최단 경로 좌표 (3857).
 * 시작·끝은 해당 엣지 위 투영점을 포함.
 */
export function netPath(
  net: BikeRoadNet,
  from: RoadNetHit,
  to: RoadNetHit
): Pt[] | null {
  if (from.edgeId === to.edgeId) {
    // 같은 엣지 — 투영점만 이으면 됨
    if (dist(from.point, to.point) < 0.05) return [from.point];
    return [from.point, to.point];
  }

  // 임시 노드: from.point / to.point 를 그래프에 가상 연결
  const startNode = net.nodes.length;
  const endNode = net.nodes.length + 1;
  const nodes = [...net.nodes, from.point, to.point];

  type Adj = { to: number; w: number };
  const adj = new Map<number, Adj[]>();
  const add = (a: number, b: number, w: number) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ to: b, w });
  };

  for (let i = 0; i < net.edges.length; i++) {
    const [a, b, w] = net.edges[i]!;
    add(a, b, w);
    add(b, a, w);
  }

  // from 엣지 양 끝 ↔ start
  {
    const lenEdge = net.edges[from.edgeId]![2];
    const dFrom = lenEdge * from.t;
    const dTo = lenEdge * (1 - from.t);
    add(startNode, from.from, dFrom);
    add(from.from, startNode, dFrom);
    add(startNode, from.to, dTo);
    add(from.to, startNode, dTo);
  }
  {
    const lenEdge = net.edges[to.edgeId]![2];
    const dFrom = lenEdge * to.t;
    const dTo = lenEdge * (1 - to.t);
    add(endNode, to.from, dFrom);
    add(to.from, endNode, dFrom);
    add(endNode, to.to, dTo);
    add(to.to, endNode, dTo);
  }

  const distMap = new Map<number, number>();
  const prev = new Map<number, number>();
  const pq: { n: number; d: number }[] = [{ n: startNode, d: 0 }];
  distMap.set(startNode, 0);

  while (pq.length) {
    pq.sort((a, b) => a.d - b.d);
    const cur = pq.shift()!;
    if (cur.n === endNode) break;
    if ((distMap.get(cur.n) ?? Infinity) < cur.d) continue;
    for (const e of adj.get(cur.n) ?? []) {
      const nd = cur.d + e.w;
      if (nd < (distMap.get(e.to) ?? Infinity)) {
        distMap.set(e.to, nd);
        prev.set(e.to, cur.n);
        pq.push({ n: e.to, d: nd });
      }
    }
  }

  if (!distMap.has(endNode)) return null;

  const chain: number[] = [];
  let n: number | undefined = endNode;
  while (n !== undefined) {
    chain.push(n);
    if (n === startNode) break;
    n = prev.get(n);
  }
  chain.reverse();
  if (chain[0] !== startNode) return null;

  const path: Pt[] = chain.map((i) => nodes[i]!);
  // 중복 제거
  const out: Pt[] = [];
  for (const p of path) {
    if (!out.length || dist(out[out.length - 1]!, p) > 0.05) out.push(p);
  }
  return out.length >= 2 ? out : null;
}

/** 스냅 허용 거리 (해상도 기반) */
export function snapTolM(resolution: number): number {
  return Math.max(8, resolution * 14);
}

export { neighbors, dist as ptDist, ROAD_LAYER };
