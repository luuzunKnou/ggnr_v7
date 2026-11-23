/**
 * 구간 추가 — 서버 도로망 조회 + 클라 메모리 캐시.
 */

import { call } from "@/lib/api";
import {
  BIKE_ROAD_NET_MAX_RES,
  netCacheCoversView,
  type BikeRoadNetLoadResult,
} from "./bikeRoadRoadNet";

type MemEntry = {
  result: BikeRoadNetLoadResult;
  at: number;
};

const MEM_TTL_MS = 45 * 60 * 1000;
const MEM_VER = "v9-snap1-graph-node";
let mem: MemEntry | null = null;
let memVer = MEM_VER;
let warmInflight: Promise<BikeRoadNetLoadResult | null> | null = null;

function memHit(
  view: [number, number, number, number]
): BikeRoadNetLoadResult | null {
  if (memVer !== MEM_VER) {
    mem = null;
    memVer = MEM_VER;
  }
  if (!mem) return null;
  if (Date.now() - mem.at > MEM_TTL_MS) {
    mem = null;
    return null;
  }
  if (!netCacheCoversView(mem.result.bufferedBbox, view, 0.05)) return null;
  return mem.result;
}

function remember(result: BikeRoadNetLoadResult) {
  mem = { result, at: Date.now() };
}

export async function loadBikeRoadNetByBbox(
  bbox: [number, number, number, number],
  opts?: {
    resolution?: number;
    bufferRatio?: number;
    maxFeatures?: number;
  }
): Promise<BikeRoadNetLoadResult | null> {
  const res = opts?.resolution;
  if (res != null && res > BIKE_ROAD_NET_MAX_RES) {
    return null;
  }

  const cached = memHit(bbox);
  if (cached) return cached;

  if (warmInflight) {
    const warmed = await warmInflight;
    if (warmed && netCacheCoversView(warmed.bufferedBbox, bbox, 0.05)) {
      remember(warmed);
      return warmed;
    }
  }

  try {
    const response = await call("", "POST", {
      service: "bikeRoadNetService",
      action: "getNetByBbox",
      params: {
        bbox,
        bufferRatio: opts?.bufferRatio ?? 0.12,
      },
    });
    const data = response?.data as BikeRoadNetLoadResult | null | undefined;
    if (!data?.net?.edges?.length || !data.bufferedBbox) return null;
    remember(data);
    return data;
  } catch {
    return null;
  }
}

export function warmBikeRoadNetByBbox(
  bbox: [number, number, number, number],
  opts?: { resolution?: number }
): Promise<BikeRoadNetLoadResult | null> {
  const hit = memHit(bbox);
  if (hit) return Promise.resolve(hit);
  if (warmInflight) return warmInflight;
  warmInflight = loadBikeRoadNetByBbox(bbox, {
    resolution: opts?.resolution,
    bufferRatio: 0.12,
  }).finally(() => {
    warmInflight = null;
  });
  return warmInflight;
}

export function peekBikeRoadNetCache(
  bbox: [number, number, number, number]
): BikeRoadNetLoadResult | null {
  return memHit(bbox);
}
