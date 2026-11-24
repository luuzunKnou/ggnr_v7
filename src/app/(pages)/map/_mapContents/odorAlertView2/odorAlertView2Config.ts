/** 하수악취 경보목록2 — standard 표 UI + P21(odorAlertStore) */

export const ODOR_ALERT_VIEW2_OPENED_KEY = 'odorAlertView2'
export const ODOR_ALERT_VIEW2_SER_ENG = 'odorAlertView2'

/** UI 모드 (대시보드2와 동일 패턴) */
export type OdorAlertView2UiMode = 'legacy' | 'floating'

export const ODOR_ALERT_VIEW2_UI_MODE_STORAGE_KEY = 'odor-alert-view2-ui-mode'

export const ODOR_ALERT_VIEW2_UI_MODE_OPTIONS: {
  value: OdorAlertView2UiMode
  label: string
}[] = [
  { value: 'legacy', label: '풀패널 UI' },
  { value: 'floating', label: '플로팅 UI' },
]

/** 체크·해제 열 + 발생시각·저감 설비·확인 여부 제목이 잘리지 않는 폭 */
export const ODOR_ALERT_VIEW2_LIST_DEFAULT_WIDTH = 600
export const ODOR_ALERT_VIEW2_LIST_MIN_WIDTH = 560
export const ODOR_ALERT_VIEW2_LIST_MAX_WIDTH = 800

/** 플로팅 UI — 목록 폭 */
export const ODOR_ALERT_VIEW2_FLOAT_WIDTH = 560
export const ODOR_ALERT_VIEW2_FLOAT_MIN_WIDTH = 560
export const ODOR_ALERT_VIEW2_FLOAT_MAX_WIDTH = 800
/** 플로팅 UI — 해제 이력 패널 폭 */
export const ODOR_ALERT_VIEW2_FLOAT_HISTORY_WIDTH = 360
/** 플로팅 UI — 목록↔이력 간격 */
export const ODOR_ALERT_VIEW2_FLOAT_HISTORY_GAP = 8
/** 플로팅 UI — 좌측 inset */
export const ODOR_ALERT_VIEW2_FLOAT_LEFT_INSET = 20

/** 상세 모달 — 리스트 패널~우측 맵 메뉴 사이 */
export const ODOR_ALERT_VIEW2_DETAIL_GAP = 8
export const ODOR_ALERT_VIEW2_DETAIL_BOTTOM = 12
/** 상세 모달 펼침 높이 (OdorAlertDetailBottomSheet h-[48vh] 과 동일) */
export const ODOR_ALERT_VIEW2_DETAIL_HEIGHT_VH = 48
/** 플로팅 해제 이력 — 상세 모달 위 간격 */
export const ODOR_ALERT_VIEW2_FLOAT_HISTORY_DETAIL_GAP = 8
/** 플로팅 목록·이력 — top offset */
export const ODOR_ALERT_VIEW2_FLOAT_TOP = 60
