/**
 * 단수구역 선 편집용 관망 그래프 (EPSG:3857, m)
 * - 화면 범위 관로를 절점·T자 분기로 이어 그래프를 만들고
 * - 선 끝점에서 커서까지 관로를 따라 최단 경로를 찾는다.
 * 관로 번호(ftr_idn)가 중복돼도 기하로만 잇기 때문에 경로가 꼬이지 않는다.
 */
export type Pt = [number, number]

export function lineLen(line: Pt[]) {
  let total = 0
  for (let i = 1; i < line.length; i += 1) {
    total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])
  }
  return total
}

/** 시작~along(m)까지 자른 선 */
export function sliceTo(coords: Pt[], along: number): Pt[] {
  const out: Pt[] = [coords[0]]
  let walked = 0
  for (let i = 1; i < coords.length; i += 1) {
    const [ax, ay] = coords[i - 1]
    const [bx, by] = coords[i]
    const seg = Math.hypot(bx - ax, by - ay)
    if (walked + seg >= along) {
      const t = seg === 0 ? 0 : (along - walked) / seg
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t])
      return out
    }
    out.push(coords[i])
    walked += seg
  }
  return out
}

/** along(m)~끝까지 */
export function sliceFrom(coords: Pt[], along: number): Pt[] {
  const head = sliceTo(coords, along)
  const cut = head[head.length - 1]
  return [cut, ...coords.slice(head.length - 1)]
}

type Adj = { to: number; w: number; id: number }

export type EditNet = {
  pts: Pt[]
  adj: Adj[][]
  edges: { a: number; b: number }[]
  grid: Map<string, number[]>
}

export type NetProj = { edge: number; t: number; pt: Pt; d: number }

const CELL = 20
/** 관 끝점끼리 같은 절점으로 볼 거리 */
const NODE_MERGE_M = 1.5
/** 관 끝점이 다른 관 선 위에 붙은 T자 분기 인정 거리 */
const TEE_M = 2
/** 경로 탐색 최대 길이 */
const MAX_PATH_M = 3000

function segProject(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const x = a[0] + dx * t
  const y = a[1] + dy * t
  return { t, pt: [x, y] as Pt, d: Math.hypot(p[0] - x, p[1] - y) }
}

function cellsOfSeg(a: Pt, b: Pt): string[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL / 2)))
  const keys = new Set<string>()
  for (let i = 0; i <= n; i += 1) {
    const x = a[0] + ((b[0] - a[0]) * i) / n
    const y = a[1] + ((b[1] - a[1]) * i) / n
    keys.add(`${Math.floor(x / CELL)}_${Math.floor(y / CELL)}`)
  }
  return [...keys]
}

function gridOf(pts: Pt[], segs: { a: number; b: number }[]) {
  const grid = new Map<string, number[]>()
  segs.forEach((s, i) => {
    for (const k of cellsOfSeg(pts[s.a], pts[s.b])) {
      const list = grid.get(k)
      if (list) list.push(i)
      else grid.set(k, [i])
    }
  })
  return grid
}

function nearSegs(grid: Map<string, number[]>, p: Pt, tol: number): Set<number> {
  const r = Math.max(1, Math.ceil(tol / CELL))
  const cx = Math.floor(p[0] / CELL)
  const cy = Math.floor(p[1] / CELL)
  const out = new Set<number>()
  for (let dx = -r; dx <= r; dx += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (const i of grid.get(`${cx + dx}_${cy + dy}`) ?? []) out.add(i)
    }
  }
  return out
}

