/** 하수행정 업무 메뉴 — 관망조회 */

export const SWL_ADMIN_EMPTY_SER_ENGS = ['swlNetworkMap'] as const

export type SwlAdminEmptySerEng = (typeof SWL_ADMIN_EMPTY_SER_ENGS)[number]

export function isSwlAdminEmptySerEng(serEng: string): serEng is SwlAdminEmptySerEng {
  return (SWL_ADMIN_EMPTY_SER_ENGS as readonly string[]).includes(serEng)
}

export function isSwlAdminEmptyOpenedToken(token: string): boolean {
  return isSwlAdminEmptySerEng(String(token ?? '').trim())
}

export function findOpenedSwlAdminEmptySerEng(
  openedTokens: string[]
): SwlAdminEmptySerEng | null {
  for (const t of openedTokens) {
    const s = String(t ?? '').trim()
    if (isSwlAdminEmptySerEng(s)) return s
  }
  return null
}
