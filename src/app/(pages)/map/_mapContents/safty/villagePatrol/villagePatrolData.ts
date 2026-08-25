/** 마을순찰대 편성 명단 — 타입·필터·클라이언트 캐시 (원본은 DB layer.village_patrol) */

import { call } from '@/lib/api'

export const TEAMS = ['A조', 'B조', 'C조'] as const
export type VillagePatrolTeam = (typeof TEAMS)[number]

const TEAM_ORDER: Record<string, number> = { A조: 0, B조: 1, C조: 2 }

export const AFFILIATIONS = [
  '이장',
  '공무원',
  '지도자',
  '의용소방대',
  '자율방재단',
  '자율방범대',
  '석맥청년회',
] as const
export type VillagePatrolAffiliation = (typeof AFFILIATIONS)[number] | string

export type VillagePatrolRow = {
  id: string
  eup: string
  village: string
  team: VillagePatrolTeam
  name: string
  affiliation: string
  phone: string
  /** 비고 */
  note: string
}

export type VillagePatrolUniqueRow = {
  key: string
  name: string
  affiliation: string
  phone: string
  placements: string
  note: string
  sourceIds: string[]
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

/** 입력 중 숫자·하이픈만 허용 */
export function sanitizePhoneInput(raw: string): string {
  return raw.replace(/[^\d-]/g, '')
}

/** 화면·엑셀용. 저장값은 normalizePhone(숫자만) */
export function formatPhone(digits: string): string {
  const d = normalizePhone(digits).slice(0, 11)
  if (!d) return ''
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length > 7) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`
  if (d.length > 3) return `${d.slice(0, 3)}-${d.slice(3)}`
  return d
}

function phoneForStore(phone: string | undefined): string {
  return normalizePhone(phone ?? '').slice(0, 11)
}

/** 목록 표시용 — 10자 초과 시 … */
export function truncateNote(text: string, max = 10): string {
  const t = String(text ?? '').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}...`
}

/** 연락처가 있으면 연락처, 없으면 이름 */
export function personKey(name: string, phone: string): string {
  const p = normalizePhone(phone)
  if (p.length >= 10) return `tel:${p}`
  return `name:${name.trim()}`
}

type VillagePatrolStore = {
  rows: VillagePatrolRow[]
  listeners: Set<() => void>
}

const store: VillagePatrolStore = (() => {
  const g = globalThis as typeof globalThis & { __ggnrVillagePatrolClientStore?: VillagePatrolStore }
  if (!g.__ggnrVillagePatrolClientStore) {
    g.__ggnrVillagePatrolClientStore = { rows: [], listeners: new Set() }
  }
  return g.__ggnrVillagePatrolClientStore
})()

function emit() {
  store.listeners.forEach((fn) => fn())
}

function setRows(next: VillagePatrolRow[]) {
  store.rows = sortVillagePatrolRows(
    next.map((r) => ({
      ...r,
      id: String(r.id),
      phone: phoneForStore(r.phone),
      note: r.note ?? '',
      team: (TEAMS as readonly string[]).includes(r.team) ? r.team : 'A조',
    }))
  )
  emit()
}

export function getVillagePatrolRows(): VillagePatrolRow[] {
  return store.rows
}

export function subscribeVillagePatrol(listener: () => void): () => void {
  store.listeners.add(listener)
  return () => store.listeners.delete(listener)
}

async function vpCall<T = Record<string, unknown>>(
  action: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const res = await call('', 'POST', {
    service: 'villagePatrolService',
    action,
    params,
  })
  if (res && typeof res === 'object' && 'success' in res && res.success === false) {
    throw new Error(String((res as { error?: string }).error || '요청에 실패했습니다.'))
  }
  return ((res as { data?: T })?.data ?? res) as T
}

/** 서버 목록 로드 (자동 시드 없음) */
export async function loadVillagePatrolRows(): Promise<VillagePatrolRow[]> {
  try {
    const data = await vpCall<{ rows?: VillagePatrolRow[] }>('list')
    setRows(Array.isArray(data?.rows) ? data.rows : [])
    return store.rows
  } catch (e) {
    setRows([])
    throw e
  }
}

