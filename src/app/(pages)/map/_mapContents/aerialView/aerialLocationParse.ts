/** 촬영 위치 문자열·좌표 파싱 (목업 locationLabel: "x, y" = EPSG:5181) */

import type { WorkFileItem } from './aerialMediaTypes';

export function parseLocation5181(label?: string | null): [number, number] | null {
  if (!label) return null;
  const m = String(label)
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const x = Number(m[1]);
  const y = Number(m[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
}

export function collectFileLocations5181(
  files: WorkFileItem[]
): { fileId: string; coord: [number, number] }[] {
  const out: { fileId: string; coord: [number, number] }[] = [];
  for (const f of files) {
    const coord = parseLocation5181(f.locationLabel);
    if (coord) out.push({ fileId: f.id, coord });
  }
  return out;
}
