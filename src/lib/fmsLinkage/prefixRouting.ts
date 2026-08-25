type FmsPrefix = 'water' | 'road' | 'public';

/** 시설물구분 코드·한글 → layer 접두. 상세제원 식별자는 쓰지 않음 */
const FACIL_GBN_ROUTE: ReadonlyArray<{ prefix: FmsPrefix; tokens: readonly string[] }> = [
  { prefix: 'road', tokens: ['BR', '교량', 'RW', '옹벽'] },
  { prefix: 'water', tokens: ['WS', '상하수도'] },
  { prefix: 'public', tokens: ['AR', '건축물'] },
];

const TOKEN_TO_PREFIX: Record<string, FmsPrefix> = (() => {
  const map: Record<string, FmsPrefix> = {};
  for (const row of FACIL_GBN_ROUTE) {
    for (const token of row.tokens) {
      map[normalizeFacilGbn(token)] = row.prefix;
    }
  }
  return map;
})();

function normalizeFacilGbn(raw: string): string {
  const gbn = raw.trim();
  if (/^[A-Za-z]{2}$/.test(gbn)) return gbn.toUpperCase();
  return gbn;
}

/** facil_gbn → layer 접두 (코드 BR/RW/WS/AR 와 한글 모두) */
export function prefixForFacilGbn(facilGbn: string | null | undefined): FmsPrefix | null {
  const gbn = String(facilGbn ?? '').trim();
  if (!gbn) return null;
  return TOKEN_TO_PREFIX[normalizeFacilGbn(gbn)] ?? null;
}

export function facilGbnTokensForPrefix(prefix: FmsPrefix): readonly string[] {
  return FACIL_GBN_ROUTE.find((r) => r.prefix === prefix)?.tokens ?? [];
}
