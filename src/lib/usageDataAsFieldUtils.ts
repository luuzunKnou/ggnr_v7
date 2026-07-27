import { formatFiniteNumberKoTrimZeros } from "@/lib/formatDetailScalar";
import { formatToYmdOrText, tryFormatToYmd } from "@/lib/formatDateYmd";

export const USAGE_PD_FIELD = "usage_pd";
export const USAGE_AREA_FIELDS = new Set(["perm_area"]);

export function splitUsagePeriod(raw: string): { start: string; end: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { start: "", end: "" };

  // ISO 날짜(YYYY-MM-DD)의 하이픈과 구분 — 범위 구분자(~, ～, –, —)만 사용
  const rangeMatch = s.match(/^(.+?)\s*[~～–—]\s*(.+)$/);
  if (rangeMatch) {
    return {
      start: formatToYmdOrText(rangeMatch[1].trim()),
      end: formatToYmdOrText(rangeMatch[2].trim()),
    };
  }

  return { start: formatToYmdOrText(s), end: "" };
}

export function joinUsagePeriod(start: string, end: string): string {
  const s = tryFormatToYmd(String(start ?? "").trim()) ?? String(start ?? "").trim();
  const e = tryFormatToYmd(String(end ?? "").trim()) ?? String(end ?? "").trim();
  if (s && e) return `${s}~${e}`;
  if (s) return s;
  if (e) return e;
  return "";
}

export function formatUsagePeriodDisplay(raw: string): string {
  const { start, end } = splitUsagePeriod(raw);
  if (start && end) return `${start} ~ ${end}`;
  if (start) return start;
  if (end) return end;
  return "—";
}

export function sanitizeNumericInput(raw: string): string {
  let s = String(raw ?? "")
    .replace(/\s*[m㎡][²2]?\s*$/gi, "")
    .replace(/,/g, "")
    .replace(/[^\d.]/g, "");
  const dot = s.indexOf(".");
  if (dot >= 0) {
    s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "");
  }
  return s;
}

export function formatAreaDisplay(raw: string): string {
  const s = sanitizeNumericInput(raw);
  if (!s) return "—";
  const n = Number(s);
  if (Number.isFinite(n)) {
    return `${formatFiniteNumberKoTrimZeros(n)} m²`;
  }
  return `${s} m²`;
}

export function toDateInputValue(raw: string): string {
  return tryFormatToYmd(raw) ?? "";
}
