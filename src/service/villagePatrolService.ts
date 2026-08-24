/**
 * 마을순찰대 편성 명단 — layer.village_patrol
 */
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/database/db'
import { villagePatrol } from '@/database/schema/village_patrol'
import { ensureVillagePatrolTable } from '@/service/ensureLayerAppTables'

export type VillagePatrolTeam = 'A조' | 'B조' | 'C조'

export type VillagePatrolRowDto = {
  id: string
  eup: string
  village: string
  team: VillagePatrolTeam
  name: string
  affiliation: string
  phone: string
  note: string
}

const TEAMS = new Set(['A조', 'B조', 'C조'])

function normalizePhone(phone: string | undefined): string {
  return String(phone ?? '')
    .replace(/\D/g, '')
    .slice(0, 11)
}

function asTeam(v: string): VillagePatrolTeam {
  return TEAMS.has(v) ? (v as VillagePatrolTeam) : 'A조'
}

function assignmentKey(r: {
  eup: string
  village: string
  team: string
  name: string
  phone: string
}): string {
  return `${r.eup.trim()}|${r.village.trim()}|${r.team}|${r.name.trim()}|${normalizePhone(r.phone)}`
}

function personKey(name: string, phone: string): string {
  const p = normalizePhone(phone)
  if (p.length >= 10) return `tel:${p}`
  return `name:${name.trim()}`
}

function mapRow(r: typeof villagePatrol.$inferSelect): VillagePatrolRowDto {
  return {
    id: String(r.id),
    eup: r.eup ?? '',
    village: r.village ?? '',
    team: asTeam(r.team ?? 'A조'),
    name: r.name ?? '',
    affiliation: r.affiliation ?? '',
    phone: normalizePhone(r.phone),
    note: r.note ?? '',
  }
}

const TEAM_ORDER: Record<string, number> = { A조: 0, B조: 1, C조: 2 }

function sortRows(list: VillagePatrolRowDto[]): VillagePatrolRowDto[] {
  const villageOrder = new Map<string, number>()
  list.forEach((r, i) => {
    const k = `${r.eup}|${r.village}`
    if (!villageOrder.has(k)) villageOrder.set(k, i)
  })
  return [...list].sort((a, b) => {
    const ka = `${a.eup}|${a.village}`
    const kb = `${b.eup}|${b.village}`
    const va = villageOrder.get(ka) ?? 0
    const vb = villageOrder.get(kb) ?? 0
    if (va !== vb) return va - vb
    return (TEAM_ORDER[a.team] ?? 9) - (TEAM_ORDER[b.team] ?? 9)
  })
}

let villagePatrolEnsurePromise: Promise<void> | null = null

async function ensureTable() {
  if (villagePatrolEnsurePromise) return villagePatrolEnsurePromise
  villagePatrolEnsurePromise = (async () => {
    const result = await ensureVillagePatrolTable()
    if (result.errors.length) {
      console.warn('[villagePatrol] ensure:', result.errors.join('; '))
    }
    await db.select({ id: villagePatrol.id }).from(villagePatrol).limit(1)
  })().catch((e) => {
    villagePatrolEnsurePromise = null
    throw e
  })
  return villagePatrolEnsurePromise
}

async function fetchAll(): Promise<VillagePatrolRowDto[]> {
  await ensureTable()
  const rows = await db.select().from(villagePatrol)
  return sortRows(rows.map(mapRow))
}

/** 목록 조회 (자동 시드 없음) */
export async function list(_params?: Record<string, unknown>) {
  return { rows: await fetchAll() }
}

type IncomingRow = {
  eup?: string
  village?: string
  team?: string
  name?: string
  affiliation?: string
  phone?: string
  note?: string
}

function normalizeIncoming(raw: IncomingRow) {
  return {
    eup: String(raw.eup ?? '').trim(),
    village: String(raw.village ?? '').trim(),
    team: asTeam(String(raw.team ?? 'A조').trim()),
    name: String(raw.name ?? '').trim(),
    affiliation: String(raw.affiliation ?? '').trim(),
    phone: normalizePhone(raw.phone),
    note: String(raw.note ?? '').trim(),
  }
}

type NormRow = ReturnType<typeof normalizeIncoming>

async function insertChunks(
  tx: Pick<typeof db, 'insert'>,
  values: NormRow[]
) {
  const chunk = 500
  for (let i = 0; i < values.length; i += chunk) {
    await tx.insert(villagePatrol).values(values.slice(i, i + chunk))
  }
}

/** 전체 교체 (drop) — 트랜잭션 */
export async function replaceAll(params: { rows?: IncomingRow[] }) {
  await ensureTable()
  const values = (Array.isArray(params.rows) ? params.rows : [])
    .map(normalizeIncoming)
    .filter((r) => r.name)

  await db.transaction(async (tx) => {
    await tx.delete(villagePatrol)
    if (values.length) await insertChunks(tx, values)
  })

  return { rows: await fetchAll(), count: values.length }
}

