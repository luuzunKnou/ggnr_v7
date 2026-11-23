/**
 * 자전거도로 구간 추가용 도로망.
 *
 * - 안내선: 원본 도로구간 그대로
 * - 경로 그래프: 같은 범위에서 교차·1m 근접만 ST_Snap+ST_Node 로 이음
 *   → 초록 경로가 파란 안내선 사거리에서 떨어져 도는 문제 방지
 * - 조회: 화면 bbox 타일 (기존 방식)
 */

import { promises as fs } from "fs";
import path from "path";
import { pool } from "@/database/db";
import {
  buildBikeRoadNetFromGeoJson,
  type BikeRoadNet,
  type BikeRoadNetLoadResult,
  type Pt,
} from "@/app/(pages)/map/_mapContents/road/bikeRoad/bikeRoadRoadNet";

export const ROAD_SOURCE_LAYER = "tl_sprd_manage";

/** 옆길 끌림 막는 스냅 (m) */
const GRAPH_SNAP_M = 1;
const CACHE_TTL_MS = 45 * 60 * 1000;
const CACHE_MAX = 64;
const TILE_M = 1000;
const CACHE_VER = "v9-snap1-graph-node";

type CacheEntry = {
  result: BikeRoadNetLoadResult;
  at: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<BikeRoadNetLoadResult | null>>();

function snapTileBbox(
  bbox: [number, number, number, number]
): [number, number, number, number] {
  const [minX, minY, maxX, maxY] = bbox;
  return [
    Math.floor(minX / TILE_M) * TILE_M,
    Math.floor(minY / TILE_M) * TILE_M,
    Math.ceil(maxX / TILE_M) * TILE_M,
    Math.ceil(maxY / TILE_M) * TILE_M,
  ];
}

function cacheKey(tile: [number, number, number, number]): string {
  return `${CACHE_VER}|${tile[0]},${tile[1]},${tile[2]},${tile[3]}`;
}

function touchLru(key: string, entry: CacheEntry) {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest == null) break;
    cache.delete(oldest);
  }
}

function readCache(key: string): BikeRoadNetLoadResult | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  touchLru(key, hit);
  return hit.result;
}

function writeCache(key: string, result: BikeRoadNetLoadResult) {
  touchLru(key, { result, at: Date.now() });
}

function parseBbox(raw: unknown): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const nums = raw.map((n) => Number(n));
  if (!nums.every((n) => Number.isFinite(n))) return null;
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
}

function pushGuideLines(
  geom: { type?: string; coordinates?: unknown },
  out: Pt[][]
) {
  const t = geom.type;
  const c = geom.coordinates;
  if (t === "LineString" && Array.isArray(c) && c.length >= 2) {
    out.push(c as Pt[]);
    return;
  }
  if (t === "MultiLineString" && Array.isArray(c)) {
    for (const part of c) {
      if (Array.isArray(part) && part.length >= 2) out.push(part as Pt[]);
    }
  }
}

/** 안내선용 — 원본 */
async function fetchGuideLines(
  tile: [number, number, number, number]
): Promise<Pt[][] | null> {
  const [minX, minY, maxX, maxY] = tile;
  const sql = `
    WITH env AS (
      SELECT ST_Transform(
        ST_MakeEnvelope($1::float8, $2::float8, $3::float8, $4::float8, 3857),
        5181
      ) AS g
    )
    SELECT ST_AsGeoJSON(ST_Transform(ST_SetSRID(t.geom, 5181), 3857))::json AS gj
    FROM public_layer.${ROAD_SOURCE_LAYER} t, env e
    WHERE t.geom IS NOT NULL
      AND t.geom && e.g
      AND ST_Intersects(ST_SetSRID(t.geom, 5181), e.g)
  `;
  try {
    const res = await pool.query<{ gj: unknown }>(sql, [
      minX,
      minY,
      maxX,
      maxY,
    ]);
    if (!res.rows.length) return null;
    const guideLines: Pt[][] = [];
    for (const row of res.rows) {
      const geom = row.gj as { type?: string; coordinates?: unknown } | null;
      if (!geom?.type) continue;
      pushGuideLines(geom, guideLines);
    }
    return guideLines.length ? guideLines : null;
  } catch (err) {
    console.error("[bikeRoadNetService] guide query failed", err);
    return null;
  }
}

/**
 * 경로용 — 교차점에서 선이 이어지도록 타일만 노드화.
 * 안 닿는 옆길은 1m 스냅이라 끌려오지 않음.
 */
