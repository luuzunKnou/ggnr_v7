import { isMatchCloseOpenedToken } from './layerClickDetailMatchClose'

/**
 * 자체 지도 클릭→모달/패널/점찍기가 있는 opened 토큰.
 * 열려 있으면 전역 레이어 클릭 상세 플로팅을 열지 않는다.
 * 단 관망·시설·설비(키일치닫기)는 소유 레이어가 아닌 클릭에 한해 전역 모달 허용.
 */
export const LAYER_CLICK_DETAIL_BLOCKED_OPENED = [
  // 상·하수행정
  'wtlNetworkMap',
  'wtlFacility',
  'wtlEquipment',
  // 공간분석은 관로·제수변·계량기 속성조회 허용 (차단하지 않음)
  // 상·하수 공사대장 opened 키(consLedgerVariant) — 기존 플로팅은 유지, 신규만 막음
  'constructionLedger',
  'sewerConstructionLedger',
  'wtlConstructionLedger',
  'swlNetworkMap',
  'wtlComplaint',
  'wtlMemo',
  'splyComplaint',
  'splyMemo',
  'swlComplaint',
  'swlMemo',
  'dreComplaint',
  'dreMemo',
  // 민원·메모(공통)
  'complaintManagement',
  'memoManagement',
  // 하수악취
  'odorDashboard',
  'odorControlMap',
  'odorAlert',
  'odorAlertView2',
  'odorComplaint',
  // 도로·하천 — identify 가로채기 패널
  'riverBasicPlan',
  'roadLedger',
  'roadNetwork',
  'roadFrontageBuilding',
  'roadFrontageMarker',
  'riverIllegalOccupation',
  'usageDataAs',
  'roadCCTV',
  'roadReward',
  'roadFMS',
  // 안전
  'safetyFac',
  'safetyWater',
  'waterPlaySign',
  'radiationShelter',
  // 토지·공공·기타 클릭 UI
  'underWaterUse',
  'landArchive',
  'cadastralResurvey',
  'individualLandPrice',
  'developmentCharge',
  'privateLandAnalysis',
  'parcelAnalysis',
  'rdcSmallPublicFac',
  'smallPublicCandidate',
  'smallPublicInspection',
  'gcp',
] as const

/** 점용·사용료 등 ser_eng 접두 — opened 토큰 시작 문자열 */
const LAYER_CLICK_DETAIL_BLOCKED_PREFIXES = [
  'occupationLedger',
  'roadNglFeeList',
  'riverNglFeeList',
] as const

export function isLayerClickDetailBlockedOpened(
  openedTokens: readonly string[]
): boolean {
  const tokens = openedTokens.map((t) => String(t ?? '').trim()).filter(Boolean)
  const set = new Set(tokens)
  for (const key of LAYER_CLICK_DETAIL_BLOCKED_OPENED) {
    if (set.has(key)) return true
  }
  for (const token of tokens) {
    for (const prefix of LAYER_CLICK_DETAIL_BLOCKED_PREFIXES) {
      if (token === prefix || token.startsWith(prefix)) return true
    }
  }
  return false
}

/** identify intake가 패널 플래그로 가로채는 업무 — 레이어 미스 시에도 전역 플로팅 금지 */
export function isLayerClickDetailBlockedByPanelFlags(flags: {
  riverBasicPlanPanelOpen?: boolean
  usageDataAsPanelOpen?: boolean
  roadNetworkPanelOpen?: boolean
  riverIllegalOccupationPanelOpen?: boolean
  roadFrontageBuildingPanelOpen?: boolean
  roadFrontageMarkerPanelOpen?: boolean
  occupationLedgerPanelOpen?: boolean
  useFeePanelOpen?: boolean
  roadLedgerPanelOpen?: boolean
  fmsLinkagePanelOpen?: boolean
}): boolean {
  return Boolean(
    flags.riverBasicPlanPanelOpen ||
      flags.usageDataAsPanelOpen ||
      flags.roadNetworkPanelOpen ||
      flags.riverIllegalOccupationPanelOpen ||
      flags.roadFrontageBuildingPanelOpen ||
      flags.roadFrontageMarkerPanelOpen ||
      flags.occupationLedgerPanelOpen ||
      flags.useFeePanelOpen ||
      flags.roadLedgerPanelOpen ||
      flags.fmsLinkagePanelOpen
  )
}

/** BLOCKED 중 키일치닫기(관망·시설·설비)가 아닌 토큰/접두가 있으면 전역 모달 전면 차단 */
export function hasNonMatchCloseBlockedOpened(
  openedTokens: readonly string[]
): boolean {
  const tokens = openedTokens.map((t) => String(t ?? '').trim()).filter(Boolean)
  const set = new Set(tokens)
  for (const key of LAYER_CLICK_DETAIL_BLOCKED_OPENED) {
    if (!set.has(key)) continue
    if (!isMatchCloseOpenedToken(key)) return true
  }
  for (const token of tokens) {
    for (const prefix of LAYER_CLICK_DETAIL_BLOCKED_PREFIXES) {
      if (token === prefix || token.startsWith(prefix)) return true
    }
  }
  return false
}
