/** 누수분석 타입·이력 유틸 (세션 전용) */

export type WtlLeakSnap = {
  x: number
  y: number
  lon: number
  lat: number
  pipeId: number
  distance: number
}

export type WtlLeakGate = {
  id: string
  name: string
  diameter: string
  address: string
  point: [number, number]
}

export type WtlLeakResult = {
  snap: WtlLeakSnap
  gates: WtlLeakGate[]
  pipes: [number, number][][]
}

export type WtlLeakHistory = {
  id: string
  at: string
  label: string
  gateCount: number
  result: WtlLeakResult
}

export function buildLeakHistory(result: WtlLeakResult): WtlLeakHistory {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const at = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  return {
    id: `leak-${Date.now()}`,
    at,
    label: `관로 #${result.snap.pipeId}`,
    gateCount: result.gates.length,
    result,
  }
}
