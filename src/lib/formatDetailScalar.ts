/**
 * 데이터조회·시설 상세 등: 숫자는 소수 끝의 불필요한 0 제거 + ko-KR 천단위, 날짜는 yyyy-mm-dd, 그 외 원문.
 * define_field_type이 있으면 자료형 우선(NUMBER만 콤마). 없으면 값 형태 휴리스틱.
 */

import { normalizeDefineFieldType } from '@/lib/defineLayerFieldTypeNormalize';
import { tryFormatToYmd } from '@/lib/formatDateYmd';

export type FormatDetailScalarOptions = {
  empty?: string;
  /** defineLayer define_field_type — 있으면 자료형 우선 */
  fieldType?: unknown;
};

/** 유한 숫자 → 천단위 구분, 소수 끝 0 제거 (최대 소수 20자리) */
export function formatFiniteNumberKoTrimZeros(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return n.toLocaleString('ko-KR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 20,
  });
}

function isLikelyPlainNumericForDisplay(s: string): boolean {
  const t = s.trim().replace(/,/g, '');
  if (t === '') return false;
  if (/^0\d+$/.test(t)) return false;
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return false;
  if (/^-?\d{8}$/.test(t)) return false;
  const intPart = t.replace(/^-/, '').split(/[.eE]/)[0] ?? '';
  if (intPart.length >= 12) return false;
  return true;
}

function tryFormatAsNumberString(s: string, strictHeuristics: boolean): string | null {
  const cleaned = s.replace(/,/g, '');
  if (strictHeuristics) {
    if (!isLikelyPlainNumericForDisplay(s)) return null;
  } else if (cleaned === '' || !/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(cleaned)) {
    return null;
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return formatFiniteNumberKoTrimZeros(n);
}

/**
 * 상세 필드 1개 표시용. null/빈 문자열은 `empty` (기본 '-').
 * 두 번째 인자는 빈값 문자열 또는 `{ empty, fieldType }`.
 */
export function formatDetailScalarValue(
  raw: unknown,
  emptyOrOptions: string | FormatDetailScalarOptions = '-',
): string {
  const opts: FormatDetailScalarOptions =
    typeof emptyOrOptions === 'string' ? { empty: emptyOrOptions } : emptyOrOptions ?? {};
  const empty = opts.empty ?? '-';
  const typeNorm =
    opts.fieldType != null && String(opts.fieldType).trim() !== ''
      ? normalizeDefineFieldType(opts.fieldType)
      : '';

  if (raw === null || raw === undefined) return empty;
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  if (typeof raw === 'bigint') return raw.toString();
  if (typeof raw === 'object') {
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }

  // 자료형 NUMBER — 천단위 콤마
  if (typeNorm === 'NUMBER') {
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) return String(raw);
      return formatFiniteNumberKoTrimZeros(raw);
    }
    const s = String(raw).trim();
    if (s === '') return empty;
    return tryFormatAsNumberString(s, false) ?? s;
  }

  // 자료형 DATE — 날짜 우선, 콤마 없음
  if (typeNorm === 'DATE') {
    const s = String(raw).trim();
    if (s === '') return empty;
    return tryFormatToYmd(s) ?? s;
  }

  // 그 외 명시 자료형(TEXT/CODE/BOOLEAN/GEOMETRY 등) — 콤마 금지
  if (typeNorm) {
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) return String(raw);
      return String(raw);
    }
    const s = String(raw).trim();
    if (s === '') return empty;
    if (typeNorm === 'BOOLEAN') return s;
    const ymd = tryFormatToYmd(s);
    if (ymd) return ymd;
    return s;
  }

  // 자료형 없음 — 기존 휴리스틱
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return String(raw);
    return formatFiniteNumberKoTrimZeros(raw);
  }
  const s = String(raw).trim();
  if (s === '') return empty;
  const ymd = tryFormatToYmd(s);
  if (ymd) return ymd;
  return tryFormatAsNumberString(s, true) ?? s;
}
