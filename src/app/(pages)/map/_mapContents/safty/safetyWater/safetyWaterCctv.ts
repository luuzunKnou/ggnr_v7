import { fetchMergedItsCctvListClient } from '@/lib/itsClient';
import type { ItsCctvItem } from '../../road/roadCCTV/itsCctvTypes';
import type { SafetyWaterStation } from './safetyWaterTypes';

export const SAFETY_WATER_CCTV_NEAR_M = 500;

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

export async function fetchMergedCctvList(bbox: Wgs84Bbox): Promise<ItsCctvItem[]> {
  return fetchMergedItsCctvListClient(bbox);
}

/** 수위 관측소 id → 500m 내 CCTV 1건 이상 (강수는 제외) */
export function buildStationIdsWithCctv(
  stations: SafetyWaterStation[],
  items: ItsCctvItem[],
  maxM: number
): Set<string> {
  const ids = new Set<string>();
  for (const st of stations) {
    if (st.kind !== 'water') continue;
    if (items.some((it) => withinStation(it, st, maxM))) ids.add(st.id);
  }
  return ids;
}
