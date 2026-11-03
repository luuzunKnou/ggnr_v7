/** serviceList.ser_eng / systemList 메뉴 키와 동일 */
export const DEVELOPMENT_CHARGE_OPENED_KEY = 'developmentCharge'

export const DEVELOPMENT_CHARGE_PANEL_DEFAULT_WIDTH = 520
export const DEVELOPMENT_CHARGE_PANEL_MIN_WIDTH = 420
export const DEVELOPMENT_CHARGE_PANEL_MAX_WIDTH = 760
export const DEVELOPMENT_CHARGE_DETAIL_DEFAULT_WIDTH = 360
export const DEVELOPMENT_CHARGE_DETAIL_MIN_WIDTH = 300
export const DEVELOPMENT_CHARGE_DETAIL_MAX_WIDTH = 520

export type DevelopmentChargeStatus =
  | 'target'
  | 'assessed'
  | 'paid'
  | 'exempt'
  | 'reduced'

export type DevelopmentChargeStatusDef = {
  code: DevelopmentChargeStatus
  label: string
  color: string
}

export const DEVELOPMENT_CHARGE_STATUSES: DevelopmentChargeStatusDef[] = [
  { code: 'target', label: '부과대상', color: '#f59e0b' },
  { code: 'assessed', label: '부과완료', color: '#0ea5e9' },
  { code: 'paid', label: '납부완료', color: '#16a34a' },
  { code: 'exempt', label: '면제', color: '#64748b' },
  { code: 'reduced', label: '감면', color: '#8b5cf6' },
]

export function getDevelopmentChargeStatus(
  code: DevelopmentChargeStatus
): DevelopmentChargeStatusDef {
  return (
    DEVELOPMENT_CHARGE_STATUSES.find((s) => s.code === code) ??
    DEVELOPMENT_CHARGE_STATUSES[0]!
  )
}
