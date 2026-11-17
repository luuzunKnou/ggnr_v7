/** 진행방향 구간 파싱·목록명 자동 생성 */

const SPLIT_RE = /\s*(?:→|->|›|>|⇒)\s*/;

/** "A → B → C" → ["A","B","C"] */
export function parseDirectionParts(raw: string): string[] {
  return String(raw ?? "")
    .split(SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** ["A","B","C"] → "A → B → C" */
export function joinDirectionParts(parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join(" → ");
}

/** 목록명 = 진행방향 첫 구간 ~ 끝 구간 */
export function titleFromDirection(rawOrParts: string | string[]): string {
  const parts = Array.isArray(rawOrParts)
    ? rawOrParts.map((p) => p.trim()).filter(Boolean)
    : parseDirectionParts(rawOrParts);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ~ ${parts[parts.length - 1]}`;
}