async function fetchGraphNodedGeoJson(
  tile: [number, number, number, number]
): Promise<{ type: string; features: unknown[] } | null> {
  const [minX, minY, maxX, maxY] = tile;
  const sql = `
    WITH env AS (
      SELECT ST_Transform(
        ST_MakeEnvelope($1::float8, $2::float8, $3::float8, $4::float8, 3857),
        5181
      ) AS g
    ),
    src AS (
      SELECT (ST_Dump(ST_CollectionExtract(
        ST_Transform(ST_SetSRID(t.geom, 5181), 3857), 2
      ))).geom AS g
      FROM public_layer.${ROAD_SOURCE_LAYER} t, env e
      WHERE t.geom IS NOT NULL
        AND t.geom && e.g
        AND ST_Intersects(ST_SetSRID(t.geom, 5181), e.g)
    ),
    col AS (
      SELECT ST_Collect(ST_SnapToGrid(g, 0.5)) AS c FROM src
    ),
    snapped AS (
      SELECT ST_Snap(c, c, $5::float8) AS c FROM col
    ),
    noded AS (
      SELECT ST_Node(c) AS g FROM snapped
    ),
    parts AS (
      SELECT (ST_Dump(ST_CollectionExtract(g, 2))).geom AS g FROM noded
    )
    SELECT COALESCE(
      json_agg(
        json_build_object(
          'type', 'Feature',
          'properties', json_build_object(),
          'geometry', ST_AsGeoJSON(g)::json
        )
      ),
      '[]'::json
    ) AS features
    FROM parts
    WHERE GeometryType(g) = 'LINESTRING'
      AND ST_Length(g) > 0.2
  `;
  try {
    const res = await pool.query<{ features: unknown[] }>(sql, [
      minX,
      minY,
      maxX,
      maxY,
      GRAPH_SNAP_M,
    ]);
    const features = res.rows[0]?.features;
    if (!Array.isArray(features) || features.length === 0) return null;
    return { type: "FeatureCollection", features };
  } catch (err) {
    console.error("[bikeRoadNetService] graph node failed", err);
    return null;
  }
}

async function buildForTile(
  tile: [number, number, number, number]
): Promise<BikeRoadNetLoadResult | null> {
  const [guideLines, graphJson] = await Promise.all([
    fetchGuideLines(tile),
    fetchGraphNodedGeoJson(tile),
  ]);

  if (!graphJson?.features?.length) return null;

  const net: BikeRoadNet = buildBikeRoadNetFromGeoJson(graphJson, {
    skipDissolve: true,
  });
  if (!net.edges.length) return null;

  return {
    net,
    bufferedBbox: tile,
    guideLines: guideLines ?? undefined,
  };
}

async function getOrBuildTile(
  tile: [number, number, number, number]
): Promise<BikeRoadNetLoadResult | null> {
  const key = cacheKey(tile);
  const cached = readCache(key);
  if (cached) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;

  const job = (async () => {
    try {
      const built = await buildForTile(tile);
      if (built) writeCache(key, built);
      return built;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, job);
  return job;
}

/**
 * bbox(EPSG:3857) → 원본 안내선 + 교차 이은 경로망.
 */
export async function getNetByBbox(params?: {
  bbox?: [number, number, number, number] | number[];
  bufferRatio?: number;
  maxFeatures?: number;
  warmNeighbors?: boolean;
}): Promise<BikeRoadNetLoadResult | null> {
  const bbox = parseBbox(params?.bbox);
  if (!bbox) return null;

  const ratio =
    typeof params?.bufferRatio === "number" && Number.isFinite(params.bufferRatio)
      ? Math.min(Math.max(params.bufferRatio, 0.05), 0.5)
      : 0.12;
  const [minX, minY, maxX, maxY] = bbox;
  const dx = (maxX - minX) * ratio;
  const dy = (maxY - minY) * ratio;
  const padded: [number, number, number, number] = [
    minX - dx,
    minY - dy,
    maxX + dx,
    maxY + dy,
  ];
  const tile = snapTileBbox(padded);

  return getOrBuildTile(tile);
}

/**
 * 프로토타입 위치도 PNG — public/mock/bikeRoad 에 저장 후 URL 반환.
 */
export async function saveLocationMap(params?: {
  routeId?: string;
  imageBase64?: string;
}): Promise<{ url: string; fileName: string } | { error: string }> {
  const routeId = String(params?.routeId ?? "").trim() || "route";
  const raw = String(params?.imageBase64 ?? "")
    .trim()
    .replace(/^data:image\/\w+;base64,/, "");
  if (!raw) return { error: "이미지가 없습니다." };

  let buf: Buffer;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    return { error: "이미지 형식이 올바르지 않습니다." };
  }
  if (buf.length < 64) return { error: "이미지 형식이 올바르지 않습니다." };

  const safeId = routeId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "route";
  const fileName = `${safeId}_location.png`;
  const dir = path.join(process.cwd(), "public", "mock", "bikeRoad");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), buf);
  return { url: `/mock/bikeRoad/${fileName}`, fileName };
}