/** 패널 닫을 때 등 — 클라 캐시 비우기 */
export function clearVillagePatrolRows() {
  setRows([])
}

/** 편성 행 동일 여부 — 읍면·마을·조·성명·연락처 */
export function assignmentRowKey(r: Pick<VillagePatrolRow, 'eup' | 'village' | 'team' | 'name' | 'phone'>): string {
  return `${r.eup.trim()}|${r.village.trim()}|${r.team}|${r.name.trim()}|${phoneForStore(r.phone)}`
}

/** 엑셀 전체 교체 */
export async function replaceVillagePatrolRows(next: VillagePatrolRow[]) {
  const data = await vpCall<{ rows?: VillagePatrolRow[] }>('replaceAll', { rows: next })
  setRows(Array.isArray(data?.rows) ? data.rows : [])
}

/** 엑셀 append — 동일 편성이면 소속·비고 갱신 */
export async function appendVillagePatrolRows(incoming: VillagePatrolRow[]): Promise<{
  added: number
  updated: number
}> {
  const data = await vpCall<{ rows?: VillagePatrolRow[]; added?: number; updated?: number }>('append', {
    rows: incoming,
  })
  setRows(Array.isArray(data?.rows) ? data.rows : [])
  return { added: Number(data?.added ?? 0), updated: Number(data?.updated ?? 0) }
}

/** 화면 저장 1회 배치 */
export async function saveVillagePatrolBatch(params: {
  adds: Omit<VillagePatrolRow, 'id'>[]
  updates: { id: string; patch: Omit<VillagePatrolRow, 'id'> }[]
  personUpdates: {
    key: string
    patch: Pick<VillagePatrolRow, 'name' | 'affiliation' | 'phone' | 'note'>
  }[]
  removeIds: string[]
  removePersonKeys: string[]
}): Promise<{ added: number; updated: number; removed: number }> {
  const data = await vpCall<{
    rows?: VillagePatrolRow[]
    added?: number
    updated?: number
    removed?: number
  }>('saveBatch', params)
  setRows(Array.isArray(data?.rows) ? data.rows : [])
  return {
    added: Number(data?.added ?? 0),
    updated: Number(data?.updated ?? 0),
    removed: Number(data?.removed ?? 0),
  }
}

export async function addVillagePatrolRow(
  input: Omit<VillagePatrolRow, 'id'>
): Promise<VillagePatrolRow | null> {
  const data = await vpCall<{ row?: VillagePatrolRow }>('add', { row: input })
  if (data?.row) {
    setRows(sortVillagePatrolRows([...store.rows, data.row]))
  } else {
    await loadVillagePatrolRows()
  }
  return data?.row ?? null
}

export async function updateVillagePatrolRow(id: string, patch: Partial<Omit<VillagePatrolRow, 'id'>>) {
  await vpCall('update', { id, patch })
  setRows(
    store.rows.map((r) =>
      r.id === id
        ? {
            ...r,
            ...patch,
            phone: patch.phone !== undefined ? phoneForStore(patch.phone) : r.phone,
            note: patch.note ?? r.note ?? '',
          }
        : r
    )
  )
}

export async function updateVillagePatrolByPersonKey(
  key: string,
  patch: Pick<VillagePatrolRow, 'name' | 'affiliation' | 'phone' | 'note'>
) {
  await vpCall('updateByPersonKey', { key, patch })
  const nextPhone = phoneForStore(patch.phone)
  setRows(
    store.rows.map((r) =>
      personKey(r.name, r.phone) === key
        ? { ...r, ...patch, phone: nextPhone, note: patch.note ?? '' }
        : r
    )
  )
}

export async function deleteVillagePatrolRow(id: string) {
  await vpCall('remove', { id })
  setRows(store.rows.filter((r) => r.id !== id))
}

export async function deleteVillagePatrolByPersonKey(key: string) {
  await vpCall('removeByPersonKey', { key })
  setRows(store.rows.filter((r) => personKey(r.name, r.phone) !== key))
}

function uniqNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))]
}

/** 명단에 실제로 쓰인 읍면만 (0건이면 목록에서 빠짐) */
export function listEups(all = store.rows): string[] {
  return uniqNonEmpty(all.map((r) => r.eup))
}

/** 명단에 쓰인 마을만. eup 지정 시 해당 읍면만 */
export function listVillages(all = store.rows, eup = ''): string[] {
  const list = eup.trim() ? all.filter((r) => r.eup === eup.trim()) : all
  return uniqNonEmpty(list.map((r) => r.village))
}

/** 명단에 쓰인 소속만 (고정 후보 강제 추가 없음 → 0건이면 목록에서 빠짐) */
export function listAffiliations(all = store.rows): string[] {
  return uniqNonEmpty(all.map((r) => r.affiliation))
}

export type VillagePatrolFilter = {
  keyword: string
  eup: string
  village: string
  team: string
  affiliation: string
  uniqueOnly: boolean
  /** 전체 명단 기준 연락처(또는 이름)가 2건 이상인 사람만 */
  duplicatesOnly: boolean
}

export type VillagePatrolSortDir = 'asc' | 'desc'

export type VillagePatrolAssignmentSortKey =
  | 'eup'
  | 'village'
  | 'team'
  | 'name'
  | 'affiliation'
  | 'phone'
  | 'note'

export type VillagePatrolPersonSortKey = 'name' | 'affiliation' | 'phone' | 'placements' | 'note'

export type VillagePatrolAssignmentSortSpec = {
  key: VillagePatrolAssignmentSortKey
  dir: VillagePatrolSortDir
}

export type VillagePatrolPersonSortSpec = {
  key: VillagePatrolPersonSortKey
  dir: VillagePatrolSortDir
}

const ASSIGNMENT_SORT_KEYS = new Set<VillagePatrolAssignmentSortKey>([
  'eup',
  'village',
  'team',
  'name',
  'affiliation',
  'phone',
  'note',
])

const PERSON_SORT_KEYS = new Set<VillagePatrolPersonSortKey>([
  'name',
  'affiliation',
  'phone',
  'placements',
  'note',
])

function compareText(a: string, b: string, dir: VillagePatrolSortDir): number {
  const av = String(a ?? '').trim()
  const bv = String(b ?? '').trim()
  if (!av && !bv) return 0
  if (!av) return 1
  if (!bv) return -1
  const cmp = av.localeCompare(bv, 'ko')
  return dir === 'asc' ? cmp : -cmp
}

function comparePhone(a: string, b: string, dir: VillagePatrolSortDir): number {
  const av = normalizePhone(a)
  const bv = normalizePhone(b)
  if (!av && !bv) return 0
  if (!av) return 1
  if (!bv) return -1
  const cmp = av.localeCompare(bv)
  return dir === 'asc' ? cmp : -cmp
}

function compareTeam(a: VillagePatrolTeam, b: VillagePatrolTeam, dir: VillagePatrolSortDir): number {
  const cmp = (TEAM_ORDER[a] ?? 9) - (TEAM_ORDER[b] ?? 9)
  return dir === 'asc' ? cmp : -cmp
}

function buildVillageOrder(list: VillagePatrolRow[]): Map<string, number> {
  const villageOrder = new Map<string, number>()
  list.forEach((r, i) => {
    const k = `${r.eup}|${r.village}`
    if (!villageOrder.has(k)) villageOrder.set(k, i)
  })
  return villageOrder
}

/** 편성표 병합·블록 1차 정렬 — 마을 순서 유지, 마을 안 A조→B조→C조 */
export function compareVillagePatrolDefault(
  a: VillagePatrolRow,
  b: VillagePatrolRow,
  villageOrder: Map<string, number>
): number {
  const ka = `${a.eup}|${a.village}`
  const kb = `${b.eup}|${b.village}`
  const va = villageOrder.get(ka) ?? 0
  const vb = villageOrder.get(kb) ?? 0
  if (va !== vb) return va - vb
  return (TEAM_ORDER[a.team] ?? 9) - (TEAM_ORDER[b.team] ?? 9)
}

