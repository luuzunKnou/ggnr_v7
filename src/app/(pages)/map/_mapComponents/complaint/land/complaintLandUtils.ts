import { transform } from 'ol/proj';
import { center3857FromExtent } from '@/app/(pages)/map/_mapContents/memo/useMemoMapHighlight';

export function lonLatFromGeoJson4326(
  geom: Record<string, unknown> | null | undefined
): { lon: number; lat: number } | null {
  if (!geom || geom.type !== 'Point') return null;
  const coords = geom.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat };
}

export function coordinate3857FromComplaint(params: {
  geomGeoJson4326?: Record<string, unknown> | null;
  extent3857?: [number, number, number, number] | null;
  lon?: number | null;
  lat?: number | null;
}): [number, number] | null {
  const fromGeom = lonLatFromGeoJson4326(params.geomGeoJson4326);
  const lon = params.lon ?? fromGeom?.lon;
  const lat = params.lat ?? fromGeom?.lat;
  if (lon != null && lat != null && Number.isFinite(lon) && Number.isFinite(lat)) {
    const pt = transform([lon, lat], 'EPSG:4326', 'EPSG:3857');
    return [pt[0]!, pt[1]!];
  }
  const center = center3857FromExtent(params.extent3857);
  return center;
}

export function toText(value: unknown): string {
  if (value == null) return '-';
  const t = String(value).trim();
  return t || '-';
}

export function toNumText(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toLocaleString('ko-KR');
}

export function getField(row: Record<string, unknown> | undefined, keys: string[], fallback = '-'): string {
  if (!row) return fallback;
  for (const key of keys) {
    const val = row[key];
    if (val != null && String(val).trim() !== '') return String(val).trim();
  }
  return fallback;
}

/** V6 통합제어 personInfo=true 와 동일 — 소유자 개인정보 마스킹 */
export function maskPersonField(value: unknown): string {
  if (value == null) return '***';
  const str = String(value).trim();
  if (!str || str === '-') return str || '-';
  return '*'.repeat(Math.max(str.length, 3));
}
