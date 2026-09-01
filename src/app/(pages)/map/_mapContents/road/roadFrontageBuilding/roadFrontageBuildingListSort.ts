import { tryFormatToYmd } from '@/lib/formatDateYmd';
import type { RoadFrontageBuildingLedger } from './roadFrontageBuildingMock';

export type RoadFrontageBuildingListSortKey =
  | 'roadType'
  | 'locAdr'
  | 'routeNo'
  | 'preYmd';

export type RoadFrontageBuildingListSortDir = 'asc' | 'desc';

export type RoadFrontageBuildingListSortSpec = {
  key: RoadFrontageBuildingListSortKey;
  dir: RoadFrontageBuildingListSortDir;
};

const SORT_KEYS = new Set<RoadFrontageBuildingListSortKey>([
  'roadType',
  'locAdr',
  'routeNo',
  'preYmd',
]);

export function initialRoadFrontageBuildingSortDir(
  key: RoadFrontageBuildingListSortKey
): RoadFrontageBuildingListSortDir {
  return key === 'preYmd' ? 'desc' : 'asc';
}

function ymd(raw: string): string {
  return tryFormatToYmd(raw) ?? String(raw ?? '').trim().slice(0, 10);
}

function compareText(a: string, b: string, dir: RoadFrontageBuildingListSortDir): number {
  const av = String(a ?? '').trim();
  const bv = String(b ?? '').trim();
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  const cmp = av.localeCompare(bv, 'ko');
  return dir === 'asc' ? cmp : -cmp;
}

function compareDate(a: string, b: string, dir: RoadFrontageBuildingListSortDir): number {
  const av = ymd(a);
  const bv = ymd(b);
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  const cmp = av.localeCompare(bv);
  return dir === 'asc' ? cmp : -cmp;
}

function compareByKey(
  a: RoadFrontageBuildingLedger,
  b: RoadFrontageBuildingLedger,
  key: RoadFrontageBuildingListSortKey,
  dir: RoadFrontageBuildingListSortDir
): number {
  switch (key) {
    case 'roadType':
      return compareText(a.roadType, b.roadType, dir);
    case 'locAdr':
      return compareText(a.locAdr, b.locAdr, dir);
    case 'routeNo':
      return compareText(a.routeNo, b.routeNo, dir);
    case 'preYmd':
      return compareDate(a.preYmd, b.preYmd, dir);
    default:
      return 0;
  }
}

function compareDefault(a: RoadFrontageBuildingLedger, b: RoadFrontageBuildingLedger): number {
  const ak = String(a.ftrIdn || a.id || '').trim();
  const bk = String(b.ftrIdn || b.id || '').trim();
  return compareText(ak, bk, 'asc');
}

export function sortRoadFrontageBuildingListRows<T extends RoadFrontageBuildingLedger>(
  rows: T[],
  sorts?: RoadFrontageBuildingListSortSpec[] | null
): T[] {
  const specs = (sorts ?? []).filter((s) => SORT_KEYS.has(s.key));
  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      const cmp = compareByKey(a, b, spec.key, spec.dir);
      if (cmp !== 0) return cmp;
    }
    return compareDefault(a, b);
  });
}
