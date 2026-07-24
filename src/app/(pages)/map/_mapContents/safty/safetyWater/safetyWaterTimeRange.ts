import type { FloodTimeType } from './safetyWaterTypes';

const DAY_MS = 24 * 60 * 60 * 1000;

export type StatsRange = {
  /** datetime-local 호환: yyyy-MM-ddTHH:mm (1D는 날짜만 쓸 때 T00:00) */
  start: string;
  end: string;
};

export function maxRangeNotice(time: FloodTimeType): string {
  if (time === '10M') return '최대 1개월까지 조회할 수 있습니다.';
  if (time === '1H') return '최대 1개월까지 조회할 수 있습니다.';
  return '최대 1년까지 조회할 수 있습니다.';
}

export function maxRangeMs(time: FloodTimeType): number {
  if (time === '1D') return 365 * DAY_MS;
  return 31 * DAY_MS;
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

export function toLocalDateTimeValue(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function toLocalDateValue(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** input[type=date|datetime-local] max (미래 선택 금지) */
export function maxInputValue(time: FloodTimeType, now = new Date()): string {
  if (time === '1D') return toLocalDateValue(now);
  if (time === '1H') {
    const d = new Date(now);
    d.setMinutes(0, 0, 0);
    return toLocalDateTimeValue(d);
  }
  const d = new Date(now);
  d.setMinutes(Math.floor(d.getMinutes() / 10) * 10, 0, 0);
  return toLocalDateTimeValue(d);
}

export function isNotFuture(value: string, time: FloodTimeType, now = new Date()): boolean {
  const d = parseLocalDateTime(value);
  const max = parseLocalDateTime(maxInputValue(time, now));
  if (!d || !max) return false;
  return d.getTime() <= max.getTime();
}

export function parseLocalDateTime(value: string): Date | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(`${value}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value.length === 16 ? `${value}:00` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** API sdt/edt 포맷 */
export function toApiRangeToken(d: Date, time: FloodTimeType): string {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const h = pad2(d.getHours());
  const min = pad2(d.getMinutes());
  if (time === '1D') return `${y}${m}${day}`;
  if (time === '1H') return `${y}${m}${day}${h}`;
  return `${y}${m}${day}${h}${min}`;
}

/** 종료 24:00 → API 토큰 (1H는 다음날 00시) */
export function toApiEndToken(d: Date, time: FloodTimeType, endAsDayEnd: boolean): string {
  if (time === '1D') return toApiRangeToken(d, '1D');
  if (time === '1H' && endAsDayEnd) {
    const next = new Date(d);
    next.setHours(0, 0, 0, 0);
    next.setDate(next.getDate() + 1);
    return toApiRangeToken(next, '1H');
  }
  return toApiRangeToken(d, time);
}

export function defaultStatsRange(time: FloodTimeType, now = new Date()): StatsRange {
  const end = new Date(now);
  const start = new Date(now);
  if (time === '10M') {
    end.setMinutes(Math.floor(end.getMinutes() / 10) * 10, 0, 0);
    start.setTime(end.getTime());
    start.setMonth(start.getMonth() - 1);
    return { start: toLocalDateTimeValue(start), end: toLocalDateTimeValue(end) };
  }
  if (time === '1H') {
    end.setMinutes(0, 0, 0);
    start.setTime(end.getTime());
    start.setMonth(start.getMonth() - 1);
    start.setMinutes(0, 0, 0);
    return { start: toLocalDateTimeValue(start), end: toLocalDateTimeValue(end) };
  }
  end.setHours(0, 0, 0, 0);
  start.setTime(end.getTime());
  start.setMonth(start.getMonth() - 1);
  return { start: toLocalDateValue(start), end: toLocalDateValue(end) };
}

/**
 * 검색 단위 변경 시 기간 유지 규칙
 * - →10M: 종료 시각 기준 1개월
 * - 1D→1H: 시작일 0시 ~ 종료일 24:00(다음날 0시)
 * - 그 외: 최대한 유지 후 단위에 맞게 절삭
 */
export function convertStatsRange(
  prevTime: FloodTimeType,
  nextTime: FloodTimeType,
  prev: StatsRange
): StatsRange {
  const prevStart = parseLocalDateTime(prev.start);
  const prevEnd = parseLocalDateTime(prev.end);
  if (!prevStart || !prevEnd) return defaultStatsRange(nextTime);

  let next: StatsRange;

  if (nextTime === '10M') {
    const end = new Date(prevEnd);
    end.setMinutes(Math.floor(end.getMinutes() / 10) * 10, 0, 0);
    const start = new Date(end);
    start.setMonth(start.getMonth() - 1);
    next = { start: toLocalDateTimeValue(start), end: toLocalDateTimeValue(end) };
  } else if (prevTime === '1D' && nextTime === '1H') {
    const start = new Date(prevStart);
    start.setHours(0, 0, 0, 0);
    const endDay = new Date(prevEnd);
    endDay.setHours(0, 0, 0, 0);
    endDay.setDate(endDay.getDate() + 1);
    next = { start: toLocalDateTimeValue(start), end: toLocalDateTimeValue(endDay) };
  } else if (nextTime === '1H') {
    const start = new Date(prevStart);
    start.setMinutes(0, 0, 0);
    const end = new Date(prevEnd);
    end.setMinutes(0, 0, 0);
    next = { start: toLocalDateTimeValue(start), end: toLocalDateTimeValue(end) };
  } else {
    const start = new Date(prevStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(prevEnd);
    if (prevTime === '1H' && end.getHours() === 0 && end.getMinutes() === 0 && end > start) {
      const maybePrevDay = new Date(end);
      maybePrevDay.setDate(maybePrevDay.getDate() - 1);
      next = { start: toLocalDateValue(start), end: toLocalDateValue(maybePrevDay) };
    } else {
      end.setHours(0, 0, 0, 0);
      next = { start: toLocalDateValue(start), end: toLocalDateValue(end) };
    }
  }

  return clampStatsRange(nextTime, next);
}

export function clampStatsRange(time: FloodTimeType, range: StatsRange): StatsRange {
  const s = parseLocalDateTime(range.start);
  const e = parseLocalDateTime(range.end);
  if (!s || !e) return defaultStatsRange(time);
  if (e < s) return defaultStatsRange(time);
  if (e.getTime() - s.getTime() <= maxRangeMs(time)) return range;
  const start = new Date(e.getTime() - maxRangeMs(time));
  if (time === '1D') {
    start.setHours(0, 0, 0, 0);
    e.setHours(0, 0, 0, 0);
    return { start: toLocalDateValue(start), end: toLocalDateValue(e) };
  }
  if (time === '1H') {
    start.setMinutes(0, 0, 0);
    e.setMinutes(0, 0, 0);
  } else {
    start.setMinutes(Math.floor(start.getMinutes() / 10) * 10, 0, 0);
    e.setMinutes(Math.floor(e.getMinutes() / 10) * 10, 0, 0);
  }
  return { start: toLocalDateTimeValue(start), end: toLocalDateTimeValue(e) };
}

export function isStatsRangeValid(time: FloodTimeType, start: string, end: string): boolean {
  const s = parseLocalDateTime(start);
  const e = parseLocalDateTime(end);
  if (!s || !e || s > e) return false;
  return e.getTime() - s.getTime() <= maxRangeMs(time);
}

export function inputTypeForTime(time: FloodTimeType): 'date' | 'datetime-local' {
  return time === '1D' ? 'date' : 'datetime-local';
}

export function inputStepForTime(time: FloodTimeType): number | undefined {
  if (time === '10M') return 600;
  if (time === '1H') return 3600;
  return undefined;
}

export function formatStatBucketLabel(key: string): string {
  if (key.length === 8) {
    return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
  }
  if (key.length === 10) {
    return `${key.slice(4, 6)}-${key.slice(6, 8)} ${key.slice(8, 10)}시`;
  }
  if (key.length >= 12) {
    return `${key.slice(4, 6)}-${key.slice(6, 8)} ${key.slice(8, 10)}:${key.slice(10, 12)}`;
  }
  return key;
}

export function bucketKeyFromObservedAt(observedAt: string, time: FloodTimeType): string | null {
  const raw = observedAt.replace(/\D/g, '');
  if (time === '1D') return raw.length >= 8 ? raw.slice(0, 8) : null;
  if (time === '1H') return raw.length >= 10 ? raw.slice(0, 10) : null;
  return raw.length >= 12 ? raw.slice(0, 12) : null;
}
