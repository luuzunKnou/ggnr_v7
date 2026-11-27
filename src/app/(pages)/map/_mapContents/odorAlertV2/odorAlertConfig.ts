/** 하수악취 V2 경보 보기 — V1과 opened/ser_eng 분리 */

export const ODOR_ALERT_V2_OPENED_KEY = 'odorAlertV2'
export const ODOR_ALERT_V2_SER_ENG = 'odorAlertV2'

export const ODOR_ALERT_OPENED_KEY = ODOR_ALERT_V2_OPENED_KEY
export const ODOR_ALERT_SER_ENG = ODOR_ALERT_V2_SER_ENG

export const ODOR_ALERT_PANEL_DEFAULT_WIDTH = 380
export const ODOR_ALERT_PANEL_MIN_WIDTH = 320
export const ODOR_ALERT_PANEL_MAX_WIDTH = 520

/** P21-02: 미확인 / 미정상 / 전체 */
export type OdorAlertViewTab = 'unacked' | 'unrecovered' | 'all'
/** P21-03: 등급 */
export type OdorAlertGradeFilter = 'all' | 'caution' | 'serious'
/** P21-09: 악취 / 장애 */
export type OdorAlertKindFilter = 'all' | 'odor' | 'fault'
export type OdorAlertKind = 'odor' | 'fault'
export type OdorAlertGrade = 3 | 4 | 5
export type OdorAckMode = 'single' | 'bulk'
export type OdorAlertAgencyFilter = 'all' | string

export const ODOR_ALERT_KIND_LABEL: Record<OdorAlertKind, string> = {
  odor: '악취',
  fault: '장애',
}

export const ODOR_ALERT_GRADE_LABEL: Record<OdorAlertGrade, string> = {
  3: '주의(3)',
  4: '심각(4)',
  5: '심각(5)',
}

/** @deprecated 구 패널 호환 — 신규 UI는 Tailwind 사용 */
export const odorAlertBtnPrimary =
  'inline-flex h-7 cursor-pointer items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50'
export const odorAlertBtnGhost =
  'inline-flex h-7 cursor-pointer items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50'
export const odorAlertFieldClass =
  'h-7 w-full min-w-0 rounded border border-border bg-background px-1.5 text-[11px] outline-none focus:border-primary focus:ring-1 focus:ring-primary/25'
