/** 하수악취 V2 대시보드 — 메뉴·opened 키 (V1과 분리) */

export const ODOR_DASHBOARD_V2_OPENED_KEY = 'odorDashboardV2'
export const ODOR_DASHBOARD_V2_SER_ENG = 'odorDashboardV2'
export const ODOR_ADMIN_V2_SYSTEM_KEY = 'odorAdminV2'

export const ODOR_DASHBOARD_OPENED_KEY = ODOR_DASHBOARD_V2_OPENED_KEY
export const ODOR_DASHBOARD_SER_ENG = ODOR_DASHBOARD_V2_SER_ENG
export const ODOR_ADMIN_SYSTEM_KEY = ODOR_ADMIN_V2_SYSTEM_KEY

/** odorAdminV2 진입·전환 시 opened 비어 있으면 실시간 통합 현황 V2를 기본으로 */
export function applyOdorAdminDefaultOpened(
  params: URLSearchParams,
  systemKey: string
): void {
  if (systemKey !== ODOR_ADMIN_V2_SYSTEM_KEY) return
  const opened = (params.get('opened') ?? '').split(',').filter(Boolean)
  if (opened.length > 0) return
  params.set('opened', ODOR_DASHBOARD_V2_OPENED_KEY)
}
