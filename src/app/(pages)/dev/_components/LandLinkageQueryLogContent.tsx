'use client';

/**
 * KRAS 개인정보 관리 → 조회 이력
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import { cn } from '@/lib/utils';
import { call } from '@/lib/api';
import { Download, RefreshCw, RotateCcw, Search, X } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';
import { USER_MANAGER_UI_STYLE, USER_MGMT_HISTORY_TABLE } from './userManagerUiVariants';

type LogRow = {
  llqKey: number;
  llqGroupKey: string | null;
  llqAt: string | null;
  llqUser: string | null;
  usrName: string | null;
  ugName?: string | null;
  llqIp?: string | null;
  llqAppSys?: string | null;
  llqAppSysNm?: string | null;
  llqChannel: string | null;
  llqSystem: string | null;
  llqSvcId: string | null;
  llqPnu: string | null;
  llqStatus: string | null;
  llqMs: number | null;
  llqMessage: string | null;
  llqHasPii: boolean;
  llqPiiViewedAt: string | null;
  llqPiiMasked?: boolean;
  /** 묶음이면 2 이상 */
  groupCount?: number;
  /** 묶음 내 서비스별 건수 */
  svcCounts?: Record<string, number>;
};

const uiStyle = USER_MANAGER_UI_STYLE;
const historyTable = USER_MGMT_HISTORY_TABLE;
const tableRowClass = historyTable.tableRow;

/** 목록·필터용 (묶음 집계와 동일) */
const STATUS_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'queried', label: '조회됨' },
  { value: 'skip', label: '조회 안 함' },
  { value: 'fail', label: '조회 실패' },
] as const;

/** 상세·내려받기용 세부 상태 */
const STATUS_DETAIL_LABEL: Record<string, string> = {
  ok: '조회 성공',
  empty: '결과 없음',
  skip: '조회 안 함',
  fail: '조회 실패',
  queried: '조회됨',
};

const PII_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'plain', label: '열람(원문)' },
  { value: 'masked', label: '열람(마스킹)' },
  { value: 'none', label: '해당 없음' },
] as const;

const SVC_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'KRAS000002', label: '토지대장(기본정보·소유내역)' },
  { value: 'KRAS000003', label: '공유인 조회' },
  { value: 'KRAS000006', label: '이동일자 연혁' },
  { value: 'KRAS000007', label: '변동일자 연혁' },
  { value: 'KRAS000025', label: '토지이용계획' },
  { value: 'KRAS000037', label: 'KRAS 연결확인' },
  { value: 'KOREPS00011', label: 'KOREPS 공시지가' },
] as const;

const CHANNEL_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'parcelInfo', label: '필지정보(우클릭)' },
  { value: 'parcelModal', label: '필지정보(우클릭) 내 모달' },
  { value: 'parcelAnalysis', label: '필지분석' },
  { value: 'privateLandAnalysis', label: '사유지분석' },
  { value: 'cadastralResurvey', label: '지적재조사' },
  { value: 'smallPublicPlan', label: '정비계획' },
  { value: 'officialPrice', label: '공시지가 조회' },
] as const;

const PAGE_SIZE = 20;

function defaultRange() {
  const now = new Date();
  const end = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);
  const startDate = new Date(now);
  startDate.setMonth(startDate.getMonth() - 1);
  const start = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(startDate);
  return { startDate: start, endDate: end };
}

/** 목록: 조회됨 / 조회 안 함 / 조회 실패 */
function statusListLabel(v: string | null | undefined): string {
  const s = String(v ?? '').trim();
  if (s === 'ok' || s === 'empty' || s === 'queried') return '조회됨';
  if (s === 'skip') return '조회 안 함';
  if (s === 'fail') return '조회 실패';
  return STATUS_OPTIONS.find((o) => o.value === s)?.label ?? (s || '—');
}

/** 상세: 서비스별 세부 상태 */
function statusDetailLabel(v: string | null | undefined): string {
  const s = String(v ?? '').trim();
  return STATUS_DETAIL_LABEL[s] ?? (s || '—');
}

/** 목록 묶음 요약용 짧은 서비스명 */
const SVC_LIST_SHORT: Record<string, string> = {
  KRAS000002: '토지대장',
  KRAS000003: '공유인',
  KRAS000006: '이동연혁',
  KRAS000007: '변동연혁',
  KRAS000025: '토지이용계획',
  KRAS000037: '연결확인',
  KOREPS00011: '공시지가',
};

const SVC_LIST_ORDER = SVC_OPTIONS.map((o) => o.value).filter(Boolean);

function svcShortLabel(svcId: string): string {
  return SVC_LIST_SHORT[svcId] ?? svcLabel(svcId);
}

