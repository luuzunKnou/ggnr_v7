import type { ItsCctvItem } from '../../road/roadCCTV/itsCctvTypes';
import type { SafetyWaterStation } from './safetyWaterTypes';

export const SAFETY_WATER_CCTV_NEAR_M = 500;
const CCTV_TYPE_HLS = '1';

export type Wgs84Bbox = { minX: number; maxX: number; minY: number; maxY: number };

export function haversineM(lon1: number, lat1: number, lon2: number, lat2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function withinStation(item: ItsCctvItem, st: SafetyWaterStation, maxM: number) {
  return haversineM(item.coordx, item.coordy, st.lon, st.lat) <= maxM;
}

export function withinAnyStation(item: ItsCctvItem, stations: SafetyWaterStation[], maxM: number) {
  for (const st of stations) {
    if (withinStation(item, st, maxM)) return true;
  }
  return false;
}

async function fetchCctvList(params: {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  type: string;
  cctvType: string;
}): Promise<ItsCctvItem[]> {
  const sp = new URLSearchParams({
    minX: String(params.minX),
    maxX: String(params.maxX),
    minY: String(params.minY),
    maxY: String(params.maxY),
    type: params.type,
    cctvType: params.cctvType,
    getType: 'xml',
  });
  const res = await fetch(`/api/its/cctv?${sp.toString()}`);
  const data = (await res.json()) as { items?: ItsCctvItem[]; error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return Array.isArray(data.items) ? data.items : [];
}

function mergeExAndIts(exList: ItsCctvItem[], itsList: ItsCctvItem[]): ItsCctvItem[] {
  const map = new Map<string, ItsCctvItem>();
  for (const it of [...exList, ...itsList]) {
    const url = it.cctvurl.trim();
    const dedupeKey =
      url ||
      `${Number(it.coordx).toFixed(5)}_${Number(it.coordy).toFixed(5)}_${it.cctvname.trim()}`;
    if (map.has(dedupeKey)) continue;
    map.set(dedupeKey, { ...it, key: dedupeKey });
  }
  return [...map.values()];
}

export async function fetchMergedCctvList(bbox: Wgs84Bbox): Promise<ItsCctvItem[]> {
  const settled = await Promise.allSettled([
    fetchCctvList({ ...bbox, type: 'ex', cctvType: CCTV_TYPE_HLS }),
    fetchCctvList({ ...bbox, type: 'its', cctvType: CCTV_TYPE_HLS }),
  ]);
  const exList = settled[0].status === 'fulfilled' ? settled[0].value : [];
  const itsList = settled[1].status === 'fulfilled' ? settled[1].value : [];
  const merged = mergeExAndIts(exList, itsList);
  if (merged.length === 0) {
    const firstReject = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (firstReject) {
      const msg =
        firstReject.reason instanceof Error ? firstReject.reason.message : String(firstReject.reason);
      throw new Error(msg);
    }
  }
  return merged;
}

/** 관측소 id → 500m 내 CCTV 1건 이상 */
export function buildStationIdsWithCctv(
  stations: SafetyWaterStation[],
  items: ItsCctvItem[],
  maxM: number
): Set<string> {
  const ids = new Set<string>();
  for (const st of stations) {
    if (items.some((it) => withinStation(it, st, maxM))) ids.add(st.id);
  }
  return ids;
}
