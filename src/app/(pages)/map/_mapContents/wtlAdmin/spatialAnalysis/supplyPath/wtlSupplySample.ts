/** 송수경로 타입 */

export type WtlSupplySourceKind = '정수장' | '배수지'

export type WtlSupplySource = {
  id: string
  kind: WtlSupplySourceKind
  name: string
  point: [number, number]
}

export type WtlSupplyGate = {
  id: string
  name: string
  diameter: string
  address: string
  point: [number, number]
}

export type WtlSupplyPathResult = {
  source: WtlSupplySource
  pipes: [number, number][][]
  pipeCount: number
  gates: WtlSupplyGate[]
}

export const WTL_SUPPLY_KINDS: WtlSupplySourceKind[] = ['정수장', '배수지']
