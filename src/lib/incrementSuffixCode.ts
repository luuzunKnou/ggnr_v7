/** JY_000519 → JY_000520 — 끝 숫자 접미사 +1 (자릿수 유지) */
export function incrementSuffixCode(code: string): string {
  const s = String(code ?? "").trim();
  const m = s.match(/^(.*?)(\d+)$/);
  if (!m) return s;
  const prefix = m[1] ?? "";
  const numStr = m[2] ?? "";
  if (!numStr) return s;
  try {
    const next = BigInt(numStr) + 1n;
    return `${prefix}${String(next).padStart(numStr.length, "0")}`;
  } catch {
    const next = Number(numStr) + 1;
    if (!Number.isFinite(next)) return s;
    return `${prefix}${String(next).padStart(numStr.length, "0")}`;
  }
}

export const DEFAULT_USAGE_DATA_AS_CONS_CODE = "JY_000001";

/** GS_000001 — 공사대장(cons_data_as) 신규 키 기본값 */
export const DEFAULT_CONS_DATA_AS_CONS_CODE = "GS_000001";
