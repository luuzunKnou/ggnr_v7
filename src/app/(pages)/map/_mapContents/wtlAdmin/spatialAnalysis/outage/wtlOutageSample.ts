/** 단수구역 타입·이력 유틸 (세션 전용) */

export type WtlOutageStatus =
  | '분석완료'
  | '설정완료'
  | '문자발송 완료'
  | '단수중'
  | '종료'

export const WTL_OUTAGE_STATUS_ORDER: WtlOutageStatus[] = [
  '분석완료',
  '설정완료',
  '문자발송 완료',
  '단수중',
  '종료',
]

export function nextOutageStatus(status: WtlOutageStatus): WtlOutageStatus | null {
  const index = WTL_OUTAGE_STATUS_ORDER.indexOf(status)
  if (index < 0 || index >= WTL_OUTAGE_STATUS_ORDER.length - 1) return null
  return WTL_OUTAGE_STATUS_ORDER[index + 1] ?? null
}

export type WtlOutageGate = {
  id: string
  name: string
  diameter: string
  address: string
  point: [number, number]
}

export type WtlOutageParcel = {
  id: string
  jibun: string
  jimok: string
  area: string
  /** 필지 중심 [lon, lat] */
  point?: [number, number]
}

export type WtlOutageAddress = {
  id: string
  /** 도로명 */
  road: string
  /** 지번 */
  jibun: string
  /** 수용가번호 */
  customerNo: string
  /** 대표 위치 [lon, lat] */
  point?: [number, number]
  /** 대표 급수전 ogc_fid */
  ogcFid?: number
}

export type WtlOutageCustomer = {
  id: string
  name: string
  address: string
  phone: string
  meterNo: string
  /** 수용가 위치 [lon, lat] */
  point?: [number, number]
  /** wtl_meta_ps ogc_fid */
  ogcFid?: number
}

export type WtlOutageResult = {
  gateId: string
  ring: [number, number][]
  /** 잠금이 여러 개일 때 모든 단수 면 */
  rings?: [number, number][][]
  /** 단수 면(구멍 포함): [바깥 고리, ...구멍]. 있으면 rings보다 우선 */
  polygons?: [number, number][][][]
  pipes: [number, number][][]
  parcels: WtlOutageParcel[]
  addresses: WtlOutageAddress[]
  customers: WtlOutageCustomer[]
  /** 관로 주변 버퍼(m). 없으면 기본 28 */
  bufferM?: number
  /** pipes와 같은 순서의 선별 버퍼(m). 지도 외곽선 편집 시 생김 */
  lineBuffers?: number[]
  /** 초기 면 생성 기준: 계량기(meter) 또는 관로 버퍼(pipe) */
  zoneBasis?: 'meter' | 'pipe'
  /** 계량기 기준일 때 단수 대상 계량기 수 */
  meterCount?: number
  /** 계량기가 속하거나 인접한 건물군 면(4326) — 편집 재계산 때도 함께 합친다 */
  buildingRings?: [number, number][][]
  /** 건물군에 묶인 계량기 수 */
  buildingMeterCount?: number
  /** 계량기는 없지만 주변에 급수 중인 관로가 없어 단수로 넣은 건물군 수 */
  meterlessBuildingCount?: number
}

export const OUTAGE_ZONE_BUFFER_DEFAULT_M = 28

/** 단수 면(구멍 포함) — polygons가 없으면(이전 결과·읍면동리) 바깥 고리만으로 */
export function outagePolygonsOf(
  result: Pick<WtlOutageResult, 'polygons' | 'rings' | 'ring'> | null | undefined
): [number, number][][][] {
  if (!result) return []
  if (result.polygons && result.polygons.length > 0) {
    return result.polygons.filter((p) => (p[0]?.length ?? 0) >= 3)
  }
  const rings = result.rings && result.rings.length > 0 ? result.rings : [result.ring]
  return rings.filter((r) => r.length >= 3).map((r) => [r])
}

export type WtlOutageHistory = {
  id: string
  at: string
  gateId: string
  gateName: string
  reason: string
  startAt: string
  endAt: string
  status: WtlOutageStatus
  householdCount: number
  result: WtlOutageResult
  /** 저장 계정(로그인 세션 id). 표시는 createUserName 우선 */
  createUser: string
  /** 저장 시점 표시명(이름 없으면 계정) */
  createUserName: string
  smsTitle?: string
  smsBody?: string
}

export function parseOutageGateIds(gateId: string): string[] {
  return gateId
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

export function buildOutageHistory(
  gates: WtlOutageGate[],
  result: WtlOutageResult,
  author?: { userId?: string | null; userName?: string | null }
): WtlOutageHistory {
  const withPhone = result.customers.filter((c) => c.phone.trim()).length
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const at = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  const createUser = String(author?.userId ?? '').trim()
  const createUserName =
    String(author?.userName ?? '').trim() || createUser
  return {
    id: `hist-${Date.now()}`,
    at,
    gateId: gates.map((gate) => gate.id).join(','),
    gateName: gates.map((gate) => gate.name).join(', '),
    reason: '',
    startAt: '',
    endAt: '',
    status: '분석완료',
    householdCount: withPhone || result.customers.length,
    result,
    createUser,
    createUserName,
  }
}
