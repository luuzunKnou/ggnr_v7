/** 하수악취 대시보드2 — 메뉴·opened 키 (플로팅 UI 작업본) */

export const ODOR_DASHBOARD2_OPENED_KEY = 'odorDashboard2'
export const ODOR_DASHBOARD2_SER_ENG = 'odorDashboard2'

/** 대시보드 UI 모드 (관망조회 도구 UI select와 동일 패턴) */
export type OdorDashboard2UiMode = 'legacy' | 'floating'

export const ODOR_DASHBOARD2_UI_MODE_STORAGE_KEY = 'odor-dashboard2-ui-mode'

export const ODOR_DASHBOARD2_UI_MODE_OPTIONS: {
  value: OdorDashboard2UiMode
  label: string
}[] = [
  { value: 'legacy', label: '풀패널 UI' },
  { value: 'floating', label: '플로팅 UI' },
]

/** 플로팅 UI — 좌측 통계 폭 */
export const ODOR_DASHBOARD2_FLOAT_STATS_WIDTH = 340
/** 플로팅 UI — 우측 경보 폭 */
export const ODOR_DASHBOARD2_FLOAT_ALERT_WIDTH = 360
/** 우측 맵 컨트롤: right-4(16) + 메뉴 45 + 간격 12 */
export const ODOR_DASHBOARD2_FLOAT_RIGHT_INSET = 16 + 45 + 12
/** 좌측 패널과 상세 모달 간격 */
export const ODOR_DASHBOARD2_DETAIL_LEFT_GAP = 8

export const ODOR_DASHBOARD2_STATION_PAGE_SIZE = 12

export const ODOR_GRADE_POINT_FILL = {
  normal: '#22c55e',
  caution: '#f97316',
  warning: '#ef4444',
} as const