function listSvcLabel(r: Pick<LogRow, 'llqSvcId' | 'groupCount' | 'svcCounts'>): string {
  const counts = r.svcCounts;
  const entries = counts
    ? Object.entries(counts).filter(([k, n]) => k && Number(n) > 0)
    : [];
  if (entries.length > 0 && (entries.length > 1 || Math.max(1, Number(r.groupCount ?? 1)) > 1)) {
    entries.sort((a, b) => {
      const ia = SVC_LIST_ORDER.indexOf(a[0] as (typeof SVC_LIST_ORDER)[number]);
      const ib = SVC_LIST_ORDER.indexOf(b[0] as (typeof SVC_LIST_ORDER)[number]);
      const sa = ia < 0 ? 999 : ia;
      const sb = ib < 0 ? 999 : ib;
      if (sa !== sb) return sa - sb;
      return a[0].localeCompare(b[0]);
    });
    return entries.map(([svc, n]) => `${svcShortLabel(svc)}(${n}건)`).join('·');
  }
  return svcLabel(r.llqSvcId);
}

function channelLabel(v: string | null | undefined): string {
  const s = String(v ?? '').trim();
  // 과거 landUse 적재분도 필지분석으로 표시
  if (s === 'landUse' || s === 'parcelAnalysis') return '필지분석';
  const found = CHANNEL_OPTIONS.find((o) => o.value === s);
  if (found?.label) return found.label;
  return s || '—';
}

function svcLabel(v: string | null | undefined): string {
  const s = String(v ?? '').trim();
  const found = SVC_OPTIONS.find((o) => o.value === s);
  if (found?.label) return found.label;
  return s || '—';
}

/**
 * 상세: 서비스별 개인정보 종류 (원문 미저장).
 * 필지정보·모달에서 다루는 항목 기준.
 */
const PII_KIND_BY_SVC: Record<string, string[]> = {
  KRAS000002: ['소유자명', '등록번호', '소유자주소'],
  KRAS000003: ['소유자명', '등록번호', '소유자주소'],
  /** 이동연혁 화면에는 소유자·등록번호·주소 열이 없음 */
  KRAS000006: [],
  KRAS000007: ['소유자명', '등록번호'],
  KRAS000025: [],
  KRAS000037: [],
  KOREPS00011: [],
};

/** 목록: 열람 여부 + 마스킹 스냅샷 */
function piiListLabel(hasPii: boolean, masked: boolean | null | undefined): string {
  if (!hasPii) return '해당 없음';
  return masked ? '열람(마스킹)' : '열람(원문)';
}

/** 상세·내려받기: 항목 + 열람 상태 */
function piiKindLabel(
  svcId: string | null | undefined,
  hasPii: boolean,
  masked?: boolean | null
): string {
  const s = String(svcId ?? '').trim();
  const kinds = PII_KIND_BY_SVC[s];
  if (kinds) {
    if (!kinds.length) return '해당 없음';
    return `${kinds.join('·')} · ${masked ? '열람(마스킹)' : '열람(원문)'}`;
  }
  return piiListLabel(hasPii, masked);
}

/** 개인정보 «해당 없음»은 목록·상세에서 한 단계 옅게 */
function PiiCellText({ text }: { text: string }) {
  return (
    <span className={cn(text === '해당 없음' && 'text-muted-foreground')}>{text}</span>
  );
}

function cell(v: string | number | null | undefined): string {
  if (v == null) return '—';
  const s = String(v).trim();
  return s || '—';
}

type XlsxMerge = { s: { r: number; c: number }; e: { r: number; c: number } };
type XlsxGroupRange = { start: number; end: number };

/** 공통열(열람시간~필지) 인덱스 — 묶음 다건 시 세로 병합 */
const EXPORT_MERGE_COLS = [0, 1, 2, 3, 4, 5, 6, 7] as const;
const EXPORT_COL_COUNT = 12;

function appSysLabel(r: Pick<LogRow, 'llqAppSys' | 'llqAppSysNm'>): string {
  return String(r.llqAppSysNm ?? '').trim() || String(r.llqAppSys ?? '').trim() || '—';
}

const XLSX_BORDER_THIN = { style: 'thin' as const, color: { rgb: 'B0B0B0' } };
const XLSX_BORDER_MED = { style: 'medium' as const, color: { rgb: '666666' } };

/** 표시 너비(한글≈2) — 열 자동 폭용 */
function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    w += ch.charCodeAt(0) > 127 ? 2 : 1;
  }
  return w;
}

function groupCellBorder(args: {
  r: number;
  c: number;
  start: number;
  end: number;
  lastCol: number;
}) {
  const { r, c, start, end, lastCol } = args;
  return {
    top: r === start ? XLSX_BORDER_MED : XLSX_BORDER_THIN,
    bottom: r === end ? XLSX_BORDER_MED : XLSX_BORDER_THIN,
    left: c === 0 ? XLSX_BORDER_MED : XLSX_BORDER_THIN,
    right: c === lastCol ? XLSX_BORDER_MED : XLSX_BORDER_THIN,
  };
}

