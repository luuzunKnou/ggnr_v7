/** 단수구역 타입·이력 유틸 (세션 전용, 저장소 없음) */

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
}

export type WtlOutageAddress = {
  id: string
  road: string
  jibun: string
}

export type WtlOutageCustomer = {
  id: string
  name: string
  address: string
  phone: string
  meterNo: string
}

export type WtlOutageResult = {
  gateId: string
  ring: [number, number][]
  pipes: [number, number][][]
  parcels: WtlOutageParcel[]
  addresses: WtlOutageAddress[]
  customers: WtlOutageCustomer[]
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
  smsTitle?: string
}

export function parseOutageGateIds(gateId: string): string[] {
  return gateId
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

export function buildOutageHistory(gates: WtlOutageGate[], result: WtlOutageResult): WtlOutageHistory {
  const withPhone = result.customers.filter((c) => c.phone.trim()).length
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const at = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
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
  }
}
