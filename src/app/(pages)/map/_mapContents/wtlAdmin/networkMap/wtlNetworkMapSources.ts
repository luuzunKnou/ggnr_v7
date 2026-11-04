/**
 * 관망조회 — 상수·광역상수 그룹 출처
 * 그룹 목록·실테이블 여부는 서버(listWtlNetMapSources)가 tables.json∩DB로 계산해 내려준다.
 */

export type WtlNetMapSourceId = string

export type WtlNetMapSourceDef = {
  /** define_table_group 값 */
  id: WtlNetMapSourceId
  label: string
  /** catalog 테이블명(wtl_*) → 그룹 내 실제 layer 테이블명 */
  remapTable: (baseTable: string) => string
  /** 그룹에 속한 define_table_name */
  tables: readonly string[]
}

export type WtlNetMapSourcePayload = {
  id: string
  label: string
  tables: string[]
}

export type TablesJsonRow = {
  define_table_group?: string
  define_table_name?: string
}

/** 상수% + 광역상수 */
export function isWtlNetMapGroup(group: string): boolean {
  return group.startsWith('상수') || group === '광역상수'
}

/**
 * 테이블명 접두어 순위.
 * wtl_* → 0 / {a-z}_wtl_* → 1..26 / 그 외 → 100+
 */
export function wtlNetMapTablePrefixRank(tableName: string): number {
  const t = String(tableName ?? '').trim().toLowerCase()
  if (!t) return 999
  if (t.startsWith('wtl_')) return 0
  const m = /^([a-z])_wtl_/.exec(t)
  if (m?.[1]) return 1 + (m[1].charCodeAt(0) - 97)
  return 100
}

/** 그룹 소속 테이블에서 최저(가장 앞) 접두어 순위 */
export function wtlNetMapGroupPrefixRank(tables: readonly string[]): number {
  let best = 999
  for (const name of tables) {
    const r = wtlNetMapTablePrefixRank(name)
    if (r < best) best = r
  }
  return best
}

export function compareWtlNetMapSources(
  a: Pick<WtlNetMapSourceDef, 'id' | 'tables'>,
  b: Pick<WtlNetMapSourceDef, 'id' | 'tables'>
): number {
  const ra = wtlNetMapGroupPrefixRank(a.tables)
  const rb = wtlNetMapGroupPrefixRank(b.tables)
  if (ra !== rb) return ra - rb
  return a.id.localeCompare(b.id, 'ko')
}

export function makeWtlNetMapRemap(
  groupTables: readonly string[]
): (baseTable: string) => string {
  const lower = groupTables.map((t) => t.toLowerCase())
  const set = new Set(lower)
  return (baseTable: string) => {
    const base = baseTable.toLowerCase()
    if (set.has(base)) return base
    const hit = lower.find((t) => t.endsWith(base))
    return hit ?? base
  }
}

export function toWtlNetMapSourceDef(payload: WtlNetMapSourcePayload): WtlNetMapSourceDef {
  const tables = payload.tables.map((t) => String(t).trim()).filter(Boolean)
  return {
    id: payload.id,
    label: payload.label || payload.id,
    tables,
    remapTable: makeWtlNetMapRemap(tables),
  }
}

/** tables.json 행 → 그룹 후보(DB 존재 여부는 서버에서 추가 필터) */
export function buildWtlNetMapSourcesFromRows(
  rows: readonly TablesJsonRow[]
): WtlNetMapSourceDef[] {
  const byGroup = new Map<string, string[]>()
  for (const row of rows) {
    const group = String(row.define_table_group ?? '').trim()
    if (!group || !isWtlNetMapGroup(group)) continue
    const name = String(row.define_table_name ?? '').trim()
    if (!name) continue
    const list = byGroup.get(group)
    if (list) {
      if (!list.includes(name)) list.push(name)
    } else {
      byGroup.set(group, [name])
    }
  }

  const sources: WtlNetMapSourceDef[] = []
  for (const [group, names] of byGroup) {
    sources.push(toWtlNetMapSourceDef({ id: group, label: group, tables: names }))
  }
  sources.sort(compareWtlNetMapSources)
  return sources
}

/** 클라이언트: 서버 listWtlNetMapSources 결과로 채움 */
let runtimeSources: WtlNetMapSourceDef[] = []
let byId = new Map<string, WtlNetMapSourceDef>()

function rebuildIndex() {
  byId = new Map(runtimeSources.map((s) => [s.id, s]))
}

export function setWtlNetMapSources(payloads: readonly WtlNetMapSourcePayload[]) {
  runtimeSources = payloads.map(toWtlNetMapSourceDef).sort(compareWtlNetMapSources)
  rebuildIndex()
}

export function getWtlNetMapSources(): readonly WtlNetMapSourceDef[] {
  return runtimeSources
}

export function getWtlNetMapSource(id: string): WtlNetMapSourceDef | undefined {
  return byId.get(id)
}

/**
 * 기본 정렬: wtl_* 그룹 → {a-z}_wtl_* 알파벳 → 그 외(그룹명).
 * id만 넘기면 runtime 출처의 tables로 접두어를 본다.
 */
export function compareWtlNetMapGroupNames(a: string, b: string): number {
  const ra = wtlNetMapGroupPrefixRank(byId.get(a)?.tables ?? [])
  const rb = wtlNetMapGroupPrefixRank(byId.get(b)?.tables ?? [])
  if (ra !== rb) return ra - rb
  return a.localeCompare(b, 'ko')
}

/** @deprecated 서버 응답 등록 전엔 비어 있음 — getWtlNetMapSources() 사용 */
export const WTL_NET_MAP_SOURCES: readonly WtlNetMapSourceDef[] = []

export const WTL_NET_MAP_SOURCE_DEFAULT: ReadonlySet<WtlNetMapSourceId> = new Set()

export function parseWtlNetMapSourceIds(raw: unknown): WtlNetMapSourceId[] {
  const fallback = runtimeSources[0] ? [runtimeSources[0].id] : []
  if (!Array.isArray(raw)) {
    if (byId.has('상수')) return ['상수']
    return fallback
  }
  const out: WtlNetMapSourceId[] = []
  for (const v of raw) {
    const id = String(v ?? '').trim()
    if (byId.has(id) && !out.includes(id)) out.push(id)
  }
  return out.length > 0 ? out : fallback
}

/** 초기 선택 그룹 — 접두어 정렬 첫 항목(보통 wtl_* = 상수) */
export function pickDefaultWtlNetMapSourceId(
  visibleIds: readonly string[]
): WtlNetMapSourceId | null {
  const ids = visibleIds.map(String).filter(Boolean)
  if (ids.length === 0) return null
  const sorted = [...ids].sort(compareWtlNetMapGroupNames)
  return sorted[0] ?? null
}