function downloadXlsx(
  filename: string,
  header: string[],
  lines: string[][],
  merges: XlsxMerge[],
  groups: XlsxGroupRange[]
) {
  const sheet = XLSX.utils.aoa_to_sheet([header, ...lines]);
  if (merges.length) sheet['!merges'] = merges;

  const lastCol = EXPORT_COL_COUNT - 1;
  const headerStyle = {
    font: { bold: true },
    alignment: { vertical: 'center', wrapText: true },
    fill: { patternType: 'solid' as const, fgColor: { rgb: 'F0F0F0' } },
    border: {
      top: XLSX_BORDER_MED,
      bottom: XLSX_BORDER_MED,
      left: XLSX_BORDER_MED,
      right: XLSX_BORDER_MED,
    },
  };
  for (let c = 0; c <= lastCol; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const cellRef = sheet[addr];
    if (cellRef && typeof cellRef === 'object') {
      (cellRef as { s?: unknown }).s = headerStyle;
    }
  }

  for (const g of groups) {
    for (let r = g.start; r <= g.end; r++) {
      for (let c = 0; c <= lastCol; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        let cellRef = sheet[addr] as { t?: string; v?: unknown; s?: unknown } | undefined;
        if (!cellRef) {
          cellRef = { t: 's', v: '' };
          sheet[addr] = cellRef;
        }
        cellRef.s = {
          alignment: { vertical: 'center', wrapText: c === lastCol },
          border: groupCellBorder({ r, c, start: g.start, end: g.end, lastCol }),
        };
      }
    }
  }

  const widths = Array.from({ length: EXPORT_COL_COUNT }, () => 0);
  const bump = (row: string[]) => {
    row.forEach((v, c) => {
      widths[c] = Math.max(widths[c] ?? 0, displayWidth(String(v ?? '')));
    });
  };
  bump(header);
  for (const line of lines) bump(line);
  sheet['!cols'] = widths.map((w) => ({ wch: Math.min(48, Math.max(8, w + 2)) }));

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'KRAS');
  XLSX.writeFile(book, filename);
}

/** 감사 보고서용: 묶음은 공통열 병합, 서비스·상태 등은 행별 유지. 묶음키 열 없음 */
function buildExportSheet(rows: LogRow[]): {
  header: string[];
  lines: string[][];
  merges: XlsxMerge[];
  groups: XlsxGroupRange[];
} {
  const header = [
    '열람시간',
    '사용자 ID',
    '사용자 이름',
    '부서',
    '시스템',
    '접속IP',
    '접속페이지',
    '필지',
    '조회 대상',
    '상태',
    '개인정보',
    '메시지',
  ];

  const groupsMap = new Map<string, LogRow[]>();
  const order: string[] = [];
  for (const r of rows) {
    const gk = String(r.llqGroupKey ?? '').trim();
    const key = gk || `__solo:${r.llqKey}`;
    if (!groupsMap.has(key)) {
      groupsMap.set(key, []);
      order.push(key);
    }
    groupsMap.get(key)!.push(r);
  }

  order.sort((a, b) => {
    const ga = groupsMap.get(a)!;
    const gb = groupsMap.get(b)!;
    const ta = String(ga[0]?.llqAt ?? '');
    const tb = String(gb[0]?.llqAt ?? '');
    if (ta !== tb) return tb.localeCompare(ta);
    return Number(gb[0]?.llqKey ?? 0) - Number(ga[0]?.llqKey ?? 0);
  });

  for (const key of order) {
    groupsMap.get(key)!.sort((a, b) => Number(a.llqKey) - Number(b.llqKey));
  }

  const lines: string[][] = [];
  const merges: XlsxMerge[] = [];
  const groups: XlsxGroupRange[] = [];
  let sheetRow = 1;

  for (const key of order) {
    const g = groupsMap.get(key)!;
    const start = sheetRow;
    for (let i = 0; i < g.length; i++) {
      const r = g[i]!;
      const common =
        i === 0
          ? [
              cell(r.llqAt),
              cell(r.llqUser),
              cell(r.usrName),
              cell(r.ugName),
              appSysLabel(r),
              cell(r.llqIp),
              channelLabel(r.llqChannel),
              cell(r.llqPnu),
            ]
          : ['', '', '', '', '', '', '', ''];
      lines.push([
        ...common,
        svcLabel(r.llqSvcId),
        statusDetailLabel(r.llqStatus),
        piiKindLabel(r.llqSvcId, r.llqHasPii, r.llqPiiMasked),
        cell(r.llqMessage),
      ]);
      sheetRow += 1;
    }
    const end = sheetRow - 1;
    groups.push({ start, end });
    if (end > start) {
      for (const c of EXPORT_MERGE_COLS) {
        merges.push({ s: { r: start, c }, e: { r: end, c } });
      }
    }
  }

  return { header, lines, merges, groups };
}

