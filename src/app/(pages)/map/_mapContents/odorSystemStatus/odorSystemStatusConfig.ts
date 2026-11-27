import '@/app/(pages)/map/_mapComponents/config/projections'
import { transform } from 'ol/proj'

/** 하수악취 시스템 상태•통신 — 지도 사이드 패널 */

export const ODOR_SYSTEM_STATUS_OPENED_KEY = 'odorSystemStatus'
export const ODOR_SYSTEM_STATUS_SER_ENG = 'odorSystemStatus'

/** 죽도 빗물펌프장 — TM/TC Master·IoT·DB·AP 공통 위치 (EPSG:5181) */
export const ODOR_SYSTEM_STATUS_INFRA_SITE_5181: [number, number] = [
  412793.64145774033, 284068.83669865783,
]

/** 죽도 빗물펌프장 WGS84 */
export const ODOR_SYSTEM_STATUS_INFRA_SITE_LONLAT = transform(
  ODOR_SYSTEM_STATUS_INFRA_SITE_5181,
  'EPSG:5181',
  'EPSG:4326'
) as [number, number]

/** 동일 좌표 마커가 겹치지 않도록 미터 오프셋 */
export const ODOR_SYSTEM_STATUS_INFRA_MARKERS: ReadonlyArray<{
  nodeId: string
  label: string
  offsetX: number
  offsetY: number
}> = [
  { nodeId: 'comm-master', label: 'TM/TC Master', offsetX: 0, offsetY: 0 },
  { nodeId: 'comm-iot', label: 'IoT 서버', offsetX: 18, offsetY: 0 },
  { nodeId: 'comm-db', label: 'DB 서버', offsetX: -18, offsetY: 0 },
  { nodeId: 'comm-ipsec', label: 'AP 서버', offsetX: 0, offsetY: 18 },
]

/** UI 모드 (대시보드2와 동일 패턴) */
export type OdorSystemStatusUiMode = 'legacy' | 'floating'

export const ODOR_SYSTEM_STATUS_UI_MODE_STORAGE_KEY = 'odor-system-status-ui-mode'

export const ODOR_SYSTEM_STATUS_UI_MODE_OPTIONS: {
  value: OdorSystemStatusUiMode
  label: string
}[] = [
  { value: 'legacy', label: '풀패널 UI' },
  { value: 'floating', label: '플로팅 UI' },
]

export const ODOR_SYSTEM_STATUS_DEFAULT_WIDTH = 440
export const ODOR_SYSTEM_STATUS_MIN_WIDTH = 360
export const ODOR_SYSTEM_STATUS_MAX_WIDTH = 640

export const ODOR_SYSTEM_STATUS_EXPAND_DEFAULT_WIDTH = 320
export const ODOR_SYSTEM_STATUS_EXPAND_MIN_WIDTH = 280
export const ODOR_SYSTEM_STATUS_EXPAND_MAX_WIDTH = 420

/** 플로팅 UI */
export const ODOR_SYSTEM_STATUS_FLOAT_WIDTH = 420
export const ODOR_SYSTEM_STATUS_FLOAT_MIN_WIDTH = ODOR_SYSTEM_STATUS_MIN_WIDTH
export const ODOR_SYSTEM_STATUS_FLOAT_MAX_WIDTH = ODOR_SYSTEM_STATUS_MAX_WIDTH
export const ODOR_SYSTEM_STATUS_FLOAT_EXPAND_WIDTH = 320
export const ODOR_SYSTEM_STATUS_FLOAT_LEFT_INSET = 20
export const ODOR_SYSTEM_STATUS_FLOAT_GAP = 8
