import type { WtlOutageGate } from './outage/wtlOutageSample'

/** 누수분석 → 단수구역 이어가기 시드 */
export type WtlOutageHandoffSeed = {
  seq: number
  gates: WtlOutageGate[]
  label?: string
}
