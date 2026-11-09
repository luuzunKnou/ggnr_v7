/** 공통 점용대장 — 점용 시작·종료(글자) 해석과 종료 기준 진행중/종료 */

export const OCCUPATION_PERIOD_STATE_IN_PROGRESS = '진행중';
export const OCCUPATION_PERIOD_STATE_ENDED = '종료';

export const OCCUPATION_PERIOD_STATE_OPTIONS = [
  { value: OCCUPATION_PERIOD_STATE_IN_PROGRESS, label: OCCUPATION_PERIOD_STATE_IN_PROGRESS },
  { value: OCCUPATION_PERIOD_STATE_ENDED, label: OCCUPATION_PERIOD_STATE_ENDED },
] as const;

export type OccupationPeriodState =
  | typeof OCCUPATION_PERIOD_STATE_IN_PROGRESS
  | typeof OCCUPATION_PERIOD_STATE_ENDED;

/** 기간이 끝나지 않는 표현 */
const OPEN_ENDED_RE = /영구/;

function todayYmdLocal(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function validYear(y: number): boolean {
  return Number.isFinite(y) && y >= 1900 && y <= 2100;
}

/**
 * 글자 속 날짜 표현을 모두 찾아 [가장 이른 날, 가장 늦은 날] 범위로 돌려준다.
 * 2024-03-01 · 2024.03.01 · 2024/3/1 · 20240301 · 2024년 3월 1일 · 2024.03(월) · 2024.(연)
 * 월·연만 있으면 시작은 첫날, 끝은 마지막 날로 본다.
 */
function findDateRanges(text: string): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  const s = String(text ?? '');
  const re =
    /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)|(?<!\d)(\d{4})(?!\d)\s*(?:[.\-/년]\s*(\d{1,2})(?!\d)\s*(?:[.\-/월]\s*(\d{1,2})(?!\d)\s*일?)?)?/g;
  for (const m of s.matchAll(re)) {
    let y: number;
    let mo: number | null;
    let d: number | null;
    if (m[1]) {
      y = Number(m[1]);
      mo = Number(m[2]);
      d = Number(m[3]);
    } else {
      y = Number(m[4]);
      mo = m[5] ? Number(m[5]) : null;
      d = m[6] ? Number(m[6]) : null;
    }
    if (!validYear(y)) continue;
    if (mo != null && (mo < 1 || mo > 12)) continue;
    if (mo == null) {
      out.push({ start: `${y}-01-01`, end: `${y}-12-31` });
      continue;
    }
    const last = lastDayOfMonth(y, mo);
    if (d != null) {
      if (d < 1 || d > last) continue;
      const ymd = `${y}-${pad2(mo)}-${pad2(d)}`;
      out.push({ start: ymd, end: ymd });
    } else {
      out.push({ start: `${y}-${pad2(mo)}-01`, end: `${y}-${pad2(mo)}-${pad2(last)}` });
    }
  }
  return out;
}

/**
 * 점용 시작·종료 글자 → 비교용 YYYY-MM-DD.
 * edge=start 는 가장 이른 날, end 는 가장 늦은 날. 날짜로 읽을 수 없으면 null.
 */
export function parseOccupationPeriodYmd(
  raw: string | null | undefined,
  edge: 'start' | 'end'
): string | null {
  const ranges = findDateRanges(String(raw ?? ''));
  if (ranges.length === 0) return null;
  if (edge === 'start') return ranges.map((r) => r.start).sort()[0]!;
  return ranges.map((r) => r.end).sort().at(-1)!;
}

/** 종료 글자에 «영구»가 있으면 끝나지 않는 기간 */
export function isOpenEndedOccupationPeriod(raw: string | null | undefined): boolean {
  return OPEN_ENDED_RE.test(String(raw ?? ''));
}

/**
 * 종료 글자 기준 상태. «영구»·날짜로 읽을 수 없음·미입력은 진행중,
 * 읽은 종료일이 오늘보다 앞이면 종료.
 */
export function deriveOccupationPeriodState(
  endText: string | null | undefined
): OccupationPeriodState {
  if (isOpenEndedOccupationPeriod(endText)) return OCCUPATION_PERIOD_STATE_IN_PROGRESS;
  const end = parseOccupationPeriodYmd(endText, 'end');
  if (!end) return OCCUPATION_PERIOD_STATE_IN_PROGRESS;
  return end < todayYmdLocal() ? OCCUPATION_PERIOD_STATE_ENDED : OCCUPATION_PERIOD_STATE_IN_PROGRESS;
}