export function initialVillagePatrolAssignmentSortDir(
  _key: VillagePatrolAssignmentSortKey
): VillagePatrolSortDir {
  return 'asc'
}

export function initialVillagePatrolPersonSortDir(_key: VillagePatrolPersonSortKey): VillagePatrolSortDir {
  return 'asc'
}

function compareAssignmentByKey(
  a: VillagePatrolRow,
  b: VillagePatrolRow,
  key: VillagePatrolAssignmentSortKey,
  dir: VillagePatrolSortDir
): number {
  switch (key) {
    case 'eup':
      return compareText(a.eup, b.eup, dir)
    case 'village':
      return compareText(a.village, b.village, dir)
    case 'team':
      return compareTeam(a.team, b.team, dir)
    case 'name':
      return compareText(a.name, b.name, dir)
    case 'affiliation':
      return compareText(a.affiliation, b.affiliation, dir)
    case 'phone':
      return comparePhone(a.phone, b.phone, dir)
    case 'note':
      return compareText(a.note, b.note, dir)
    default:
      return 0
  }
}

function comparePersonByKey(
  a: VillagePatrolUniqueRow,
  b: VillagePatrolUniqueRow,
  key: VillagePatrolPersonSortKey,
  dir: VillagePatrolSortDir
): number {
  switch (key) {
    case 'name':
      return compareText(a.name, b.name, dir)
    case 'affiliation':
      return compareText(a.affiliation, b.affiliation, dir)
    case 'phone':
      return comparePhone(a.phone, b.phone, dir)
    case 'placements':
      return compareText(a.placements, b.placements, dir)
    case 'note':
      return compareText(a.note, b.note, dir)
    default:
      return 0
  }
}

/** 마을 순서 유지, 마을 안에서는 A조 → B조 → C조 */
export function sortVillagePatrolRows(list: VillagePatrolRow[]): VillagePatrolRow[] {
  const villageOrder = buildVillageOrder(list)
  return [...list].sort((a, b) => compareVillagePatrolDefault(a, b, villageOrder))
}

const PLACE_SORT_KEYS = new Set<VillagePatrolAssignmentSortKey>(['eup', 'village', 'team'])
const WITHIN_BLOCK_SORT_KEYS = new Set<VillagePatrolAssignmentSortKey>([
  'name',
  'affiliation',
  'phone',
  'note',
])

/**
 * 편성표 목록
 * - 읍면·마을·조 thead: 블록 순서(1차) — 병합 유지
 * - 성명·소속·연락처·비고 thead: 동일 블록 안(2차)
 * - thead 없음: 기본 병합 순서(마을 등장 순 → A/B/C조)
 */
export function sortVillagePatrolAssignmentRows(
  list: VillagePatrolRow[],
  sorts?: VillagePatrolAssignmentSortSpec[] | null
): VillagePatrolRow[] {
  const specs = (sorts ?? []).filter((s) => ASSIGNMENT_SORT_KEYS.has(s.key))
  const placeSpecs = specs.filter((s) => PLACE_SORT_KEYS.has(s.key))
  const withinSpecs = specs.filter((s) => WITHIN_BLOCK_SORT_KEYS.has(s.key))
  const villageOrder = buildVillageOrder(list)
  return [...list].sort((a, b) => {
    for (const spec of placeSpecs) {
      const cmp = compareAssignmentByKey(a, b, spec.key, spec.dir)
      if (cmp !== 0) return cmp
    }

    const base = compareVillagePatrolDefault(a, b, villageOrder)
    if (base !== 0) return base

    if (a.eup === b.eup && a.village === b.village && a.team === b.team) {
      for (const spec of withinSpecs) {
        const cmp = compareAssignmentByKey(a, b, spec.key, spec.dir)
        if (cmp !== 0) return cmp
      }
    }
    return 0
  })
}

