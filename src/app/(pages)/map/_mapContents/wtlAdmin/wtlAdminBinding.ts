/** 상수행정 업무 메뉴 — 빈 화면용 키·제목 */

export const WTL_ADMIN_EMPTY_SER_ENGS = [
  'wtlNetworkMap',
  'wtlConstructionLedger',
  'wtlFacility',
  'wtlEquipment',
  'wtlSpatialAnalysis',
  'wtlWaterSupply',
  'wtlMeterLocation',
] as const

export type WtlAdminEmptySerEng = (typeof WTL_ADMIN_EMPTY_SER_ENGS)[number]
/** Workspace 등에서 쓰는 별칭 */
export type WtlAdminSerEng = WtlAdminEmptySerEng

export type WtlAdminEmptyBinding = {
  serEng: WtlAdminEmptySerEng
  title: string
}

const BINDINGS: Record<WtlAdminEmptySerEng, WtlAdminEmptyBinding> = {
  wtlNetworkMap: {
    serEng: 'wtlNetworkMap',
    title: '관망조회',
  },
  wtlConstructionLedger: {
    serEng: 'wtlConstructionLedger',
    title: '공사대장',
  },
  wtlFacility: {
    serEng: 'wtlFacility',
    title: '시설관리',
  },
  wtlEquipment: {
    serEng: 'wtlEquipment',
    title: '설비관리',
  },
  wtlSpatialAnalysis: {
    serEng: 'wtlSpatialAnalysis',
    title: '공간분석',
  },
  wtlWaterSupply: {
    serEng: 'wtlWaterSupply',
    title: '급수공사',
  },
  wtlMeterLocation: {
    serEng: 'wtlMeterLocation',
    title: '계량기위치',
  },
}

export function isWtlAdminEmptySerEng(serEng: string): serEng is WtlAdminEmptySerEng {
  return (WTL_ADMIN_EMPTY_SER_ENGS as readonly string[]).includes(serEng)
}

export function isWtlAdminEmptyOpenedToken(token: string): boolean {
  return isWtlAdminEmptySerEng(String(token ?? '').trim())
}

export function findOpenedWtlAdminEmptySerEng(
  openedTokens: string[]
): WtlAdminEmptySerEng | null {
  for (const t of openedTokens) {
    const s = String(t ?? '').trim()
    if (isWtlAdminEmptySerEng(s)) return s
  }
  return null
}

export function getWtlAdminEmptyBinding(serEng: WtlAdminEmptySerEng): WtlAdminEmptyBinding {
  return BINDINGS[serEng]
}
