/**
 * 관망조회 — 상수·광역상수 그룹 출처
 * 그룹 목록·실테이블 여부는 서버(listWtlNetMapSources)가 tables.json∩DB로 계산해 내려준다.
 * 시설관리와 같이 한글명으로 그룹 내 실테이블을 고른다.
 */

import tablesJson from '@/config/defineLayer/tables.json'

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
  define_table_kor_name?: string
}

type TablesJsonKorRow = {
  define_table_name?: string
  define_table_kor_name?: string
}

const TABLES_ROWS = (Array.isArray(tablesJson) ? tablesJson : []) as TablesJsonKorRow[]

/** define_table_name → 한글명 */
const KOR_BY_TABLE = (() => {
  const map = new Map<string, string>()
  for (const row of TABLES_ROWS) {
    const name = String(row.define_table_name ?? '')
      .trim()
      .toLowerCase()
    const kor = String(row.define_table_kor_name ?? '').trim()
    if (!name || !kor || map.has(name)) continue
    map.set(name, kor)
  }
  return map
})()

/** 한글명 → tables.json 등장 순 테이블명 */
const TABLES_BY_KOR = (() => {
  const map = new Map<string, string[]>()
  for (const row of TABLES_ROWS) {
    const name = String(row.define_table_name ?? '')
      .trim()
      .toLowerCase()
    const kor = String(row.define_table_kor_name ?? '').trim()
    if (!name || !kor) continue
    const list = map.get(kor)
    if (list) {
      if (!list.includes(name)) list.push(name)
    } else {
      map.set(kor, [name])
    }
  }
  return map
})()

export function wtlNetKorNameForTable(tableName: string): string | null {
  const want = String(tableName ?? '')
    .trim()
    .toLowerCase()
  if (!want) return null
  return KOR_BY_TABLE.get(want) ?? null
}

/** 기준 테이블과 한글명이 같은 전체 후보(tables.json 순) */
export function listWtlNetSameKorTables(baseTable: string): string[] {
  const base = String(baseTable ?? '')
    .trim()
    .toLowerCase()
  if (!base) return []
  const kor = KOR_BY_TABLE.get(base)
  if (!kor) return [base]
  const list = TABLES_BY_KOR.get(kor) ?? []
  return list.length > 0 ? [...list] : [base]
}

/**
 * 시설관리와 동일 — 기준 테이블 한글명과 같은 레이어 중 그룹(출처)에 속한 후보.
 * 우선순위: tables.json 한글명 순 → 그룹 내 동일 한글명 → 동일명 → 접미어.
 */
export function listWtlNetSameKorTablesInGroup(
  groupTables: readonly string[],
  baseTable: string
): string[] {
  const lower = groupTables.map((t) => String(t ?? '').trim().toLowerCase()).filter(Boolean)
  const set = new Set(lower)
  const base = String(baseTable ?? '')
    .trim()
    .toLowerCase()
  if (!base) return []

  const out: string[] = []
  const push = (name: string) => {
    const n = String(name ?? '')
      .trim()
      .toLowerCase()
    if (!n || out.includes(n)) return
    out.push(n)
  }

  const kor = KOR_BY_TABLE.get(base)
  if (kor) {
    for (const name of TABLES_BY_KOR.get(kor) ?? []) {
      if (set.has(name)) push(name)
    }
    for (const t of lower) {
      if (KOR_BY_TABLE.get(t) === kor) push(t)
    }
  }
  if (set.has(base)) push(base)
  const ends = lower.find((t) => t !== base && t.endsWith(base))
  if (ends) push(ends)
  return out
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
  const lower = groupTables.map((t) => String(t ?? '').trim().toLowerCase()).filter(Boolean)
  const set = new Set(lower)
  return (baseTable: string) => {
    const base = String(baseTable ?? '')
      .trim()
      .toLowerCase()
    if (!base) return base
    // 시설관리와 동일 — 한글명 일치 첫 후보(없으면 동일명·접미어)
    const sameKor = listWtlNetSameKorTablesInGroup(lower, base)
    if (sameKor[0]) return sameKor[0]
    if (set.has(base)) return base
    const ends = lower.find((t) => t.endsWith(base))
    return ends ?? base
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

/** 출처×논리키 → 한글명·데이터 실존 물리 테이블 (listWtlNetworkAvailableLayerKeys) */
let runtimePhysicalBySource: Record<string, Record<string, string>> = {}

function rebuildIndex() {
  byId = new Map(runtimeSources.map((s) => [s.id, s]))
}

export function setWtlNetMapSources(payloads: readonly WtlNetMapSourcePayload[]) {
  runtimeSources = payloads.map(toWtlNetMapSourceDef).sort(compareWtlNetMapSources)
  rebuildIndex()
}

export function setWtlNetPhysicalBySource(
  map: Record<string, Record<string, string>> | null | undefined
) {
  const next: Record<string, Record<string, string>> = {}
  if (map && typeof map === 'object') {
    for (const [sid, byKey] of Object.entries(map)) {
      if (!byKey || typeof byKey !== 'object') continue
      const inner: Record<string, string> = {}
      for (const [k, v] of Object.entries(byKey)) {
        const key = String(k ?? '').trim()
        const phys = String(v ?? '')
          .trim()
          .toLowerCase()
        if (key && phys) inner[key] = phys
      }
      if (Object.keys(inner).length > 0) next[String(sid)] = inner
    }
  }
  runtimePhysicalBySource = next
}

/** 논리 레이어 키 → 실제 조회용 물리 테이블 (범례 SLD는 define_table_name 사용) */
export function getWtlNetPhysicalTable(
  layerKey: string,
  sourceId?: string | null
): string | null {
  const key = String(layerKey ?? '').trim()
  if (!key) return null
  const sid = String(sourceId ?? '').trim()
  if (sid) {
    const hit = runtimePhysicalBySource[sid]?.[key]
    if (hit) return hit
  }
  for (const byKey of Object.values(runtimePhysicalBySource)) {
    const hit = byKey[key]
    if (hit) return hit
  }
  return null
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