function exportFileStamp(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}${get('month')}${get('day')}_${get('hour')}${get('minute')}`;
}

export function LandLinkageQueryLogContent() {
  const initial = defaultRange();
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [channel, setChannel] = useState('');
  const [appSys, setAppSys] = useState('');
  const [appSysOptions, setAppSysOptions] = useState<{ value: string; label: string }[]>([
    { value: '', label: '전체' },
  ]);
  const [status, setStatus] = useState('');
  const [userId, setUserId] = useState('');
  const [hasPii, setHasPii] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [groupRows, setGroupRows] = useState<LogRow[] | null>(null);
  const [groupLoading, setGroupLoading] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupMeta, setGroupMeta] = useState<{
    groupKey: string;
    userName: string;
    ugName: string;
    appSys: string;
    channel: string;
    at: string;
    ip: string;
  } | null>(null);
  /** 로딩 중 표 높이 유지용 — 목록 묶음 건수 */
  const [groupExpectedCount, setGroupExpectedCount] = useState(1);
  /** 상세 모달 — 조회 대상 필터(빈 값=전체). 옵션은 묶음에 있는 서비스만 */
  const [groupSvcFilter, setGroupSvcFilter] = useState('');
  const [exporting, setExporting] = useState(false);
  const closeGroupModal = () => {
    setGroupOpen(false);
    setGroupMeta(null);
    setGroupRows(null);
    setGroupExpectedCount(1);
    setGroupSvcFilter('');
  };

  const groupSvcOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const r of groupRows ?? []) {
      const id = String(r.llqSvcId ?? '').trim();
      if (id) ids.add(id);
    }
    return [...ids].sort((a, b) => {
      const ia = SVC_LIST_ORDER.indexOf(a as (typeof SVC_LIST_ORDER)[number]);
      const ib = SVC_LIST_ORDER.indexOf(b as (typeof SVC_LIST_ORDER)[number]);
      const sa = ia < 0 ? 999 : ia;
      const sb = ib < 0 ? 999 : ib;
      if (sa !== sb) return sa - sb;
      return a.localeCompare(b);
    });
  }, [groupRows]);

  const filteredGroupRows = useMemo(() => {
    const all = groupRows ?? [];
    const f = groupSvcFilter.trim();
    if (!f) return all;
    return all.filter((r) => String(r.llqSvcId ?? '').trim() === f);
  }, [groupRows, groupSvcFilter]);

  const modalUserName = (row: LogRow): string => {
    const name = String(row.usrName ?? '').trim();
    if (name) return name;
    if (String(row.llqUser ?? '').trim() === 'su') return '슈퍼관리자';
    return '—';
  };

  const load = useCallback(
    async (
      pageNum: number,
      overrides?: Partial<{
        startDate: string;
        endDate: string;
        channel: string;
        appSys: string;
        status: string;
        userId: string;
        hasPii: string;
      }>
    ) => {
      const nextStart = overrides?.startDate ?? startDate;
      const nextEnd = overrides?.endDate ?? endDate;
      const nextChannel = overrides?.channel ?? channel;
      const nextAppSys = overrides?.appSys ?? appSys;
      const nextStatus = overrides?.status ?? status;
      const nextUserId = overrides?.userId ?? userId;
      const nextHasPii = overrides?.hasPii ?? hasPii;
      setLoading(true);
      setError(null);
      setHint(null);
      try {
        const res = await call('', 'POST', {
          service: 'landLinkageQueryLogService',
          action: 'listQueryLog',
          params: {
            startDate: nextStart.replace(/-/g, ''),
            endDate: nextEnd.replace(/-/g, ''),
            channel: nextChannel || undefined,
            appSys: nextAppSys || undefined,
            status: nextStatus || undefined,
            userId: nextUserId.trim() || undefined,
            hasPii: nextHasPii || undefined,
            page: pageNum,
            pageSize: PAGE_SIZE,
          },
        });
        if (!res?.success) throw new Error(res?.error ?? '조회 실패');
        const raw = (res.data ?? {}) as Record<string, unknown>;
        // API가 { data: result }로 감싸므로, 예전에 result가 { data:{rows} }였던 경우도 흡수
        const nested =
          raw.data && typeof raw.data === 'object' ? (raw.data as Record<string, unknown>) : null;
        const data = (
          Array.isArray(raw.rows) ? raw : nested && Array.isArray(nested.rows) ? nested : raw
        ) as {
          rows?: LogRow[];
          total?: number;
          totalPages?: number;
          page?: number;
          message?: string;
        };
        setRows(Array.isArray(data.rows) ? data.rows : []);
        setTotal(Number(data.total ?? 0));
        setTotalPages(Math.max(1, Number(data.totalPages ?? 1)));
        setPage(Number(data.page ?? pageNum));
        if (data.message) setHint(String(data.message));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : '목록 조회 실패');
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [startDate, endDate, channel, appSys, status, userId, hasPii]
  );

  useEffect(() => {
    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'configService',
          action: 'getSystemList',
          params: {},
        });
        const raw = (res?.data ?? res) as { systems?: { sys_key?: string; sys_kor?: string }[] };
        const systems = Array.isArray(raw.systems) ? raw.systems : [];
        const opts = systems
          .map((s) => {
            const value = String(s.sys_key ?? '').trim();
            const label = String(s.sys_kor ?? '').trim() || value;
            return value ? { value, label } : null;
          })
          .filter((o): o is { value: string; label: string } => !!o);
        setAppSysOptions([{ value: '', label: '전체' }, ...opts]);
      } catch {
        setAppSysOptions([{ value: '', label: '전체' }]);
      }
    })();
  }, []);

  const resetFilters = () => {
    const range = defaultRange();
    setStartDate(range.startDate);
    setEndDate(range.endDate);
    setChannel('');
    setAppSys('');
    setStatus('');
    setHasPii('');
    setUserId('');
    void load(1, {
      startDate: range.startDate,
      endDate: range.endDate,
      channel: '',
      appSys: '',
      status: '',
      hasPii: '',
      userId: '',
    });
  };

  useEffect(() => {
    void load(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 최초 1회

  const exportWorkbook = async () => {
    if (exporting) return;
    setExporting(true);
    setError(null);
    setHint(null);
    try {
      const res = await call('', 'POST', {
        service: 'landLinkageQueryLogService',
        action: 'exportQueryLog',
        params: {
          startDate: startDate.replace(/-/g, ''),
          endDate: endDate.replace(/-/g, ''),
          channel: channel || undefined,
          appSys: appSys || undefined,
          status: status || undefined,
          userId: userId.trim() || undefined,
          hasPii: hasPii || undefined,
        },
      });
      if (!res?.success) throw new Error(res?.error ?? '내려받기 실패');
      const raw = (res.data ?? {}) as Record<string, unknown>;
      const nested =
        raw.data && typeof raw.data === 'object' ? (raw.data as Record<string, unknown>) : null;
      const data = (
        Array.isArray(raw.rows) ? raw : nested && Array.isArray(nested.rows) ? nested : raw
      ) as { rows?: LogRow[]; message?: string; truncated?: boolean };
      const exportRows = Array.isArray(data.rows) ? data.rows : [];
      if (!exportRows.length) {
        setHint(data.message || '내려받을 이력이 없습니다.');
        return;
      }
      const { header, lines, merges, groups } = buildExportSheet(exportRows);
      // 엑셀은 UTF-8 CSV를 자주 깨뜨림 → xlsx. 파일명은 ASCII만 사용
      downloadXlsx(`KRAS_query_log_${exportFileStamp()}.xlsx`, header, lines, merges, groups);
      if (data.message) setHint(String(data.message));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '내려받기 실패');
    } finally {
      setExporting(false);
    }
  };

  const openGroup = async (row: LogRow) => {
    const key = String(row.llqGroupKey ?? '').trim();
    if (!key || groupLoading) return;
    setError(null);
    // 목록 행 메타로 모달 선오픈 — 상세 행은 이어서 조회
    setGroupMeta({
      groupKey: key,
      userName: modalUserName(row),
      ugName: cell(row.ugName),
      appSys: appSysLabel(row),
      channel: channelLabel(row.llqChannel),
      at: row.llqAt ?? '—',
      ip: cell(row.llqIp),
    });
    setGroupExpectedCount(Math.max(1, Number(row.groupCount ?? 1) || 1));
    setGroupSvcFilter('');
    setGroupRows(null);
    setGroupOpen(true);
    setGroupLoading(true);
    try {
      const res = await call('', 'POST', {
        service: 'landLinkageQueryLogService',
        action: 'listByGroupKey',
        params: { groupKey: key },
      });
      if (!res?.success) throw new Error(res?.error ?? '묶음 조회 실패');
      const raw = (res.data ?? {}) as Record<string, unknown>;
      const nested =
        raw.data && typeof raw.data === 'object' ? (raw.data as Record<string, unknown>) : null;
      const data = (
        Array.isArray(raw.rows) ? raw : nested && Array.isArray(nested.rows) ? nested : raw
      ) as { rows?: LogRow[] };
      setGroupRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '묶음 조회 실패');
      setGroupOpen(false);
      setGroupMeta(null);
      setGroupRows(null);
      setGroupExpectedCount(1);
      setGroupSvcFilter('');
    } finally {
      setGroupLoading(false);
    }
  };

  const selectClass =
    'h-8 rounded-none border border-input bg-background px-2 text-xs text-foreground';

  return (
    <div className={cn(uiStyle.page, 'gap-2')}>
      <div className={cn(uiStyle.toolbar, 'flex-wrap')}>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>시작</span>
          <Input
            type="date"
            className="h-8 w-[10.5rem] rounded-none text-xs"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            title="조회 시작일"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>종료</span>
          <Input
            type="date"
            className="h-8 w-[10.5rem] rounded-none text-xs"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            title="조회 종료일"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>접속페이지</span>
          <select
            className={selectClass}
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            title="접속페이지"
          >
            {CHANNEL_OPTIONS.map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>시스템</span>
          <select
            className={selectClass}
            value={appSys}
            onChange={(e) => setAppSys(e.target.value)}
            title="업무 시스템"
          >
            {appSysOptions.map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>상태</span>
          <select
            className={selectClass}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            title="상태"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>개인정보</span>
          <select
            className={selectClass}
            value={hasPii}
            onChange={(e) => setHasPii(e.target.value)}
            title="개인정보 열람"
          >
            {PII_OPTIONS.map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="relative h-8 w-[9rem]">
          <Input
            className={cn('h-8 w-full rounded-none text-xs', userId.trim() ? 'pr-8' : undefined)}
            placeholder="사용자 ID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void load(1);
            }}
            title="사용자 ID"
          />
          {userId.trim() ? (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setUserId('')}
              title="사용자 ID 지우기"
              aria-label="사용자 ID 지우기"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn('shrink-0 gap-1 rounded-none', uiStyle.secondaryButton)}
          onClick={() => void load(1)}
          disabled={loading || exporting}
          title="검색"
        >
          <Search className="h-3.5 w-3.5" />
          검색
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn('shrink-0 gap-1 rounded-none', uiStyle.secondaryButton)}
          onClick={resetFilters}
          disabled={loading || exporting}
          title="초기화"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          초기화
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn('shrink-0 gap-1 rounded-none', uiStyle.secondaryButton)}
          onClick={() => void exportWorkbook()}
          disabled={loading || exporting}
          title="현재 조건으로 엑셀 내려받기(상세 행, 최대 1만 건)"
        >
          <Download className={cn('h-3.5 w-3.5', exporting && 'animate-pulse')} />
          내려받기
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <span className="whitespace-nowrap text-xs text-muted-foreground">총 {total}건</span>
          {error ? (
            <span className="max-w-[14rem] truncate text-xs text-destructive" title={error}>
              {error}
            </span>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn('shrink-0 gap-1 rounded-none', uiStyle.secondaryButton)}
            onClick={() => void load(page)}
            disabled={loading || exporting}
            title="새로고침"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            새로고침
          </Button>
        </div>
      </div>

      {hint ? <p className="shrink-0 text-xs text-muted-foreground">{hint}</p> : null}

      <div className={uiStyle.tableWrap}>
        <div className={uiStyle.tableScroll}>
          <table className={cn(uiStyle.table, 'min-w-full table-fixed')}>
            <thead className={cn('sticky top-0', historyTable.tableHead)}>
              <tr>
                <th className={cn('w-10 text-center', historyTable.tableCell)}>순번</th>
                <th className={cn('w-32 text-left', historyTable.tableCell)}>열람시간</th>
                <th className={cn('w-20 text-left', historyTable.tableCell)}>사용자 ID</th>
                <th className={cn('w-20 text-left', historyTable.tableCell)}>사용자 이름</th>
                <th className={cn('w-24 text-left', historyTable.tableCell)}>부서</th>
                <th className={cn('w-28 text-left', historyTable.tableCell)}>시스템</th>
                <th className={cn('w-24 text-left', historyTable.tableCell)}>접속IP</th>
                <th className={cn('w-28 text-left', historyTable.tableCell)}>접속페이지</th>
                <th className={cn('w-36 text-left', historyTable.tableCell)}>조회</th>
                <th className={cn('w-14 text-center', historyTable.tableCell)}>상태</th>
                <th className={cn('w-16 text-center', historyTable.tableCell)}>개인정보</th>
                <th className={cn('w-9 text-center', historyTable.tableCell)}>상세</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className={tableRowClass}>
                  <td className={cn('text-muted-foreground', historyTable.tableCell)} colSpan={12}>
                    불러오는 중…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr className={tableRowClass}>
                  <td className={cn('text-muted-foreground', historyTable.tableCell)} colSpan={12}>
                    조회된 이력이 없습니다. (적재 연동·테이블 적용 후 표시됩니다)
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => {
                  const seq = (page - 1) * PAGE_SIZE + idx + 1;
                  const groupN = Math.max(1, Number(r.groupCount ?? 1) || 1);
                  const hasGroup = groupN > 1 || !!String(r.llqGroupKey ?? '').trim();
                  return (
                    <tr key={r.llqKey} className={tableRowClass}>
                      <td className={cn('whitespace-nowrap text-center', historyTable.tableCell)}>
                        {seq}
                      </td>
                      <td className={cn('whitespace-nowrap text-left', historyTable.tableCell)}>
                        {cell(r.llqAt)}
                      </td>
                      <td
                        className={cn(
                          'truncate text-left font-mono text-[11px]',
                          historyTable.tableCell
                        )}
                        title={r.llqUser ?? undefined}
                      >
                        {cell(r.llqUser)}
                      </td>
                      <td
                        className={cn('truncate text-left', historyTable.tableCell)}
                        title={r.usrName ?? undefined}
                      >
                        {cell(r.usrName)}
                      </td>
                      <td
                        className={cn('truncate text-left', historyTable.tableCell)}
                        title={r.ugName ?? undefined}
                      >
                        {cell(r.ugName)}
                      </td>
                      <td
                        className={cn('truncate text-left', historyTable.tableCell)}
                        title={appSysLabel(r)}
                      >
                        {appSysLabel(r)}
                      </td>
                      <td
                        className={cn(
                          'truncate text-left font-mono text-[11px]',
                          historyTable.tableCell
                        )}
                        title={r.llqIp ?? undefined}
                      >
                        {cell(r.llqIp)}
                      </td>
                      <td className={cn('truncate text-left', historyTable.tableCell)}>
                        {channelLabel(r.llqChannel)}
                      </td>
                      <td
                        className={cn('truncate text-left', historyTable.tableCell)}
                        title={groupN > 1 ? `조회 ${groupN}건` : (r.llqSvcId ?? undefined)}
                      >
                        {listSvcLabel(r)}
                      </td>
                      <td className={cn('whitespace-nowrap text-center', historyTable.tableCell)}>
                        {statusListLabel(r.llqStatus)}
                      </td>
                      <td className={cn('whitespace-nowrap text-center', historyTable.tableCell)}>
                        <PiiCellText text={piiListLabel(r.llqHasPii, r.llqPiiMasked)} />
                      </td>
                      <td
                        className={cn(
                          'text-center',
                          historyTable.tableCell,
                          hasGroup &&
                            'cursor-pointer text-primary hover:bg-muted/80 focus-visible:bg-muted/80 focus-visible:outline-none',
                          hasGroup && groupLoading && 'pointer-events-none opacity-50'
                        )}
                        role={hasGroup ? 'button' : undefined}
                        tabIndex={hasGroup ? 0 : undefined}
                        title={hasGroup ? '상세 보기' : undefined}
                        aria-label={hasGroup ? '상세 보기' : undefined}
                        onClick={
                          hasGroup && !groupLoading ? () => void openGroup(r) : undefined
                        }
                        onKeyDown={
                          hasGroup && !groupLoading
                            ? (e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  void openGroup(r);
                                }
                              }
                            : undefined
                        }
                      >
                        {hasGroup ? '보기' : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn('rounded-none', uiStyle.secondaryButton)}
          disabled={loading || page <= 1}
          onClick={() => void load(page - 1)}
        >
          이전
        </Button>
        <span className="text-xs text-muted-foreground">
          {page} / {totalPages}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn('rounded-none', uiStyle.secondaryButton)}
          disabled={loading || page >= totalPages}
          onClick={() => void load(page + 1)}
        >
          다음
        </Button>
      </div>

      <Dialog
        open={groupOpen}
        onOpenChange={(open) => {
          if (!open) closeGroupModal();
        }}
      >
        <DialogContent
          className={cn(
            uiStyle.dialog,
            'w-[min(1040px,95vw)] sm:max-w-[1040px] duration-0 data-[state=open]:animate-none data-[state=closed]:animate-none'
          )}
          overlayClassName="duration-0 data-[state=open]:animate-none data-[state=closed]:animate-none"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>KRAS 조회 상세</DialogTitle>
          </DialogHeader>
          <div
            className={cn(
              uiStyle.dialogHeader,
              'flex h-9 shrink-0 items-center justify-between py-0'
            )}
          >
            <span className="text-sm font-medium leading-none text-foreground">KRAS 조회 상세</span>
            <button
              type="button"
              onClick={closeGroupModal}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-70 transition-opacity hover:bg-muted hover:opacity-100"
              aria-label="닫기"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className={cn(uiStyle.dialogBody, 'flex min-h-0 flex-col gap-2')}>
            <div className="flex min-h-5 shrink-0 flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
              {groupLoading ? (
                <span className="leading-none">불러오는 중…</span>
              ) : groupMeta ? (
                <>
                  <div className="flex items-center gap-2.5 whitespace-nowrap">
                    <span className="shrink-0 text-foreground">열람시간</span>
                    <span className="leading-none">{groupMeta.at}</span>
                  </div>
                  <div className="flex items-center gap-2.5 overflow-hidden whitespace-nowrap">
                    <span className="shrink-0 text-foreground">사용자 이름</span>
                    <span className="min-w-0 truncate leading-none" title={groupMeta.userName}>
                      {groupMeta.userName}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5 overflow-hidden whitespace-nowrap">
                    <span className="shrink-0 text-foreground">부서</span>
                    <span className="min-w-0 truncate leading-none" title={groupMeta.ugName}>
                      {groupMeta.ugName}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5 overflow-hidden whitespace-nowrap">
                    <span className="shrink-0 text-foreground">시스템</span>
                    <span className="min-w-0 truncate leading-none" title={groupMeta.appSys}>
                      {groupMeta.appSys}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5 whitespace-nowrap" title={groupMeta.ip}>
                    <span className="shrink-0 text-foreground">접속IP</span>
                    <span className="font-mono text-[11px] leading-none">{groupMeta.ip}</span>
                  </div>
                  <div className="flex items-center gap-2.5 whitespace-nowrap" title={groupMeta.channel}>
                    <span className="shrink-0 text-foreground">접속페이지</span>
                    <span className="leading-none">{groupMeta.channel}</span>
                  </div>
                </>
              ) : null}
            </div>
            <div className="max-h-[50vh] overflow-auto border border-border">
              <table className={cn(uiStyle.table, 'min-w-full table-fixed')}>
                <thead className={historyTable.tableHead}>
                  <tr>
                    <th className={cn('w-12 text-left', historyTable.tableCell)}>순번</th>
                    <th className={cn('w-44 text-left', historyTable.tableCell)}>필지</th>
                    <th className={cn('w-52 p-0 text-left', historyTable.tableCell)}>
                      <label className="sr-only" htmlFor="llq-group-svc-filter">
                        조회 대상
                      </label>
                      <select
                        id="llq-group-svc-filter"
                        className="h-[30px] w-full max-w-full border-0 bg-transparent px-2 text-xs font-medium text-foreground outline-none disabled:opacity-50"
                        value={groupSvcFilter}
                        disabled={groupLoading || !groupSvcOptions.length}
                        title="조회 대상 필터"
                        aria-label="조회 대상 필터"
                        onChange={(e) => setGroupSvcFilter(e.target.value)}
                      >
                        <option value="">전체</option>
                        {groupSvcOptions.map((id) => (
                          <option key={id} value={id}>
                            {svcLabel(id)}
                          </option>
                        ))}
                      </select>
                    </th>
                    <th className={cn('w-24 text-left', historyTable.tableCell)}>상태</th>
                    <th className={cn('w-64 text-left', historyTable.tableCell)}>개인정보</th>
                    <th className={cn('text-left', historyTable.tableCell)}>메시지</th>
                  </tr>
                </thead>
                <tbody>
                  {groupLoading ? (
                    Array.from({ length: groupExpectedCount }, (_, i) => (
                      <tr key={`group-sk-${i}`} className={tableRowClass}>
                        <td className={cn('text-muted-foreground', historyTable.tableCell)}>
                          {i + 1}
                        </td>
                        <td className={cn('text-muted-foreground', historyTable.tableCell)}>—</td>
                        <td className={cn('text-muted-foreground', historyTable.tableCell)}>—</td>
                        <td className={cn('text-muted-foreground', historyTable.tableCell)}>—</td>
                        <td className={cn('text-muted-foreground', historyTable.tableCell)}>—</td>
                        <td className={cn('text-muted-foreground', historyTable.tableCell)}>—</td>
                      </tr>
                    ))
                  ) : !filteredGroupRows.length ? (
                    <tr className={tableRowClass}>
                      <td className={cn('text-muted-foreground', historyTable.tableCell)} colSpan={6}>
                        {groupRows?.length
                          ? '선택한 조회 대상 이력이 없습니다.'
                          : '묶음 이력이 없습니다.'}
                      </td>
                    </tr>
                  ) : (
                    filteredGroupRows.map((r, i) => (
                      <tr key={r.llqKey} className={tableRowClass}>
                        <td className={cn(historyTable.tableCell)}>{i + 1}</td>
                        <td
                          className={cn('font-mono text-[11px]', historyTable.tableCell)}
                          title={r.llqPnu ?? undefined}
                        >
                          {cell(r.llqPnu)}
                        </td>
                        <td className={cn(historyTable.tableCell)} title={r.llqSvcId ?? undefined}>
                          {svcLabel(r.llqSvcId)}
                        </td>
                        <td className={cn(historyTable.tableCell)}>{statusDetailLabel(r.llqStatus)}</td>
                        <td className={cn('whitespace-nowrap', historyTable.tableCell)}>
                          <PiiCellText
                            text={piiKindLabel(r.llqSvcId, r.llqHasPii, r.llqPiiMasked)}
                          />
                        </td>
                        <td className={cn('truncate', historyTable.tableCell)} title={r.llqMessage ?? undefined}>
                          {cell(r.llqMessage)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
