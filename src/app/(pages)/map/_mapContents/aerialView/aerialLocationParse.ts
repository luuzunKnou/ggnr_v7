/** 촬영 위치 좌표 (지도용). 표시 문구는 locationLabel(지번). */

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

export function fileCoord5181(file: WorkFileItem): [number, number] | null {
  if (file.x5181 != null && file.y5181 != null) {
    const x = Number(file.x5181);
    const y = Number(file.y5181);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return [x, y];
    }
  }
  /** 목업·구데이터: locationLabel 이 "x, y" 인 경우만 */
  return parseLocation5181(file.locationLabel);
}

export function collectFileLocations5181(
  files: WorkFileItem[]
): { fileId: string; coord: [number, number] }[] {
  const out: { fileId: string; coord: [number, number] }[] = [];
  for (const f of files) {
    const coord = fileCoord5181(f);
    if (coord) out.push({ fileId: f.id, coord });
  }
  return out;
}
