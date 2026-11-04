/** 시설물구분 묶음 — 상하수도(water)·도로(road)·건축물(public). 시스템(하천·도로·건설) 거르기에 씀 */
export type FmsFacilGroup = 'water' | 'road' | 'public';

/** 시설물구분 코드·한글 → 묶음. 상세제원 식별자는 쓰지 않음 */
const FACIL_GBN_ROUTE: ReadonlyArray<{ group: FmsFacilGroup; tokens: readonly string[] }> = [
  { group: 'road', tokens: ['BR', '교량', 'RW', '옹벽'] },
  { group: 'water', tokens: ['WS', '상하수도'] },
  { group: 'public', tokens: ['AR', '건축물'] },
];

const TOKEN_TO_GROUP: Record<string, FmsFacilGroup> = (() => {
  const map: Record<string, FmsFacilGroup> = {};
  for (const row of FACIL_GBN_ROUTE) {
    for (const token of row.tokens) {
      map[normalizeFacilGbn(token)] = row.group;
    }
  }
  return map;
})();

function normalizeFacilGbn(raw: string): string {
  const gbn = raw.trim();
  if (/^[A-Za-z]{2}$/.test(gbn)) return gbn.toUpperCase();
  return gbn;
}

/** facil_gbn → 묶음 (코드 BR/RW/WS/AR 와 한글 모두) */
export function facilGroupForFacilGbn(facilGbn: string | null | undefined): FmsFacilGroup | null {
  const gbn = String(facilGbn ?? '').trim();
  if (!gbn) return null;
  return TOKEN_TO_GROUP[normalizeFacilGbn(gbn)] ?? null;
}

export function facilGbnTokensForGroup(group: FmsFacilGroup): readonly string[] {
  return FACIL_GBN_ROUTE.find((r) => r.group === group)?.tokens ?? [];
}
