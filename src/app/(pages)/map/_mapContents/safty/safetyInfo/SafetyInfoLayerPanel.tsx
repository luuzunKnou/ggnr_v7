'use client';

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  Activity,
  AlertTriangle,
  BellRing,
  CalendarDays,
  HeartHandshake,
  Newspaper,
  RefreshCw,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type FeedMeta = {
  datasetId: string;
  title: string;
  subtitle: string;
};

type FeedState = {
  loading: boolean;
  error: string | null;
  items: Record<string, unknown>[];
  /** true면 서버가 DB `ORDER BY`로 이미 정렬 — 클라이언트 재정렬 안 함 */
  sortFromDb?: boolean;
};

/** 포털 dataSn: 1066, 751, 228, 46 — safetydata.config 의 sd-* id 와 대응 (좌: 재난기본·뉴스 / 우: 긴급문자·구호 5:5) */
const SAFETY_INFO_LEFT_ITEMS: FeedMeta[] = [
  {
    datasetId: 'sd-1066',
    title: '재난기본',
    subtitle: '재난 발생·상황 등 기본 현황 정보',
  },
  {
    datasetId: 'sd-46',
    title: '연합뉴스',
    subtitle: '재난·안전 관련 뉴스 헤드라인',
  },
];

/** 우측 열: 긴급재난문자(상)·재난구호상황(하) 동일 높이 비율 */
const SAFETY_INFO_RIGHT_ITEMS: FeedMeta[] = [
  {
    datasetId: 'sd-228',
    title: '긴급재난문자',
    subtitle: '대국민 긴급·안내 문자 요약',
  },
  {
    datasetId: 'sd-751',
    title: '재난구호상황',
    subtitle: '구호·대응 상황 보고',
  },
];

const ALL_DATASET_IDS = [
  ...SAFETY_INFO_LEFT_ITEMS.map((i) => i.datasetId),
  ...SAFETY_INFO_RIGHT_ITEMS.map((i) => i.datasetId),
];

/** 카드 제목 옆 아이콘 (데이터셋별) */
const DATASET_TITLE_ICON: Record<string, LucideIcon> = {
  'sd-1066': AlertTriangle,
  'sd-46': Newspaper,
  'sd-228': BellRing,
  'sd-751': HeartHandshake,
};

/** 구호·문자·뉴스: 미리보기 건수 (데이터셋별 오버라이드 가능) */
const PREVIEW_LIMIT_OTHER = 5;
const PREVIEW_LIMIT_BY_DATASET: Record<string, number> = {
  'sd-1066': 3,
  'sd-751': 3,
};

function getPreviewLimit(datasetId: string): number {
  return PREVIEW_LIMIT_BY_DATASET[datasetId] ?? PREVIEW_LIMIT_OTHER;
}

function formatFieldValue(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** 포털 JSON이 `CRT_DT` / `crtDt` / `lastMdfcnDt` 등으로 올 수 있어 언더스코어 무시·대소문자 무시로 매칭 */
function normalizeFieldKey(name: string): string {
  return name.replace(/_/g, '').toLowerCase();
}

function pickRowValue(row: Record<string, unknown>, nameEn: string): unknown {
  if (Object.prototype.hasOwnProperty.call(row, nameEn)) return row[nameEn];
  const want = normalizeFieldKey(nameEn);
  for (const k of Object.keys(row)) {
    if (normalizeFieldKey(k) === want) return row[k];
  }
  return undefined;
}

type RealtimeColumn = { label: string; field: string; isDateTime?: boolean; isDateOnly?: boolean };

/** 실시간 패널에 노출할 필드만 (연합뉴스 sd-46 은 `Sd46FeedRow` 전용) */
const REALTIME_DISPLAY_COLUMNS: Record<string, RealtimeColumn[]> = {};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `yyyy.MM.dd` */
function formatUnifiedDateOnly(v: unknown): string {
  if (v == null || v === '') return '—';
  const ms = parseDateToMs(v);
  if (ms <= 0) {
    const s = formatFieldValue(v);
    return s || '—';
  }
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}.${m}.${day}`;
}

/** `yyyy.mm.dd.` (날짜만, 끝 마침표) — 재난구호 피해일 등 */
function formatUnifiedDateYmdTrailingDot(v: unknown): string {
  const s = formatUnifiedDateOnly(v);
  if (s === '—') return '—';
  return `${s}.`;
}

/** `yyyy.MM.dd. HH:mm:ss` (날짜만 있으면 시각은 00:00:00) */
function formatUnifiedDateTime(v: unknown): string {
  if (v == null || v === '') return '—';
  const ms = parseDateToMs(v);
  if (ms <= 0) {
    const s = formatFieldValue(v);
    return s || '—';
  }
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${y}.${m}.${day}. ${hh}:${mi}:${ss}`;
}

