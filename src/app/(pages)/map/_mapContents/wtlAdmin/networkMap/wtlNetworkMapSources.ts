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

/** 기본 정렬: 상수 → 상수(서용) → 기타 상수* → 광역상수 등 */
export function compareWtlNetMapGroupNames(a: string, b: string): number {
  const rank = (g: string) => {
    if (g === '상수') return 0
    if (g === '상수(서용)') return 1
    if (g.startsWith('상수')) return 2
    return 3
  }
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb
  return a.localeCompare(b, 'ko')
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
  sources.sort((a, b) => compareWtlNetMapGroupNames(a.id, b.id))
  return sources
}

/** 클라이언트: 서버 listWtlNetMapSources 결과로 채움 */
let runtimeSources: WtlNetMapSourceDef[] = []
let byId = new Map<string, WtlNetMapSourceDef>()

function rebuildIndex() {
  byId = new Map(runtimeSources.map((s) => [s.id, s]))
}

export function setWtlNetMapSources(payloads: readonly WtlNetMapSourcePayload[]) {
  runtimeSources = payloads.map(toWtlNetMapSourceDef)
  rebuildIndex()
}

export function getWtlNetMapSources(): readonly WtlNetMapSourceDef[] {
  return runtimeSources
}

export function getWtlNetMapSource(id: string): WtlNetMapSourceDef | undefined {
  return byId.get(id)
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

/** localStorage 설정 적용 후 상단 버튼에 보일 출처 */
export function applyWtlNetMapSourceUiSettings(
  availableIds: readonly string[],
  settings: { order?: string[]; visible?: string[] } | null
): WtlNetMapSourceId[] {
  const available = [...availableIds].map(String).filter(Boolean)
  if (available.length === 0) return []

  const order = Array.isArray(settings?.order) ? settings!.order.map(String) : []
  const ordered: string[] = []
  for (const id of order) {
    if (available.includes(id) && !ordered.includes(id)) ordered.push(id)
  }
  const rest = available
    .filter((id) => !ordered.includes(id))
    .sort(compareWtlNetMapGroupNames)
  const full = [...ordered, ...rest]

  if (!settings || !Array.isArray(settings.visible)) return full
  const visibleSet = new Set(settings.visible.map(String))
  /** 저장 당시 order/visible에 없던 신규 그룹은 기본 표시 */
  const known = new Set([...settings.visible, ...order].map(String))
  const shown = full.filter((id) => visibleSet.has(id) || !known.has(id))
  return shown.length > 0 ? shown : full
}

/** 초기 선택 그룹 — 상수 → 상수(서용) → 정렬 첫 항목 */
export function pickDefaultWtlNetMapSourceId(
  visibleIds: readonly string[]
): WtlNetMapSourceId | null {
  const ids = visibleIds.map(String).filter(Boolean)
  if (ids.length === 0) return null
  for (const prefer of ['상수', '상수(서용)']) {
    if (ids.includes(prefer)) return prefer
  }
  return ids[0] ?? null
}
