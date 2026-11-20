/** 송수경로 타입 */

export type WtlSupplySourceKind = '정수장' | '배수지'

export type WtlSupplySource = {
  id: string
  kind: WtlSupplySourceKind
  name: string
  point: [number, number]
  /** 면 시설의 외곽 도형(GeoJSON, EPSG:4326) */
  outline?: { type: string; coordinates: unknown }
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
  /** pipes[i]의 상류 관로 인덱스(시드는 null) — 순차 재생용 */
  parentIndex?: (number | null)[]
  /** pipes[i]의 관경(mm). 없으면 null — 본관·가지 굵기 구분용 */
  pipeDiameters?: (number | null)[]
  /** 이 경로로 닿는 배수지 (수정 버전) */
  destinations?: WtlSupplySource[]
  /** 지정된 도착 배수지 id */
  destinationId?: string | null
}

export const WTL_SUPPLY_KINDS: WtlSupplySourceKind[] = ['정수장', '배수지']