/** Y/N·동의어 → 배지 문구 `진행` | `종료` */
function mapLocaSituationPrgrs(raw: unknown): { text: '진행' | '종료'; ongoing: boolean } | null {
  const t = formatFieldValue(raw).trim();
  if (!t) return null;
  const upper = t.toUpperCase();
  if (upper === 'Y' || upper === 'YES' || t === '예' || t === '진행') {
    return { text: '진행', ongoing: true };
  }
  if (upper === 'N' || upper === 'NO' || upper === 'FALSE' || t === '아니오' || t === '종료') {
    return { text: '종료', ongoing: false };
  }
  return null;
}

function getSd1066RowParts(row: Record<string, unknown>): {
  name: string;
  dateStr: string;
  locaRaw: unknown;
} {
  const nameRaw = pickRowValue(row, 'MSTN_NM');
  const name = formatFieldValue(nameRaw).trim() || '—';
  const dateStr = formatUnifiedDateOnly(pickRowValue(row, 'MSTN_BGNG_YMD'));
  const locaRaw = pickRowValue(row, 'LOCA_SITU_PRGRS_YN');
  return { name, dateStr, locaRaw };
}

function LocaSituationBadge({ raw }: { raw: unknown }) {
  const mapped = mapLocaSituationPrgrs(raw);
  const display = mapped?.text ?? '—';
  const ongoing = mapped?.ongoing ?? null;
  return (
    <span
      className={cn(
        'inline-flex max-w-[8rem] shrink-0 items-center justify-center truncate rounded-full border px-2 py-0.5 text-[11px] font-medium',
        ongoing === true && 'border-emerald-200/90 bg-emerald-50 text-emerald-800',
        ongoing === false && 'border-border bg-muted/40 text-foreground',
        ongoing === null && 'border-border/80 bg-background text-muted-foreground'
      )}
      title={mapped ? undefined : formatFieldValue(raw).trim() || undefined}
    >
      {display}
    </span>
  );
}

function Sd1066FeedRow({ row }: { row: Record<string, unknown> }) {
  const { name, dateStr, locaRaw } = getSd1066RowParts(row);
  return (
    <div className="flex items-center justify-between gap-2 rounded border border-border bg-muted/30 px-2 py-1.5 text-[11px] leading-snug text-foreground">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0 tabular-nums text-muted-foreground">{dateStr}</span>
        <span className="shrink-0 text-muted-foreground/40" aria-hidden>
          ·
        </span>
        <span className="min-w-0 truncate font-medium text-foreground" title={name !== '—' ? name : undefined}>
          {name}
        </span>
      </div>
      <LocaSituationBadge raw={locaRaw} />
    </div>
  );
}

function getSd751RowParts(row: Record<string, unknown>): {
  damageDt: string;
  cause: string;
  writtenAt: string;
  body: string;
} {
  const damageDt = formatUnifiedDateYmdTrailingDot(pickRowValue(row, 'DAM_DT'));
  const causeRaw = pickRowValue(row, 'DAM_CS_CN');
  const cause = formatFieldValue(causeRaw).trim() || '—';
  const writtenAt = formatUnifiedDateTime(pickRowValue(row, 'FRST_REG_DT'));
  const bodyRaw = pickRowValue(row, 'EVPE_DSSTR_ETC');
  const body = formatFieldValue(bodyRaw).trim() || '—';
  return { damageDt, cause, writtenAt, body };
}

