/** GNMS 버전 목록 항목 → select/이력에 쓰는 표시 문구 */

/** 구동 type=dev 일 때 적용 버전 «현재»·이력 문구 */
export const APPLIED_VERSION_DEV_LABEL = '개발 버전입니다.';

export function isAppliedVersionDevLabel(value?: string | null): boolean {
  return (value ?? '').trim() === APPLIED_VERSION_DEV_LABEL;
}

export type GnmsVersionLabelEntry = {
  folder: string;
  date: string;
  changeNote?: string | null;
  createdAt?: string;
  isLatest?: boolean;
};

/** select·이력 본문: `날짜 | 변경메모`(없으면 folder) */
export function versionOptionBase(entry: GnmsVersionLabelEntry): string {
  const note = (entry.changeNote ?? '').trim() || entry.folder;
  return `${entry.date} | ${note}`;
}

export function entryMatchesApplied(
  entry: GnmsVersionLabelEntry,
  applied: string | null | undefined
): boolean {
  if (!applied?.trim()) return false;
  /** 구동 type=dev 표시 문구 — 특정 GNMS 폴더에 ✓ 붙이지 않음 */
  if (isAppliedVersionDevLabel(applied)) return false;
  const a = applied.trim();
  if (entry.folder === a) return true;
  if (entry.createdAt && entry.createdAt === a) return true;
  return versionOptionBase(entry) === a;
}

/** 「현재:」용 — 목록 매칭 시 option 본문(+최신), 아니면 raw */
export function resolveAppliedDisplay(
  applied: string | null | undefined,
  entries: GnmsVersionLabelEntry[]
): string {
  const raw = applied?.trim() ?? '';
  if (!raw) return '';
  if (isAppliedVersionDevLabel(raw)) return raw;
  const hit = entries.find((e) => entryMatchesApplied(e, raw));
  if (!hit) return raw;
  const base = versionOptionBase(hit);
  return hit.isLatest ? `${base} (최신)` : base;
}

export function versionOptionLabel(
  entry: GnmsVersionLabelEntry,
  appliedVersion: string | null | undefined
): string {
  const base = versionOptionBase(entry);
  const latest = entry.isLatest ? ' (최신)' : '';
  const applied = entryMatchesApplied(entry, appliedVersion) ? ' ✓' : '';
  return `${base}${latest}${applied}`;
}