export function buildEditNet(lines: Pt[][]): EditNet {
  const pts: Pt[] = []
  const endGrid = new Map<string, number[]>()
  const endNode = (p: Pt) => {
    const cx = Math.floor(p[0] / NODE_MERGE_M)
    const cy = Math.floor(p[1] / NODE_MERGE_M)
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const id of endGrid.get(`${cx + dx}_${cy + dy}`) ?? []) {
          if (Math.hypot(pts[id][0] - p[0], pts[id][1] - p[1]) <= NODE_MERGE_M) return id
        }
      }
    }
    const id = pts.push([p[0], p[1]]) - 1
    const key = `${cx}_${cy}`
    const list = endGrid.get(key)
    if (list) list.push(id)
    else endGrid.set(key, [id])
    return id
  }

  const raw: { a: number; b: number }[] = []
  const endUse = new Map<number, number>()
  for (const line of lines) {
    if (line.length < 2) continue
    const ids = line.map((p, i) => (i === 0 || i === line.length - 1 ? endNode(p) : pts.push([p[0], p[1]]) - 1))
    for (const e of [ids[0], ids[ids.length - 1]]) endUse.set(e, (endUse.get(e) ?? 0) + 1)
    for (let i = 0; i < ids.length - 1; i += 1) {
      if (ids[i] !== ids[i + 1]) raw.push({ a: ids[i], b: ids[i + 1] })
    }
  }

  // 막다른 끝점이 다른 관 선 위에 있으면 T자 분기로 끼워 넣기
  const rawGrid = gridOf(pts, raw)
  const splits = new Map<number, { t: number; node: number }[]>()
  const links: [number, number][] = []
  for (const [node, count] of endUse) {
    if (count !== 1) continue
    const p = pts[node]
    let best: { seg: number; t: number; d: number } | null = null
    for (const i of nearSegs(rawGrid, p, TEE_M)) {
      const s = raw[i]
      if (s.a === node || s.b === node) continue
      const pr = segProject(p, pts[s.a], pts[s.b])
      if (pr.d <= TEE_M && (!best || pr.d < best.d)) best = { seg: i, t: pr.t, d: pr.d }
    }
    if (!best) continue
    const s = raw[best.seg]
    if (best.t <= 0.001) links.push([node, s.a])
    else if (best.t >= 0.999) links.push([node, s.b])
    else {
      // 본관 위 투영점에 새 절점을 두고 분기 끝과 짧게 잇는다(본관 모양 유지)
      const a = pts[s.a]
      const b = pts[s.b]
      const at = pts.push([a[0] + (b[0] - a[0]) * best.t, a[1] + (b[1] - a[1]) * best.t]) - 1
      links.push([node, at])
      const list = splits.get(best.seg)
      if (list) list.push({ t: best.t, node: at })
      else splits.set(best.seg, [{ t: best.t, node: at }])
    }
  }

  const edges: { a: number; b: number }[] = []
  const adj: Adj[][] = pts.map(() => [])
  // pts는 위에서 T자 절점이 더해졌을 수 있음
  const addEdge = (a: number, b: number) => {
    if (a === b) return
    const w = Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1])
    const id = edges.push({ a, b }) - 1
    adj[a].push({ to: b, w, id })
    adj[b].push({ to: a, w, id })
  }
  raw.forEach((s, i) => {
    const sp = (splits.get(i) ?? []).sort((x, y) => x.t - y.t)
    const chain = [s.a, ...sp.map((x) => x.node), s.b]
    for (let k = 0; k < chain.length - 1; k += 1) addEdge(chain[k], chain[k + 1])
  })
  for (const [a, b] of links) addEdge(a, b)

  return { pts, adj, edges, grid: gridOf(pts, edges) }
}

export function projectOnNet(net: EditNet, p: Pt, tol: number): NetProj | null {
  let best: NetProj | null = null
  for (const i of nearSegs(net.grid, p, tol)) {
    const e = net.edges[i]
    const pr = segProject(p, net.pts[e.a], net.pts[e.b])
    if (pr.d <= tol && (!best || pr.d < best.d)) best = { edge: i, t: pr.t, pt: pr.pt, d: pr.d }
  }
  return best
}

/** 이미 단수선이 지나는 구간인지(1/4·1/2·3/4 지점 중 하나라도 선 위) — 경로가 기존 선을 되짚지 않게 */
export function makeCoverTest(lines: Pt[][], tol = 1) {
  const pts: Pt[] = []
  const segs: { a: number; b: number }[] = []
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i += 1) {
      const a = pts.push(line[i]) - 1
      const b = pts.push(line[i + 1]) - 1
      segs.push({ a, b })
    }
  }
  const grid = gridOf(pts, segs)
  const onLine = (p: Pt) => {
    for (const i of nearSegs(grid, p, tol)) {
      const s = segs[i]
      if (segProject(p, pts[s.a], pts[s.b]).d <= tol) return true
    }
    return false
  }
  return (a: Pt, b: Pt) =>
    [0.25, 0.5, 0.75].some((t) => onLine([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]))
}

