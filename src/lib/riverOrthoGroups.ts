/**
 * 하천 드론영상 타일 그룹 (tiles_jpg 폴더명).
 *   bigriver_YYYY_CRS   — 지방하천
 *   smallriver_YYYY_CRS — 소하천
 * 배경지도(satellite_*)와 분리해 하천기본계획에서만 겹쳐 본다.
 */
export type RiverOrthoKind = 'bigriver' | 'smallriver';

export type RiverOrthoGroup = {
  /** 폴더명 = 타일 그룹 id */
  id: string;
  kind: RiverOrthoKind;
  year: number;
  crs: string;
};

export const RIVER_ORTHO_KIND_LABEL: Record<RiverOrthoKind, string> = {
  bigriver: '지방하천',
  smallriver: '소하천',
};

const RIVER_ORTHO_GROUP_RE = /^(bigriver|smallriver)_(\d{4})_(\d{4,5})$/i;

export function parseRiverOrthoGroup(folderName: string): RiverOrthoGroup | null {
  const name = String(folderName ?? '').trim();
  const m = RIVER_ORTHO_GROUP_RE.exec(name);
  if (!m) return null;
  return {
    id: name,
    kind: m[1]!.toLowerCase() as RiverOrthoKind,
    year: Number(m[2]),
    crs: `EPSG:${m[3]}`,
  };
}

/** 선택 연도 기준 종류별로 그 해 이전 가장 최근 영상 (지방하천·소하천 각 1개) */
export function pickRiverOrthoGroupsForYear(groups: RiverOrthoGroup[], year: number): RiverOrthoGroup[] {
  const best = new Map<RiverOrthoKind, RiverOrthoGroup>();
  for (const g of groups) {
    if (g.year > year) continue;
    const cur = best.get(g.kind);
    if (!cur || g.year > cur.year) best.set(g.kind, g);
  }
  return [...best.values()];
}

export function riverOrthoYears(groups: RiverOrthoGroup[]): number[] {
  return [...new Set(groups.map((g) => g.year))].sort((a, b) => b - a);
}
