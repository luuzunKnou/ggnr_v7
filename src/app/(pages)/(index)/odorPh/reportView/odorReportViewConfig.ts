/** 하수악취 보고서 조회 — 탭·UI 모드·기간 */

export type OdorReportViewUiMode = 'legacy' | 'floating'

export const ODOR_REPORT_VIEW_UI_MODE_STORAGE_KEY = 'odor-report-view-ui-mode'

export const ODOR_REPORT_VIEW_UI_MODE_OPTIONS: {
  value: OdorReportViewUiMode
  label: string
}[] = [
  { value: 'legacy', label: '패널 UI' },
  { value: 'floating', label: '플로팅 UI' },
]

export type OdorReportTabId =
  | 'abatement'
  | 'alert'
  | 'complaint'
  | 'action'

export const ODOR_REPORT_TABS: {
  id: OdorReportTabId
  label: string
}[] = [
  { id: 'abatement', label: '악취 저감장치 동작 일·월보' },
  { id: 'alert', label: '악취 경보이력 일·월보' },
  { id: 'complaint', label: '악취 민원현황 분석' },
  { id: 'action', label: '조치내역(조치·조사)' },
]

export type OdorReportPeriodMode = 'daily' | 'monthly' | 'range'

export const ODOR_REPORT_PERIOD_OPTIONS: {
  value: OdorReportPeriodMode
  label: string
}[] = [
  { value: 'daily', label: '일보' },
  { value: 'monthly', label: '월보' },
  { value: 'range', label: '기간' },
]

export const ODOR_REPORT_EMD_OPTIONS = [
  { value: 'all', label: '전체 읍면동' },
  { value: '중앙동', label: '중앙동' },
  { value: '동부동', label: '동부동' },
  { value: '서부동', label: '서부동' },
  { value: '남부동', label: '남부동' },
  { value: '북부동', label: '북부동' },
] as const

/** 플로팅 — 좌측(필터·카드) 폭 */
export const ODOR_REPORT_FLOAT_LEFT_WIDTH = 340
/** 플로팅 — 우측(차트·표) 최소 폭 */
export const ODOR_REPORT_FLOAT_RIGHT_MIN = 420
