import {
  OCCUPATION_PERIOD_STATE_IN_PROGRESS,
  parseOccupationPeriodYmd,
} from '@/lib/occupationLedgerPeriodState';

/**
 * 정렬 키 — 'status'(상태), 예전 고정 열('name'|'place'|'startDate'|'endDate'),
 * 또는 목록 열(필드 정의 «목록» 칸 이름).
 */
export type OccupationLedgerListSortKey = string;

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
  /** 목록 열 값 (칸 이름 → 글자) */
  values?: Record<string, string>;
};

/** 목록 열 — 필드 정의 «목록» 칸. 시작·종료 칸은 날짜 순으로 정렬 */
export type OccupationLedgerListColumn = {
  field: string;
  label: string;
  edge?: 'start' | 'end';
};

const LEGACY_KEYS: Record<string, keyof OccupationLedgerListSortRow> = {
  name: 'name',
  place: 'place',
  startDate: 'startDate',
  endDate: 'endDate',
};

export function initialOccupationLedgerSortDir(
  key: OccupationLedgerListSortKey,
  columns?: OccupationLedgerListColumn[] | null
): OccupationLedgerListSortDir {
  if (key === 'startDate') return 'desc';
  const col = columns?.find((c) => c.field === key);
  return col?.edge === 'start' ? 'desc' : 'asc';
}

function statusRank(status: string): number {
  return status === OCCUPATION_PERIOD_STATE_IN_PROGRESS ? 0 : 1;
}

function compareText(a: string, b: string, dir: OccupationLedgerListSortDir): number {
  const av = String(a ?? '').trim();
  const bv = String(b ?? '').trim();
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  const cmp = av.localeCompare(bv, 'ko', { numeric: true });
  return dir === 'asc' ? cmp : -cmp;
}

/** 점용 시작·종료 글자 — 날짜로 읽히는 값끼리 날짜 순, 읽히지 않는 값은 뒤 */
function compareDate(
  a: string,
  b: string,
  dir: OccupationLedgerListSortDir,
  edge: 'start' | 'end'
): number {
  const av = parseOccupationPeriodYmd(a, edge) ?? '';
  const bv = parseOccupationPeriodYmd(b, edge) ?? '';
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
  dir: OccupationLedgerListSortDir,
  columns?: OccupationLedgerListColumn[] | null
): number {
  if (key === 'status') {
    const cmp = statusRank(a.status) - statusRank(b.status);
    return dir === 'asc' ? cmp : -cmp;
  }
  const col = columns?.find((c) => c.field === key);
  if (col) {
    const av = a.values?.[col.field] ?? '';
    const bv = b.values?.[col.field] ?? '';
    return col.edge ? compareDate(av, bv, dir, col.edge) : compareText(av, bv, dir);
  }
  const legacy = LEGACY_KEYS[key];
  if (!legacy) return 0;
  if (legacy === 'startDate') return compareDate(a.startDate, b.startDate, dir, 'start');
  if (legacy === 'endDate') return compareDate(a.endDate, b.endDate, dir, 'end');
  if (legacy === 'name') return compareText(a.name || a.rowKey, b.name || b.rowKey, dir);
  return compareText(String(a[legacy] ?? ''), String(b[legacy] ?? ''), dir);
}

/** 기본: 진행중 위 → 점용종료일 빠른 순 → 허가번호 최신 순 */
export function compareOccupationLedgerDefault(
  a: OccupationLedgerListSortRow,
  b: OccupationLedgerListSortRow
): number {
  const statusCmp = statusRank(a.status) - statusRank(b.status);
  if (statusCmp !== 0) return statusCmp;
  const endCmp = compareDate(a.endDate, b.endDate, 'asc', 'end');
  if (endCmp !== 0) return endCmp;
  return comparePermitNo(a.rowKey, b.rowKey, 'desc');
}

/** 헤더 정렬이 있으면 우선, 동점이면 기본 순서 */
export function sortOccupationLedgerListRows<T extends OccupationLedgerListSortRow>(
  rows: T[],
  sorts?: OccupationLedgerListSortSpec[] | null,
  columns?: OccupationLedgerListColumn[] | null
): T[] {
  const specs = sorts ?? [];
  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      const cmp = compareByKey(a, b, spec.key, spec.dir, columns);
      if (cmp !== 0) return cmp;
    }
    return compareOccupationLedgerDefault(a, b);
  });
}