/**
 * from → to 관로 최단 경로(좌표열).
 * covered 구간은 기본적으로 지나지 않고, coveredCost를 주면 그 배수 비용으로만 지나간다
 * (기존 단수선 중간에서 옆 관로로 새 분기를 낼 때 접합점까지 가기 위함).
 */
export function netPath(
  net: EditNet,
  from: NetProj,
  to: NetProj,
  isCovered: (a: Pt, b: Pt) => boolean,
  coveredCost?: number
): Pt[] | null {
  const n = net.pts.length
  const S = n
  const T = n + 1
  const ptOf = (u: number): Pt => (u === S ? from.pt : u === T ? to.pt : net.pts[u])
  const fe = net.edges[from.edge]
  const te = net.edges[to.edge]
  const edgeLen = (e: { a: number; b: number }) =>
    Math.hypot(net.pts[e.a][0] - net.pts[e.b][0], net.pts[e.a][1] - net.pts[e.b][1])
  const fLen = edgeLen(fe)
  const tLen = edgeLen(te)

  const blockedCache = new Map<number, boolean>()
  const edgeBlocked = (id: number) => {
    let v = blockedCache.get(id)
    if (v == null) {
      const e = net.edges[id]
      v = isCovered(net.pts[e.a], net.pts[e.b])
      blockedCache.set(id, v)
    }
    return v
  }

  /** 지날 수 없으면 null, 아니면 (덮인 구간이면 배수 적용한) 비용 */
  const cost = (blocked: boolean, w: number) =>
    !blocked ? w : coveredCost != null ? w * coveredCost : null

  /**
   * 시작·도착 지점 ↔ 절점 사이 짧은 토막은 덮임 판정을 하지 않는다.
   * (선 끝이 절점·밸브 자리에 있으면 이 토막이 기존 선 위라서 막혀, 이어지는 관로를 못 찾던 문제)
   */
  const SHORT_STUB_M = 5
  const stubCovered = (a: Pt, b: Pt) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]) > SHORT_STUB_M && isCovered(a, b)

  const neighbors = (u: number): { to: number; w: number }[] => {
    const out: { to: number; w: number }[] = []
    const add = (to: number, blocked: boolean, w: number) => {
      const c = cost(blocked, w)
      if (c != null) out.push({ to, w: c })
    }
    if (u === S) {
      add(fe.a, stubCovered(from.pt, net.pts[fe.a]), from.t * fLen)
      add(fe.b, stubCovered(from.pt, net.pts[fe.b]), (1 - from.t) * fLen)
      if (from.edge === to.edge) add(T, isCovered(from.pt, to.pt), Math.abs(to.t - from.t) * fLen)
      return out
    }
    for (const e of net.adj[u]) add(e.to, edgeBlocked(e.id), e.w)
    if (u === te.a) add(T, stubCovered(net.pts[te.a], to.pt), to.t * tLen)
    if (u === te.b) add(T, stubCovered(net.pts[te.b], to.pt), (1 - to.t) * tLen)
    return out
  }

  const dist = new Map<number, number>([[S, 0]])
  const prev = new Map<number, number>()
  const heap: [number, number][] = [[0, S]]
  const push = (item: [number, number]) => {
    heap.push(item)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }

  while (heap.length > 0) {
    const [d, u] = pop()
    if (d > (dist.get(u) ?? Infinity)) continue
    if (u === T) break
    if (d > MAX_PATH_M * (coveredCost ?? 1)) break
    for (const nb of neighbors(u)) {
      const nd = d + nb.w
      if (nd < (dist.get(nb.to) ?? Infinity)) {
        dist.set(nb.to, nd)
        prev.set(nb.to, u)
        push([nd, nb.to])
      }
    }
  }
  if (!dist.has(T)) return null
  const path: Pt[] = []
  for (let u: number | undefined = T; u != null; u = prev.get(u)) {
    path.push(ptOf(u))
    if (u === S) break
  }
  return path.reverse()
}
