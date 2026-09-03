import type { Map } from 'ol';
import { fromLonLat } from 'ol/proj';
import type { WaterPlaySignListItem } from '@/service/waterPlaySignService';

export function flyToWaterPlaySignLonLat(
  map: Map | null | undefined,
  lon: number | null | undefined,
  lat: number | null | undefined
): void {
  if (!map || lon == null || lat == null || !Number.isFinite(lon) || !Number.isFinite(lat)) return;
  map.getView().animate({
    center: fromLonLat([lon, lat]),
    zoom: Math.max(map.getView().getZoom() ?? 15, 15),
    duration: 450,
  });
}

export function flyToWaterPlaySignRow(
  map: Map | null | undefined,
  row: WaterPlaySignListItem | null | undefined
): void {
  if (!map || !row) return;
  const g = row.geomJson;
  if (!g || typeof g !== 'object' || !('coordinates' in g)) return;
  const coords = (g as { coordinates?: number[] }).coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return;
  flyToWaterPlaySignLonLat(map, coords[0], coords[1]);
}