function Sd751FeedRow({ row }: { row: Record<string, unknown> }) {
  const { damageDt, cause, writtenAt, body } = getSd751RowParts(row);
  return (
    <div className="rounded border border-border bg-muted/30 px-2 py-1.5 text-[11px] leading-relaxed text-foreground">
      <div className="flex min-w-0 flex-wrap items-start gap-x-1.5 gap-y-0.5">
        <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0 tabular-nums text-muted-foreground">{damageDt}</span>
        <span className="shrink-0 text-muted-foreground/40" aria-hidden>
          ·
        </span>
        <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere] text-foreground">{cause}</span>
      </div>
      <div className="mt-1.5 space-y-1 border-t border-border pt-1.5">
        <div className="break-words [overflow-wrap:anywhere]">
          <span className="font-medium text-muted-foreground">작성일</span>
          <span className="mx-1 text-muted-foreground">·</span>
          <span className="tabular-nums text-foreground">{writtenAt}</span>
        </div>
        <div className="break-words text-foreground [overflow-wrap:anywhere]">{body}</div>
      </div>
    </div>
  );
}

function getSd228RowParts(row: Record<string, unknown>): {
  crtDt: string;
  step: string;
  dst: string;
  msg: string;
} {
  const crtRaw = pickRowValue(row, 'CRT_DT');
  const crtDt = formatUnifiedDateTime(crtRaw);
  const step = formatFieldValue(pickRowValue(row, 'EMRG_STEP_NM')).trim() || '—';
  const dst = formatFieldValue(pickRowValue(row, 'DST_SE_NM')).trim() || '—';
  const msg = formatFieldValue(pickRowValue(row, 'MSG_CN')).trim() || '—';
  return { crtDt, step, dst, msg };
}

function Sd228FeedRow({ row }: { row: Record<string, unknown> }) {
  const { crtDt, step, dst, msg } = getSd228RowParts(row);
  return (
    <div className="rounded border border-border bg-muted/30 px-2 py-1.5 text-[11px] leading-relaxed text-foreground">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0 tabular-nums text-muted-foreground">{crtDt}</span>
        <span className="shrink-0 text-muted-foreground/40" aria-hidden>
          ·
        </span>
        <span className="min-w-0 font-medium [overflow-wrap:anywhere] text-foreground">{step}</span>
        <span className="shrink-0 text-muted-foreground/40" aria-hidden>
          ·
        </span>
        <span className="min-w-0 [overflow-wrap:anywhere] text-foreground">{dst}</span>
      </div>
      <div className="mt-1.5 border-t border-border pt-1.5 break-words text-foreground [overflow-wrap:anywhere]">
        {msg}
      </div>
    </div>
  );
}

/** 내용 첫 줄이 제목과 같거나 제목으로 시작하면 그 부분 제거 */
function stripSd46BodyLeadingTitle(title: string, body: string): string {
  const b = body.trim();
  if (!b) return '';
  const t = title.trim();
  if (!t || t === '—') return b;
  const lines = b.split(/\r?\n/);
  const first = (lines[0] ?? '').trim();

  if (first === t) {
    return lines.slice(1).join('\n').trim();
  }
  if (first.startsWith(t)) {
    const restFirst = first.slice(t.length).replace(/^[\s:：\-–—]+/, '').trim();
    const rest = restFirst ? [restFirst, ...lines.slice(1)] : lines.slice(1);
    return rest.join('\n').trim();
  }
  return b;
}

function getSd46RowParts(row: Record<string, unknown>): { title: string; body: string; dateTime: string } {
  const title = formatFieldValue(pickRowValue(row, 'YNA_TTL')).trim() || '—';
  const bodyRaw = formatFieldValue(pickRowValue(row, 'YNA_CN')).trim();
  const body = stripSd46BodyLeadingTitle(title, bodyRaw);
  const dateTime = formatUnifiedDateTime(pickRowValue(row, 'YNA_YMD'));
  return { title, body, dateTime };
}

/** 연합뉴스: 제목 → 일시(좌측) → 내용, 필드 라벨·구분선 없음 */
function Sd46FeedRow({ row }: { row: Record<string, unknown> }) {
  const { title, body, dateTime } = getSd46RowParts(row);
  return (
    <div className="rounded border border-border bg-muted/30 px-2 py-1.5 text-[11px] text-foreground">
      <p className="font-medium leading-snug [overflow-wrap:anywhere] text-foreground">{title}</p>
      <p className="mt-0.5 text-left tabular-nums leading-normal text-muted-foreground">{dateTime}</p>
      {body ? <p className="mt-1 leading-relaxed [overflow-wrap:anywhere] text-foreground">{body}</p> : null}
    </div>
  );
}

