/** 하수악취 시스템 상태•통신 — 노드·링크·필터 타입 */

export type OdorCommStatus = 'ok' | 'delayed' | 'disconnect'

export type OdorCommNodeKind =
  | 'ipsec'
  | 'db'
  | 'utm'
  | 'iot'
  | 'master'
  | 'agency'
  | 'gateway'
  | 'sensor'

export type OdorCommStatusFilter = 'all' | 'ok' | 'abnormal'

/** 계통도에 그리는 계층 (센서는 우측 확장만, 게이트웨이 제외) */
export const ODOR_COMM_DIAGRAM_KINDS: ReadonlySet<OdorCommNodeKind> = new Set([
  'ipsec',
  'db',
  'utm',
  'iot',
  'master',
  'agency',
])

export type OdorCommNode = {
  id: string
  kind: OdorCommNodeKind
  label: string
  /** 상위 노드 id (루트는 null) */
  parentId: string | null
  /** 최종 수신 시각 ISO. 인프라 노드는 하위 최악 기준으로 덮어쓸 수 있음 */
  lastRecvAt: string | null
  /** 수집률 0~100 */
  collectRate: number | null
  agency?: string
  gatewayId?: string
  gatewayLabel?: string
  sensorKey?: number
  sensorNm?: string
  stationId?: string
  lon?: number
  lat?: number
  /** 계층별 확장 패널 표시 필드 */
  detail?: OdorCommDetailFields
}

export type OdorCommDetailFields = {
  /** IPsec: Ap 서버 <-> 행정망 */
  peerLine?: string
  /** 서버: 정상 가동 등 */
  runStatus?: string
  /** 이중화(Active-Standby) */
  redundancy?: string
  /** Full TAG · 10분 주기 */
  collectTag?: string
  /** UTM: F/W+IPS+VPN */
  tunnel?: string
  /** 연계 시스템명 */
  linkSystem?: string
  /** 백홈링 LTE-M */
  backhaul?: string
  /** 수용 측정점 문구 */
  acceptPoints?: string
  /** 사설 LoRA 1:7 */
  radioLink?: string
  /** H2S 표시 */
  h2s?: string
  /** 수집율 표시 문구 (예: 87.5%) — 집계값 대신 고정 표시 */
  collectRateText?: string
}

export type OdorCommLink = {
  id: string
  fromId: string
  toId: string
}

export type OdorCommGraph = {
  nodes: OdorCommNode[]
  links: OdorCommLink[]
  /** 판정·표시용 기준 시각 ISO */
  judgedAt: string
}

export type OdorCommNodeView = OdorCommNode & {
  status: OdorCommStatus
  minutesSinceRecv: number | null
}

export const ODOR_COMM_STATUS_LABEL: Record<OdorCommStatus, string> = {
  ok: '정상',
  delayed: '지연',
  disconnect: '두절',
}

export const ODOR_COMM_DELAY_MINUTES = 10
export const ODOR_COMM_DISCONNECT_MINUTES = 30
export const ODOR_COMM_AUTO_REFRESH_MS = 30_000

export const ODOR_COMM_EXPAND_DEFAULT_WIDTH = 320
export const ODOR_COMM_EXPAND_MIN_WIDTH = 280
export const ODOR_COMM_EXPAND_MAX_WIDTH = 420
