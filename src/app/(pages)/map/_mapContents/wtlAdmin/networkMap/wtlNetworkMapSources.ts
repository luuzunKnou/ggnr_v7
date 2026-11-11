/** 관망조회 — 상수관망도 출처(대진·서영·성과심사) */

export const WTL_NET_MAP_SOURCE_IDS = ['daejin', 'seoyoung', 'review'] as const

export type WtlNetMapSourceId = (typeof WTL_NET_MAP_SOURCE_IDS)[number]

export type WtlNetMapSourceDef = {
  id: WtlNetMapSourceId
  label: string
  /** catalog 테이블명(wtl_*) → 실제 layer 테이블명 */
  remapTable: (baseTable: string) => string
}

export const WTL_NET_MAP_SOURCES: readonly WtlNetMapSourceDef[] = [
  {
    id: 'daejin',
    label: '상수관망도(대진)',
    remapTable: (t) => t.replace(/^wtl_/, 'd_wtl_'),
  },
  {
    id: 'seoyoung',
    label: '상수관망도(서영)',
    remapTable: (t) => t.replace(/^wtl_/, 'wwtl_'),
  },
  {
    id: 'review',
    label: '상수관망도(성과심사)',
    remapTable: (t) => t,
  },
]

export const WTL_NET_MAP_SOURCE_DEFAULT: ReadonlySet<WtlNetMapSourceId> = new Set(['daejin'])

const BY_ID = new Map(WTL_NET_MAP_SOURCES.map((s) => [s.id, s]))

export function getWtlNetMapSource(id: string): WtlNetMapSourceDef | undefined {
  return BY_ID.get(id as WtlNetMapSourceId)
}

export function parseWtlNetMapSourceIds(raw: unknown): WtlNetMapSourceId[] {
  if (!Array.isArray(raw)) return [...WTL_NET_MAP_SOURCE_DEFAULT]
  const out: WtlNetMapSourceId[] = []
  for (const v of raw) {
    const id = String(v ?? '').trim() as WtlNetMapSourceId
    if (BY_ID.has(id) && !out.includes(id)) out.push(id)
  }
  return out.length > 0 ? out : [...WTL_NET_MAP_SOURCE_DEFAULT]
}
