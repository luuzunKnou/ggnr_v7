import { tryFormatToYmd } from '@/lib/formatDateYmd';
import {
  OCCUPATION_PERIOD_STATE_IN_PROGRESS,
} from '@/lib/occupationLedgerPeriodState';

export type OccupationLedgerListSortKey =
  | 'status'
  | 'name'
  | 'place'
  | 'startDate'
  | 'endDate';

export type OccupationLedgerListSortDir = 'asc' | 'desc';

export type OccupationLedgerListSortSpec = {
  key: OccupationLedgerListSortKey;
  dir: OccupationLedgerListSortDir;
};

export type OccupationLedgerListSortRow = {
  rowKey: string;
  name: string;
  place: string;
  startDate: string;
  endDate: string;
  status: string;
};

const SORT_KEYS = new Set<OccupationLedgerListSortKey>([
  'status',
  'name',
  'place',
  'startDate',
  'endDate',
]);

export function initialOccupationLedgerSortDir(
  key: OccupationLedgerListSortKey
): OccupationLedgerListSortDir {
  return key === 'startDate' ? 'desc' : 'asc';
}

function statusRank(status: string): number {
  return status === OCCUPATION_PERIOD_STATE_IN_PROGRESS ? 0 : 1;
}

function ymd(raw: string): string {
  return tryFormatToYmd(raw) ?? String(raw ?? '').trim().slice(0, 10);
}

function compareText(a: string, b: string, dir: OccupationLedgerListSortDir): number {
  const av = String(a ?? '').trim();
  const bv = String(b ?? '').trim();
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  const cmp = av.localeCompare(bv, 'ko');
  return dir === 'asc' ? cmp : -cmp;
}

function compareDate(a: string, b: string, dir: OccupationLedgerListSortDir): number {
  const av = ymd(a);
  const bv = ymd(b);
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  const cmp = av.localeCompare(bv);
  return dir === 'asc' ? cmp : -cmp;
}

function permitParts(code: string): { year: number; seq: number } | null {
  const m = String(code ?? '').trim().match(/^(\d{4})-(\d+)$/);
  if (!m) return null;
  const year = Number(m[1]);
  const seq = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(seq)) return null;
  return { year, seq };
}

/** 허가번호 «년도-번호» — 최신(연도·번호 큰 값)이 위 */
function comparePermitNo(a: string, b: string, dir: OccupationLedgerListSortDir): number {
  const ak = permitParts(a);
  const bk = permitParts(b);
  if (ak && bk) {
    const cmp = ak.year !== bk.year ? ak.year - bk.year : ak.seq - bk.seq;
    if (cmp === 0) return 0;
    return dir === 'asc' ? cmp : -cmp;
  }
  return compareText(a, b, dir);
}

function compareByKey(
  a: OccupationLedgerListSortRow,
  b: OccupationLedgerListSortRow,
  key: OccupationLedgerListSortKey,
  dir: OccupationLedgerListSortDir
): number {
  switch (key) {
    case 'status': {
      const cmp = statusRank(a.status) - statusRank(b.status);
      return dir === 'asc' ? cmp : -cmp;
    }
    case 'name':
      return compareText(a.name || a.rowKey, b.name || b.rowKey, dir);
    case 'place':
      return compareText(a.place, b.place, dir);
    case 'startDate':
      return compareDate(a.startDate, b.startDate, dir);
    case 'endDate':
      return compareDate(a.endDate, b.endDate, dir);
    default:
      return 0;
  }
}

/** 기본: 진행중 위 → 점용종료일 빠른 순 → 허가번호 최신 순 */
export function compareOccupationLedgerDefault(
  a: OccupationLedgerListSortRow,
  b: OccupationLedgerListSortRow
): number {
  const statusCmp = statusRank(a.status) - statusRank(b.status);
  if (statusCmp !== 0) return statusCmp;
  const endCmp = compareDate(a.endDate, b.endDate, 'asc');
  if (endCmp !== 0) return endCmp;
  return comparePermitNo(a.rowKey, b.rowKey, 'desc');
}

/** 헤더 정렬이 있으면 우선, 동점이면 기본 순서 */
export function sortOccupationLedgerListRows<T extends OccupationLedgerListSortRow>(
  rows: T[],
  sorts?: OccupationLedgerListSortSpec[] | null
): T[] {
  const specs = (sorts ?? []).filter((s) => SORT_KEYS.has(s.key));
  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      const cmp = compareByKey(a, b, spec.key, spec.dir);
      if (cmp !== 0) return cmp;
    }
    return compareOccupationLedgerDefault(a, b);
  });
}
