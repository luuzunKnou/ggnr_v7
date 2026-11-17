/** 하수악취 경보 보기 — 메뉴·필터·표시용 상수 */

export const ODOR_ALERT_OPENED_KEY = 'odorAlert'
export const ODOR_ALERT_SER_ENG = 'odorAlert'

export type OdorAlertKind = 'odor' | 'fault'
export type OdorAlertGrade = 3 | 4 | 5
export type OdorAlertViewTab = 'all' | 'unacked' | 'unrecovered'
export type OdorAlertGradeFilter = 'all' | 'caution' | 'serious'
export type OdorAlertKindFilter = 'all' | 'odor' | 'fault'
/** 'all' 또는 목업 agency(업체)명 */
export type OdorAlertAgencyFilter = 'all' | string
export type OdorAckMode = 'single' | 'bulk'

export const ODOR_ALERT_KIND_LABEL: Record<OdorAlertKind, string> = {
  odor: '악취',
  fault: '장애',
}

export const ODOR_ALERT_GRADE_LABEL: Record<OdorAlertGrade, string> = {
  3: '주의(3)',
  4: '심각(4)',
  5: '심각(5)',
}

export const odorAlertBtnPrimary =
  'inline-flex h-7 cursor-pointer items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50'
export const odorAlertBtnGhost =
  'inline-flex h-7 cursor-pointer items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50'
export const odorAlertFieldClass =
  'h-7 w-full min-w-0 rounded border border-border bg-background px-1.5 text-[11px] outline-none focus:border-primary focus:ring-1 focus:ring-primary/25'
