/**
 * 표시용 날짜를 yyyy-mm-dd 로 통일 (날짜로 인식될 때만).
 */

const DELIM = String.raw`[/.\-]`;

function pad2(n: number): string {
  return String(Math.trunc(n)).padStart(2, '0');
}

function expandTwoDigitYear(yy: number): number {
  if (!Number.isFinite(yy) || yy < 0 || yy > 99) return NaN;
  return yy <= 49 ? 2000 + yy : 1900 + yy;
}

/** 1/6/23 등: 첫 토큰이 월·일 중 어느 쪽인지 (둘 다 ≤12이면 월/일 US식 가정) */
function resolveMonthDayFromAmbiguousPair(a: number, b: number): { month: number; day: number } | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a < 1 || b < 1) return null;
  if (a > 12 && b > 12) return null;
  if (a > 12 && b <= 12) return { month: b, day: a };
  if (b > 12 && a <= 12) return { month: a, day: b };
  return { month: a, day: b };
}

function ymdFromParts(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || year < 1 || year > 9999) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(year, month - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

/** M/D/Y(또는 D/M/Y), M/D/YY, YY/M/D 등 슬래시·점·하이픈 짧은 표기 */
function tryParseLocaleSlashDate(s: string): string | null {
  const mdy4 = s.match(new RegExp(`^(\\d{1,2})${DELIM}(\\d{1,2})${DELIM}(\\d{4})$`));
  if (mdy4) {
    const a = Number(mdy4[1]);
    const b = Number(mdy4[2]);
    const y = Number(mdy4[3]);
    const md = resolveMonthDayFromAmbiguousPair(a, b);
    if (md) return ymdFromParts(y, md.month, md.day);
  }

  const mdy2 = s.match(new RegExp(`^(\\d{1,2})${DELIM}(\\d{1,2})${DELIM}(\\d{2})$`));
  if (mdy2) {
    const a = Number(mdy2[1]);
    const b = Number(mdy2[2]);
    const yy = Number(mdy2[3]);
    const y = expandTwoDigitYear(yy);
    const md = resolveMonthDayFromAmbiguousPair(a, b);
    if (md && Number.isFinite(y)) return ymdFromParts(y, md.month, md.day);
  }

  const ymdShort = s.match(new RegExp(`^(\\d{2})${DELIM}(\\d{1,2})${DELIM}(\\d{1,2})$`));
  if (ymdShort) {
    const yy = Number(ymdShort[1]);
    const month = Number(ymdShort[2]);
    const day = Number(ymdShort[3]);
    const y = expandTwoDigitYear(yy);
    if (Number.isFinite(y)) return ymdFromParts(y, month, day);
  }

  return null;
}

export function tryFormatToYmd(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(raw).trim();
  if (!s) return null;

  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }

  const isoHead = s.match(/^(\d{4})-(\d{2})-(\d{2})(?=[\sT]|$)/);
  if (isoHead) {
    return `${isoHead[1]}-${isoHead[2]}-${isoHead[3]}`;
  }

  const dashLoose = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?=[\sT]|$)/);
  if (dashLoose) {
    return `${dashLoose[1]}-${dashLoose[2].padStart(2, '0')}-${dashLoose[3].padStart(2, '0')}`;
  }

  const slash = s.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})/);
  if (slash) {
    return `${slash[1]}-${slash[2].padStart(2, '0')}-${slash[3].padStart(2, '0')}`;
  }

  const localeSlash = tryParseLocaleSlashDate(s);
  if (localeSlash) return localeSlash;

  if (s.includes('T')) {
    const head = (s.split('T')[0] ?? '').trim();
    if (head) {
      const fromHead = tryFormatToYmd(head);
      if (fromHead) return fromHead;
    }
  }

  return null;
}

/** yyyy-mm-dd 또는 원문(빈 값은 empty) */
export function formatToYmdOrText(raw: unknown, empty = ''): string {
  const ymd = tryFormatToYmd(raw);
  if (ymd) return ymd;
  const s = String(raw ?? '').trim();
  return s || empty;
}