/** 인원(중복 제거·확인) 표 — thead 정렬 우선, 동점 시 성명 */
export function sortVillagePatrolPersonRows(
  list: VillagePatrolUniqueRow[],
  sorts?: VillagePatrolPersonSortSpec[] | null
): VillagePatrolUniqueRow[] {
  const specs = (sorts ?? []).filter((s) => PERSON_SORT_KEYS.has(s.key))
  return [...list].sort((a, b) => {
    for (const spec of specs) {
      const cmp = comparePersonByKey(a, b, spec.key, spec.dir)
      if (cmp !== 0) return cmp
    }
    return compareText(a.name, b.name, 'asc')
  })
}

/**
 * 연속 동일 읍면·마을·조 구간의 rowspan/엑셀 병합용.
 * 인덱스에 span>0 이면 그 행이 구간 시작, 0이면 셀 생략.
 */
export function villagePatrolGroupSpans(list: VillagePatrolRow[]): {
  eup: number[]
  village: number[]
  team: number[]
} {
  const build = (keyFn: (r: VillagePatrolRow) => string): number[] => {
    const spans = new Array(list.length).fill(0)
    let i = 0
    while (i < list.length) {
      const key = keyFn(list[i])
      let j = i + 1
      while (j < list.length && keyFn(list[j]) === key) j++
      spans[i] = j - i
      i = j
    }
    return spans
  }
  return {
    /** 읍면·마을은 조 단위로 병합 (조가 바뀌면 읍면·마을도 다시 표시) */
    eup: build((r) => `${r.eup}\0${r.village}\0${r.team}`),
    village: build((r) => `${r.eup}\0${r.village}\0${r.team}`),
    team: build((r) => `${r.eup}\0${r.village}\0${r.team}`),
  }
}

/** 전체 명단에서 2건 이상 편성된 사람 키 */
export function duplicatePersonKeys(all: VillagePatrolRow[]): Set<string> {
  const counts = new Map<string, number>()
  for (const r of all) {
    const k = personKey(r.name, r.phone)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const dup = new Set<string>()
  for (const [k, n] of counts) {
    if (n >= 2) dup.add(k)
  }
  return dup
}

export function filterVillagePatrolRows(
  all: VillagePatrolRow[],
  f: VillagePatrolFilter
): VillagePatrolRow[] {
  const kw = f.keyword.trim().toLowerCase()
  const dupKeys = f.duplicatesOnly ? duplicatePersonKeys(all) : null
  const filtered = all.filter((r) => {
    if (f.eup && r.eup !== f.eup) return false
    if (f.village && r.village !== f.village) return false
    if (f.team && r.team !== f.team) return false
    if (f.affiliation && r.affiliation !== f.affiliation) return false
    if (dupKeys && !dupKeys.has(personKey(r.name, r.phone))) return false
    if (!kw) return true
    const blob =
      `${r.eup} ${r.village} ${r.team} ${r.name} ${r.affiliation} ${r.phone} ${formatPhone(r.phone)} ${r.note}`.toLowerCase()
    return blob.includes(kw)
  })
  return filtered
}

export function toUniqueRows(list: VillagePatrolRow[]): VillagePatrolUniqueRow[] {
  const map = new Map<string, VillagePatrolUniqueRow>()
  for (const r of list) {
    const key = personKey(r.name, r.phone)
    const place = `${r.eup} ${r.village} ${r.team}`
    const note = (r.note ?? '').trim()
    const cur = map.get(key)
    if (!cur) {
      map.set(key, {
        key,
        name: r.name,
        affiliation: r.affiliation,
        phone: r.phone,
        placements: place,
        note,
        sourceIds: [r.id],
      })
      continue
    }
    cur.sourceIds.push(r.id)
    if (!cur.placements.split(' · ').includes(place)) cur.placements += ` · ${place}`
    if (r.affiliation && !cur.affiliation.split('·').map((s) => s.trim()).includes(r.affiliation)) {
      cur.affiliation = `${cur.affiliation} · ${r.affiliation}`
    }
    if (note && !cur.note.split(' · ').map((s) => s.trim()).includes(note)) {
      cur.note = cur.note ? `${cur.note} · ${note}` : note
    }
  }
  return [...map.values()]
}
