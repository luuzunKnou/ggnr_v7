import { tryFormatToYmd } from '@/lib/formatDateYmd';
import {
  formatRiverNamesLabel,
  type RiverConstructionLedgerRow,
} from './riverConstructionLedgerMock';

export type RiverConstructionLedgerListSortKey =
  | 'name'
  | 'river'
  | 'companyName'
  | 'startDate';

export type RiverConstructionLedgerListSortDir = 'asc' | 'desc';

export type RiverConstructionLedgerListSortSpec = {
  key: RiverConstructionLedgerListSortKey;
  dir: RiverConstructionLedgerListSortDir;
};

const SORT_KEYS = new Set<RiverConstructionLedgerListSortKey>([
  'name',
  'river',
  'companyName',
  'startDate',
]);

export function initialRiverConstructionLedgerSortDir(
  key: RiverConstructionLedgerListSortKey
): RiverConstructionLedgerListSortDir {
  return key === 'startDate' ? 'desc' : 'asc';
}

function ymd(raw: string): string {
  return tryFormatToYmd(raw) ?? String(raw ?? '').trim().slice(0, 10);
}

function compareText(a: string, b: string, dir: RiverConstructionLedgerListSortDir): number {
  const av = String(a ?? '').trim();
  const bv = String(b ?? '').trim();
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  const cmp = av.localeCompare(bv, 'ko');
  return dir === 'asc' ? cmp : -cmp;
}

function compareDate(a: string, b: string, dir: RiverConstructionLedgerListSortDir): number {
  const av = ymd(a);
  const bv = ymd(b);
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  const cmp = av.localeCompare(bv);
  return dir === 'asc' ? cmp : -cmp;
}

function compareByKey(
  a: RiverConstructionLedgerRow,
  b: RiverConstructionLedgerRow,
  key: RiverConstructionLedgerListSortKey,
  dir: RiverConstructionLedgerListSortDir
): number {
  switch (key) {
    case 'name':
      return compareText(a.name, b.name, dir);
    case 'river':
      return compareText(formatRiverNamesLabel(a.riverNames), formatRiverNamesLabel(b.riverNames), dir);
    case 'companyName':
      return compareText(a.companyName, b.companyName, dir);
    case 'startDate':
      return compareDate(a.startDate, b.startDate, dir);
    default:
      return 0;
  }
}

function compareDefault(a: RiverConstructionLedgerRow, b: RiverConstructionLedgerRow): number {
  const dateCmp = compareDate(a.startDate, b.startDate, 'desc');
  if (dateCmp !== 0) return dateCmp;
  return compareText(a.id, b.id, 'asc');
}

/** 헤더 정렬이 있으면 우선, 동점이면 착수일자 최신 → id */
export function sortRiverConstructionLedgerListRows<T extends RiverConstructionLedgerRow>(
  rows: T[],
  sorts?: RiverConstructionLedgerListSortSpec[] | null
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