/**
 * append: 신규 추가. 동일 편성이면 소속·비고만 덮어씀.
 * 파일 안 동일 키는 나중 행의 비어 있지 않은 값 우선.
 */
export async function append(params: { rows?: IncomingRow[] }) {
  await ensureTable()
  const incoming = Array.isArray(params.rows) ? params.rows : []
  const existing = await db.select().from(villagePatrol)
  const byKey = new Map(existing.map((r) => [assignmentKey(mapRow(r)), r]))

  type Patch = { affiliation: string; note: string }
  const patches = new Map<number, Patch>()
  const toAddByKey = new Map<string, NormRow>()
  let added = 0
  let updated = 0

  const merge = (prev: Patch | undefined, next: Patch): Patch => {
    if (!prev) return next
    return {
      affiliation: next.affiliation !== '' ? next.affiliation : prev.affiliation,
      note: next.note !== '' ? next.note : prev.note,
    }
  }

  for (const raw of incoming) {
    const row = normalizeIncoming(raw)
    if (!row.name) continue
    const key = assignmentKey(row)
    const fields = { affiliation: row.affiliation, note: row.note }
    const cur = byKey.get(key)

    if (cur) {
      const base = patches.get(cur.id) ?? {
        affiliation: cur.affiliation ?? '',
        note: cur.note ?? '',
      }
      patches.set(cur.id, merge(base, fields))
      continue
    }

    const pending = toAddByKey.get(key)
    if (pending) {
      const merged = merge(
        { affiliation: pending.affiliation, note: pending.note },
        fields
      )
      pending.affiliation = merged.affiliation
      pending.note = merged.note
      continue
    }

    toAddByKey.set(key, row)
    added += 1
  }

  const toAdd = [...toAddByKey.values()]

  await db.transaction(async (tx) => {
    for (const [id, p] of patches) {
      const cur = existing.find((r) => r.id === id)
      if (!cur) continue
      if ((cur.affiliation ?? '') === p.affiliation && (cur.note ?? '') === p.note) continue
      updated += 1
      await tx
        .update(villagePatrol)
        .set({ affiliation: p.affiliation, note: p.note })
        .where(eq(villagePatrol.id, id))
    }
    if (toAdd.length) await insertChunks(tx, toAdd)
  })

  return { rows: await fetchAll(), added, updated }
}

export async function add(params: { row?: IncomingRow }) {
  await ensureTable()
  const row = normalizeIncoming(params.row ?? {})
  if (!row.name) throw Object.assign(new Error('성명이 필요합니다.'), { status: 400 })
  const [inserted] = await db.insert(villagePatrol).values(row).returning()
  return { row: mapRow(inserted!) }
}

export async function update(params: { id?: string | number; patch?: IncomingRow }) {
  await ensureTable()
  const id = Number(params.id)
  if (!Number.isFinite(id) || id <= 0) throw Object.assign(new Error('id가 필요합니다.'), { status: 400 })
  const patch = params.patch ?? {}
  const set: Partial<typeof villagePatrol.$inferInsert> = {}
  if (patch.eup !== undefined) set.eup = String(patch.eup).trim()
  if (patch.village !== undefined) set.village = String(patch.village).trim()
  if (patch.team !== undefined) set.team = asTeam(String(patch.team).trim())
  if (patch.name !== undefined) set.name = String(patch.name).trim()
  if (patch.affiliation !== undefined) set.affiliation = String(patch.affiliation).trim()
  if (patch.phone !== undefined) set.phone = normalizePhone(patch.phone)
  if (patch.note !== undefined) set.note = String(patch.note).trim()
  await db.update(villagePatrol).set(set).where(eq(villagePatrol.id, id))
  return { ok: true }
}

export async function updateByPersonKey(params: {
  key?: string
  patch?: Pick<IncomingRow, 'name' | 'affiliation' | 'phone' | 'note'>
}) {
  await ensureTable()
  const key = String(params.key ?? '')
  if (!key) throw Object.assign(new Error('key가 필요합니다.'), { status: 400 })
  const patch = params.patch ?? {}
  const all = await db.select().from(villagePatrol)
  const targets = all.filter((r) => personKey(r.name ?? '', r.phone ?? '') === key)
  const set: Partial<typeof villagePatrol.$inferInsert> = {}
  if (patch.name !== undefined) set.name = String(patch.name).trim()
  if (patch.affiliation !== undefined) set.affiliation = String(patch.affiliation).trim()
  if (patch.phone !== undefined) set.phone = normalizePhone(patch.phone)
  if (patch.note !== undefined) set.note = String(patch.note).trim()
  if (targets.length && Object.keys(set).length) {
    await db
      .update(villagePatrol)
      .set(set)
      .where(
        inArray(
          villagePatrol.id,
          targets.map((t) => t.id)
        )
      )
  }
  return { ok: true, count: targets.length }
}

