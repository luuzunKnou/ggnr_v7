/** 누수분석 타입·이력 유틸 (세션 전용) */

export type WtlLeakSnap = {
  x: number
  y: number
  lon: number
  lat: number
  pipeId: number
  pipeTable?: 'wtl_pipe_lm' | 'wtl_sply_ls'
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
  /** 탐색 한도에 걸려 일부 방향의 제수변을 찾지 못했을 수 있음 */
  truncated?: boolean
  /** 이번 탐색의 한 방향 거리 한도(m). 없으면 기본 1500 */
  searchM?: number
}

/** 탐색 한도(서비스 WTL_LEAK_SEARCH와 맞춤) */
export const LEAK_SEARCH_DEFAULT_M = 1500

export type WtlLeakHistory = {
  id: string
  at: string
  label: string
  gateCount: number
  result: WtlLeakResult
  /** 저장 계정(로그인 세션 id). 표시는 createUserName 우선 */
  createUser: string
  /** 저장 시점 표시명(이름 없으면 계정) */
  createUserName: string
}

export function buildLeakHistory(
  result: WtlLeakResult,
  author?: { userId?: string | null; userName?: string | null }
): WtlLeakHistory {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const at = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  const createUser = String(author?.userId ?? '').trim()
  const createUserName =
    String(author?.userName ?? '').trim() || createUser
  return {
    id: `leak-${Date.now()}`,
    at,
    label: `${result.snap.pipeTable === 'wtl_sply_ls' ? '급수관로' : '관로'} #${result.snap.pipeId}`,
    gateCount: result.gates.length,
    result,
    createUser,
    createUserName,
  }
}

/** 이력 제수변 칸 표시: `3개(1234,5678,9012)` — 없으면 `0개` */
export function leakHistoryGateText(item: WtlLeakHistory): string {
  const names = item.result.gates.map((gate) => gate.name)
  return names.length > 0 ? `${names.length}개(${names.join(',')})` : '0개'
}
