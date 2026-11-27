import {
  ODOR_COMM_DELAY_MINUTES,
  ODOR_COMM_DISCONNECT_MINUTES,
  type OdorCommGraph,
  type OdorCommNodeView,
  type OdorCommStatus,
  type OdorCommStatusFilter,
} from './odorSystemStatusTypes'

export function minutesSince(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((nowMs - t) / 60_000))
}

export function judgeCommStatus(
  lastRecvAt: string | null | undefined,
  nowMs: number
): OdorCommStatus {
  const mins = minutesSince(lastRecvAt, nowMs)
  if (mins == null) return 'disconnect'
  if (mins >= ODOR_COMM_DISCONNECT_MINUTES) return 'disconnect'
  if (mins >= ODOR_COMM_DELAY_MINUTES) return 'delayed'
  return 'ok'
}

const STATUS_RANK: Record<OdorCommStatus, number> = {
  ok: 0,
  delayed: 1,
  disconnect: 2,
}

function worseStatus(a: OdorCommStatus, b: OdorCommStatus): OdorCommStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b
}

/** 센서·업체는 자체 lastRecvAt, 상위 인프라는 자식 최악 상태로 집계 */
export function buildNodeViews(graph: OdorCommGraph): OdorCommNodeView[] {
  const nowMs = new Date(graph.judgedAt).getTime()
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const children = new Map<string, string[]>()
  for (const n of graph.nodes) {
    if (!n.parentId) continue
    const list = children.get(n.parentId) ?? []
    list.push(n.id)
    children.set(n.parentId, list)
  }

  const memo = new Map<string, OdorCommNodeView>()

  function resolve(id: string): OdorCommNodeView {
    const cached = memo.get(id)
    if (cached) return cached
    const node = byId.get(id)
    if (!node) {
      const fallback: OdorCommNodeView = {
        id,
        kind: 'db',
        label: id,
        parentId: null,
        lastRecvAt: null,
        collectRate: null,
        status: 'disconnect',
        minutesSinceRecv: null,
      }
      memo.set(id, fallback)
      return fallback
    }

    const childIds = children.get(id) ?? []
    let status: OdorCommStatus
    let lastRecvAt = node.lastRecvAt
    let minutesSinceRecv = minutesSince(lastRecvAt, nowMs)
    let collectRate = node.collectRate

    const aggregateKinds = new Set([
      'ipsec',
      'db',
      'utm',
      'iot',
      'master',
      'agency',
      'gateway',
    ])
    if (childIds.length > 0 && aggregateKinds.has(node.kind)) {
      const childViews = childIds.map(resolve)
      status = childViews.reduce<OdorCommStatus>(
        (acc, c) => worseStatus(acc, c.status),
        'ok'
      )
      // 상위 표시용: 자식 중 가장 오래된(또는 null) 수신
      let oldest: string | null = null
      let oldestMs = Infinity
      for (const c of childViews) {
        if (!c.lastRecvAt) {
          oldest = null
          oldestMs = -1
          break
        }
        const t = new Date(c.lastRecvAt).getTime()
        if (t < oldestMs) {
          oldestMs = t
          oldest = c.lastRecvAt
        }
      }
      lastRecvAt = oldestMs === -1 ? null : oldest
      minutesSinceRecv = minutesSince(lastRecvAt, nowMs)
      const rates = childViews
        .map((c) => c.collectRate)
        .filter((r): r is number => typeof r === 'number')
      if (rates.length > 0) {
        collectRate = Math.round(rates.reduce((a, b) => a + b, 0) / rates.length)
      }
    } else {
      status = judgeCommStatus(node.lastRecvAt, nowMs)
    }

    const view: OdorCommNodeView = {
      ...node,
      lastRecvAt,
      collectRate,
      status,
      minutesSinceRecv,
    }
    memo.set(id, view)
    return view
  }

  return graph.nodes.map((n) => resolve(n.id))
}

export function filterNodeViews(
  views: OdorCommNodeView[],
  filter: OdorCommStatusFilter
): OdorCommNodeView[] {
  if (filter === 'all') return views
  if (filter === 'ok') return views.filter((v) => v.status === 'ok')
  return views.filter((v) => v.status !== 'ok')
}

/** 필터 시 조상·자손을 유지해 계통 맥락이 끊기지 않게 */
export function expandFilterWithAncestors(
  all: OdorCommNodeView[],
  filtered: OdorCommNodeView[]
): OdorCommNodeView[] {
  if (filtered.length === all.length) return all
  const byId = new Map(all.map((n) => [n.id, n]))
  const keep = new Set(filtered.map((n) => n.id))
  for (const n of filtered) {
    let pid = n.parentId
    while (pid) {
      keep.add(pid)
      pid = byId.get(pid)?.parentId ?? null
    }
  }
  return all.filter((n) => keep.has(n.id))
}

export function formatCommTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}