export async function remove(params: { id?: string | number }) {
  await ensureTable()
  const id = Number(params.id)
  if (!Number.isFinite(id) || id <= 0) throw Object.assign(new Error('id가 필요합니다.'), { status: 400 })
  await db.delete(villagePatrol).where(eq(villagePatrol.id, id))
  return { ok: true }
}

export async function removeByPersonKey(params: { key?: string }) {
  await ensureTable()
  const key = String(params.key ?? '')
  if (!key) throw Object.assign(new Error('key가 필요합니다.'), { status: 400 })
  const all = await db.select().from(villagePatrol)
  const ids = all.filter((r) => personKey(r.name ?? '', r.phone ?? '') === key).map((r) => r.id)
  if (ids.length) {
    await db.delete(villagePatrol).where(inArray(villagePatrol.id, ids))
  }
  return { ok: true, count: ids.length }
}

/**
 * 화면 저장 1회 배치 — 추가·수정·삭제·인원수정을 트랜잭션으로 처리 후 목록 반환
 */
export async function saveBatch(params: {
  adds?: IncomingRow[]
  updates?: { id?: string | number; patch?: IncomingRow }[]
  personUpdates?: {
    key?: string
    patch?: Pick<IncomingRow, 'name' | 'affiliation' | 'phone' | 'note'>
  }[]
  removeIds?: (string | number)[]
  removePersonKeys?: string[]
}) {
  await ensureTable()
  const adds = (Array.isArray(params.adds) ? params.adds : [])
    .map(normalizeIncoming)
    .filter((r) => r.name)
  const updates = Array.isArray(params.updates) ? params.updates : []
  const personUpdates = Array.isArray(params.personUpdates) ? params.personUpdates : []
  const removeIds = (Array.isArray(params.removeIds) ? params.removeIds : [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)
  const removePersonKeys = (Array.isArray(params.removePersonKeys) ? params.removePersonKeys : [])
    .map((k) => String(k ?? '').trim())
    .filter(Boolean)

  await db.transaction(async (tx) => {
    if (removeIds.length) {
      await tx.delete(villagePatrol).where(inArray(villagePatrol.id, removeIds))
    }

    if (removePersonKeys.length) {
      const all = await tx.select().from(villagePatrol)
      const ids = all
        .filter((r) => removePersonKeys.includes(personKey(r.name ?? '', r.phone ?? '')))
        .map((r) => r.id)
      if (ids.length) {
        await tx.delete(villagePatrol).where(inArray(villagePatrol.id, ids))
      }
    }

    for (const u of updates) {
      const id = Number(u.id)
      if (!Number.isFinite(id) || id <= 0) continue
      const patch = u.patch ?? {}
      const set: Partial<typeof villagePatrol.$inferInsert> = {}
      if (patch.eup !== undefined) set.eup = String(patch.eup).trim()
      if (patch.village !== undefined) set.village = String(patch.village).trim()
      if (patch.team !== undefined) set.team = asTeam(String(patch.team).trim())
      if (patch.name !== undefined) set.name = String(patch.name).trim()
      if (patch.affiliation !== undefined) set.affiliation = String(patch.affiliation).trim()
      if (patch.phone !== undefined) set.phone = normalizePhone(patch.phone)
      if (patch.note !== undefined) set.note = String(patch.note).trim()
      if (Object.keys(set).length) {
        await tx.update(villagePatrol).set(set).where(eq(villagePatrol.id, id))
      }
    }

    if (personUpdates.length) {
      const all = await tx.select().from(villagePatrol)
      for (const pu of personUpdates) {
        const key = String(pu.key ?? '')
        if (!key) continue
        const patch = pu.patch ?? {}
        const targets = all.filter((r) => personKey(r.name ?? '', r.phone ?? '') === key)
        if (!targets.length) continue
        const set: Partial<typeof villagePatrol.$inferInsert> = {}
        if (patch.name !== undefined) set.name = String(patch.name).trim()
        if (patch.affiliation !== undefined) set.affiliation = String(patch.affiliation).trim()
        if (patch.phone !== undefined) set.phone = normalizePhone(patch.phone)
        if (patch.note !== undefined) set.note = String(patch.note).trim()
        if (!Object.keys(set).length) continue
        await tx
          .update(villagePatrol)
          .set(set)
          .where(
            inArray(
              villagePatrol.id,
              targets.map((t) => t.id)
            )
          )
      }
    }

    if (adds.length) await insertChunks(tx, adds)
  })

  return {
    rows: await fetchAll(),
    added: adds.length,
    updated: updates.length + personUpdates.length,
    removed: removeIds.length + removePersonKeys.length,
  }
}
