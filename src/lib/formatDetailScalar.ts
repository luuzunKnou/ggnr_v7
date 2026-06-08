/**
 * 데이터조회·시설 상세 등: 숫자는 소수 끝의 불필요한 0 제거 + ko-KR 천단위, 날짜는 yyyy-mm-dd, 그 외 원문.
 */

import { tryFormatToYmd } from '@/lib/formatDateYmd';

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

/**
 * 상세 필드 1개 표시용. null/빈 문자열은 `empty` (기본 '-').
 */
export function formatDetailScalarValue(raw: unknown, empty = '-'): string {
  if (raw === null || raw === undefined) return empty;
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return String(raw);
    return formatFiniteNumberKoTrimZeros(raw);
  }
  if (typeof raw === 'bigint') return raw.toString();
  if (typeof raw === 'object') {
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }
  const s = String(raw).trim();
  if (s === '') return empty;
  const ymd = tryFormatToYmd(s);
  if (ymd) return ymd;
  if (!isLikelyPlainNumericForDisplay(s)) return s;
  const n = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(n)) return s;
  return formatFiniteNumberKoTrimZeros(n);
}