function buildDisplayLines(datasetId: string, row: Record<string, unknown>): { label: string; value: string }[] {
  const cols = REALTIME_DISPLAY_COLUMNS[datasetId];
  if (!cols?.length) {
    return Object.entries(row).map(([k, v]) => ({ label: k, value: formatFieldValue(v) }));
  }
  return cols.map(({ label, field, isDateTime, isDateOnly }) => {
    const raw = pickRowValue(row, field);
    if (isDateOnly) {
      return { label, value: formatUnifiedDateOnly(raw) };
    }
    if (isDateTime) {
      return { label, value: formatUnifiedDateTime(raw) };
    }
    const t = formatFieldValue(raw);
    return { label, value: t || '—' };
  });
}

/** 정렬용 시각(ms). YYYYMMDD / YYYYMMDDHHmm / YYYYMMDDHHmmss·ISO·Unix 초/밀초 */
function parseDateToMs(v: unknown): number {
  if (v == null) return 0;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.getTime();
  if (typeof v === 'number' && Number.isFinite(v)) {
    const n = v;
    if (n > 1e12) return n;
    if (n >= 1e9) return n * 1000;
    return 0;
  }
  const s = String(v).trim();
  if (!s) return 0;

  const isoTry = Date.parse(s.replace(/\./g, '-').replace(/\//g, '-'));
  if (!Number.isNaN(isoTry)) return isoTry;

  const digits = s.replace(/\D/g, '');
  if (digits.length < 8) return 0;

  const y = parseInt(digits.slice(0, 4), 10);
  const mo = parseInt(digits.slice(4, 6), 10) - 1;
  const d = parseInt(digits.slice(6, 8), 10);
  if (!Number.isFinite(y) || mo < 0 || mo > 11 || !Number.isFinite(d)) return 0;

  let ms = new Date(y, mo, d).getTime();
  if (digits.length >= 14) {
    const hh = parseInt(digits.slice(8, 10), 10) || 0;
    const mm = parseInt(digits.slice(10, 12), 10) || 0;
    const ss = parseInt(digits.slice(12, 14), 10) || 0;
    ms += (hh * 3600 + mm * 60 + ss) * 1000;
  } else if (digits.length >= 12) {
    const hh = parseInt(digits.slice(8, 10), 10) || 0;
    const mm = parseInt(digits.slice(10, 12), 10) || 0;
    ms += (hh * 3600 + mm * 60) * 1000;
  }
  return ms;
}

/** 재난기본: 시작일자 + 시작시분초(6자리 등) 결합 정렬 */
function combineYmdAndHm(ymd: unknown, hm: unknown): number {
  const ds = String(ymd ?? '').replace(/\D/g, '');
  if (ds.length < 8) return 0;
  const y = parseInt(ds.slice(0, 4), 10);
  const mo = parseInt(ds.slice(4, 6), 10) - 1;
  const day = parseInt(ds.slice(6, 8), 10);
  if (!Number.isFinite(y) || mo < 0 || mo > 11) return 0;
  let ms = new Date(y, mo, day).getTime();
  const hms = String(hm ?? '').replace(/\D/g, '');
  if (hms.length >= 6) {
    const hh = parseInt(hms.slice(0, 2), 10) || 0;
    const mm = parseInt(hms.slice(2, 4), 10) || 0;
    const ss = parseInt(hms.slice(4, 6), 10) || 0;
    ms += (hh * 3600 + mm * 60 + ss) * 1000;
  } else if (hms.length >= 4) {
    const hh = parseInt(hms.slice(0, 2), 10) || 0;
    const mm = parseInt(hms.slice(2, 4), 10) || 0;
    ms += (hh * 3600 + mm * 60) * 1000;
  }
  return ms;
}

function getRowSortTime(datasetId: string, row: Record<string, unknown>): number {
  /** 재난기본: DB와 동일 `ORDER BY mstn_bgng_ymd DESC` — 같은 일자는 시작시분초로 보조 */
  if (datasetId === 'sd-1066') {
    const ymdHm = combineYmdAndHm(
      pickRowValue(row, 'MSTN_BGNG_YMD'),
      pickRowValue(row, 'MSTN_BGNG_HOMINSEC')
    );
    if (ymdHm > 0) return ymdHm;
    return parseDateToMs(pickRowValue(row, 'MSTN_BGNG_YMD'));
  }

  /** 긴급재난문자: `ORDER BY crt_dt DESC` */
  if (datasetId === 'sd-228') {
    return parseDateToMs(pickRowValue(row, 'CRT_DT'));
  }

  /** 연합뉴스: `ORDER BY yna_ymd DESC` */
  if (datasetId === 'sd-46') {
    return parseDateToMs(pickRowValue(row, 'YNA_YMD'));
  }

  const order: Record<string, string[]> = {
    'sd-751': ['LAST_MDFCN_DT', 'FRST_REG_DT', 'DAM_DT'],
  };
  const keys = order[datasetId] ?? ['CRT_DT'];
  for (const k of keys) {
    const t = parseDateToMs(pickRowValue(row, k));
    if (t > 0) return t;
  }
  return 0;
}

/** 시각 동일 시 일련값으로 안정 정렬(큰 값을 더 최근으로 가정) */
function getTieBreakSortKey(datasetId: string, row: Record<string, unknown>): number {
  const idField: Record<string, string> = {
    'sd-46': 'YNA_NO',
    'sd-228': 'SN',
    'sd-1066': 'MSTN_SN',
    'sd-751': 'SITU_RPT_MNG_NO',
  };
  const f = idField[datasetId];
  if (!f) return 0;
  const v = pickRowValue(row, f);
  const n = Number(String(v ?? '').replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** 최신이 위로 */
function sortItemsLatestFirst(
  datasetId: string,
  items: Record<string, unknown>[]
): Record<string, unknown>[] {
  return [...items].sort((a, b) => {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const tb = getRowSortTime(datasetId, rb) - getRowSortTime(datasetId, ra);
    if (tb !== 0) return tb;
    return getTieBreakSortKey(datasetId, rb) - getTieBreakSortKey(datasetId, ra);
  });
}

/**
 * 재난기본: 유효한 재난종료일(MSTN_END_YMD)이 있으면 종료로 보고, 없거나 무효하면 진행중.
 * (API 코드값이 다를 경우 포털 문서에 맞게 조정)
 */
function isDisasterOngoing(row: Record<string, unknown>): boolean {
  const raw = pickRowValue(row, 'MSTN_END_YMD');
  const endYmd = String(raw ?? '')
    .trim()
    .replace(/\D/g, '');
  if (endYmd.length < 8) return true;
  const y = parseInt(endYmd.slice(0, 4), 10);
  if (!Number.isFinite(y) || y < 1990 || y > 2100) return true;
  if (endYmd.startsWith('0000') || endYmd.includes('99991231')) return true;
  return false;
}

type PreparedFeed = {
  rows: Record<string, unknown>[];
  moreCount: number;
  showMoreToggle: boolean;
  summary?: string;
};

function prepareFeedRows(
  datasetId: string,
  items: Record<string, unknown>[],
  expanded: boolean,
  sortFromDb?: boolean
): PreparedFeed {
  const sorted = sortFromDb ? [...items] : sortItemsLatestFirst(datasetId, items);

  if (datasetId === 'sd-1066') {
    const limit = getPreviewLimit('sd-1066');
    const ongoing = sorted.filter((r) => isDisasterOngoing(r as Record<string, unknown>));
    const ended = sorted.filter((r) => !isDisasterOngoing(r as Record<string, unknown>));
    const hiddenWhenCollapsed = Math.max(0, ongoing.length - limit) + ended.length;
    if (expanded) {
      return {
        rows: [...ongoing, ...ended],
        moreCount: hiddenWhenCollapsed,
        showMoreToggle: hiddenWhenCollapsed > 0,
      };
    }
    return {
      rows: ongoing.slice(0, limit),
      moreCount: hiddenWhenCollapsed,
      showMoreToggle: hiddenWhenCollapsed > 0,
    };
  }

  const previewLimit = getPreviewLimit(datasetId);
  if (sorted.length <= previewLimit) {
    return {
      rows: sorted,
      moreCount: 0,
      showMoreToggle: false,
      summary: `${sorted.length}건`,
    };
  }
  if (expanded) {
    return {
      rows: sorted,
      moreCount: sorted.length - previewLimit,
      showMoreToggle: true,
    };
  }
  return {
    rows: sorted.slice(0, previewLimit),
    moreCount: sorted.length - previewLimit,
    showMoreToggle: true,
  };
}

function formatTime(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

type SafetyInfoDatasetArticleProps = {
  item: FeedMeta;
  feeds: Record<string, FeedState>;
  feedExpanded: Record<string, boolean>;
  setFeedExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  /** 뉴스 열 등: 카드·목록이 남은 높이를 채우고 스크롤 */
  fillColumnHeight?: boolean;
};

function SafetyInfoDatasetArticle({
  item,
  feeds,
  feedExpanded,
  setFeedExpanded,
  fillColumnHeight = false,
}: SafetyInfoDatasetArticleProps) {
  const st = feeds[item.datasetId];
  const expanded = Boolean(feedExpanded[item.datasetId]);
  const prepared =
    st && !st.loading && !st.error && st.items.length > 0
      ? prepareFeedRows(item.datasetId, st.items, expanded, st.sortFromDb)
      : null;
  const TitleIcon = DATASET_TITLE_ICON[item.datasetId];

  return (
    <article
      className={cn(
        'rounded-[5px] border border-border/90 bg-background px-3 py-2.5 shadow-sm',
        fillColumnHeight && 'flex min-h-0 flex-1 basis-0 flex-col'
      )}
      aria-label={item.title}
    >
      <p className="flex shrink-0 items-start gap-2 text-[12px] leading-snug">
        {TitleIcon ? (
          <TitleIcon className="mt-0.5 h-[14px] w-[14px] shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
        ) : null}
        <span className="min-w-0">
          <span className="font-medium text-foreground">{item.title}</span>
          <span className="text-muted-foreground"> · </span>
          <span className="text-[11px] font-normal text-muted-foreground">{item.subtitle}</span>
        </span>
      </p>
      <div
        className={cn(
          'mt-2 border-t border-border pt-2',
          fillColumnHeight && 'flex min-h-0 flex-1 flex-col'
        )}
      >
        {st?.loading ? (
          <p className="text-[11px] text-muted-foreground">불러오는 중…</p>
        ) : st?.error ? (
          <p className="text-[11px] leading-snug text-destructive">{st.error}</p>
        ) : st && st.items.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">표시할 데이터가 없습니다.</p>
        ) : prepared ? (
          <>
            {prepared.summary ? (
              <p className={cn('mb-2 text-[11px] text-muted-foreground', fillColumnHeight && 'shrink-0')}>{prepared.summary}</p>
            ) : null}
            {prepared.rows.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {item.datasetId === 'sd-1066' && !expanded
                  ? '진행중인 재난이 없습니다.'
                  : '표시할 데이터가 없습니다.'}
              </p>
            ) : (
              <div
                className={cn(
                  'scrollbar-hide space-y-2 overflow-y-auto pr-0.5',
                  fillColumnHeight ? 'min-h-0 flex-1' : 'max-h-[280px]'
                )}
              >
                {prepared.rows.map((row, idx) =>
                  item.datasetId === 'sd-1066' ? (
                    <Sd1066FeedRow key={idx} row={row as Record<string, unknown>} />
                  ) : item.datasetId === 'sd-751' ? (
                    <Sd751FeedRow key={idx} row={row as Record<string, unknown>} />
                  ) : item.datasetId === 'sd-228' ? (
                    <Sd228FeedRow key={idx} row={row as Record<string, unknown>} />
                  ) : item.datasetId === 'sd-46' ? (
                    <Sd46FeedRow key={idx} row={row as Record<string, unknown>} />
                  ) : (
                    <div
                      key={idx}
                      className="rounded border border-border bg-muted/30 px-2 py-1.5 text-[11px] leading-relaxed text-foreground"
                    >
                      {buildDisplayLines(item.datasetId, row as Record<string, unknown>).map((line, i) => (
                        <div
                          key={`${line.label}-${i}`}
                          className="break-words border-b border-border py-0.5 last:border-b-0"
                        >
                          <span className="font-medium text-muted-foreground">{line.label}</span>
                          <span className="mx-1 text-muted-foreground">·</span>
                          <span className="text-foreground [overflow-wrap:anywhere]">{line.value || '—'}</span>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            )}
            {prepared.showMoreToggle ? (
              <button
                type="button"
                onClick={() =>
                  setFeedExpanded((prev) => ({
                    ...prev,
                    [item.datasetId]: !expanded,
                  }))
                }
                className={cn(
                  'mt-2 w-full rounded border border-border bg-background py-1.5 text-[11px] font-medium text-primary hover:bg-muted/50',
                  fillColumnHeight && 'shrink-0'
                )}
              >
                {expanded ? '접기' : `더 보기 (${prepared.moreCount}건)`}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </article>
  );
}

type Props = {
  onClose: () => void;
};

export function SafetyInfoLayerPanel({ onClose }: Props) {
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** 데이터셋별「더 보기」펼침 — 새로고침 시 초기화 */
  const [feedExpanded, setFeedExpanded] = useState<Record<string, boolean>>({});
  const [feeds, setFeeds] = useState<Record<string, FeedState>>(() => {
    const init: Record<string, FeedState> = {};
    for (const id of ALL_DATASET_IDS) {
      init[id] = { loading: true, error: null, items: [] };
    }
    return init;
  });

  const loadFeeds = useCallback(async () => {
    setRefreshing(true);
    setFeedExpanded({});
    setFeeds((prev) => {
      const next = { ...prev };
      for (const id of ALL_DATASET_IDS) {
        next[id] = { ...next[id], loading: true, error: null };
      }
      return next;
    });

    await Promise.all(
      ALL_DATASET_IDS.map(async (datasetId) => {
        try {
          const res = await fetch('/api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              service: 'integrationService',
              action: 'fetchSafetydataRealtimeFeed',
              params: { datasetId },
            }),
          });
          const json = (await res.json()) as {
            success?: boolean;
            error?: string;
            data?: {
              items?: Record<string, unknown>[];
              source?: string;
            };
          };
          if (!json.success) {
            throw new Error(json.error ?? '요청 실패');
          }
          const sortFromDb = json.data?.source === 'database';
          setFeeds((prev) => ({
            ...prev,
            [datasetId]: {
              loading: false,
              error: null,
              items: json.data?.items ?? [],
              sortFromDb,
            },
          }));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setFeeds((prev) => ({
            ...prev,
            [datasetId]: {
              loading: false,
              error: msg,
              items: [],
              sortFromDb: false,
            },
          }));
        }
      })
    );

    setLastRefresh(new Date());
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void loadFeeds();
  }, [loadFeeds]);

  return (
    <div
      className="flex flex-1 min-h-0 flex-col overflow-hidden opacity-[0.98]"
      aria-label="실시간 재난정보 목록"
    >
      <div className="shrink-0 border-b border-border bg-gradient-to-b from-primary/5 to-background px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="text-[11px] font-semibold leading-tight text-foreground">실시간 재난정보</h2>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              좌: 재난기본·연합뉴스 · 우: 긴급재난문자·재난구호상황
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2 border-t border-border/80 pt-3">
          <Activity className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <span className="text-[11px] text-muted-foreground">마지막 갱신</span>
          <span className="text-[11px] font-medium tabular-nums text-foreground">
            {lastRefresh ? formatTime(lastRefresh) : '—'}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => void loadFeeds()}
            disabled={refreshing}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              refreshing
                ? 'cursor-wait text-muted-foreground'
                : 'text-primary hover:bg-primary/10'
            )}
            aria-label="목록 새로고침"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            새로고침
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden bg-muted/30 p-3">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            {SAFETY_INFO_LEFT_ITEMS.map((item) => (
              <SafetyInfoDatasetArticle
                key={item.datasetId}
                item={item}
                feeds={feeds}
                feedExpanded={feedExpanded}
                setFeedExpanded={setFeedExpanded}
                fillColumnHeight={item.datasetId === 'sd-46'}
              />
            ))}
          </div>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 border-l border-border/80 pl-3">
          {SAFETY_INFO_RIGHT_ITEMS.map((item) => (
            <SafetyInfoDatasetArticle
              key={item.datasetId}
              item={item}
              feeds={feeds}
              feedExpanded={feedExpanded}
              setFeedExpanded={setFeedExpanded}
              fillColumnHeight
            />
          ))}
        </div>
      </div>
    </div>
  );
}
