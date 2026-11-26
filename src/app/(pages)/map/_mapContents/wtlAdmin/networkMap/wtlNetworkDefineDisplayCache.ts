import {
  isDefineFieldCodeType,
  type DefineCodeRow,
} from '@/lib/defineLayerCodeDisplay'
import { dedupeDefineLayerFieldsByName } from '@/lib/defineLayerFieldsNormalize'
import { appFetch } from '@/lib/basePath'
import type { DefineFieldLike } from '../../../_mapComponents/standard/defineLayerRowUtils'

export type WtlDefineDisplayBundle = {
  fields: DefineFieldLike[]
  codesByField: Record<string, DefineCodeRow[]>
  /** 실제 fields를 가져온 테이블명 */
  resolvedTable: string
}

const bundleCache = new Map<string, WtlDefineDisplayBundle>()
const inflight = new Map<string, Promise<WtlDefineDisplayBundle>>()

function cacheKey(table: string, fallback?: string | null): string {
  const primary = String(table ?? '').trim().toLowerCase()
  const fb = String(fallback ?? '').trim().toLowerCase()
  return fb && fb !== primary ? `${primary}\0${fb}` : primary
}

function tablesToTry(table: string, fallback?: string | null): string[] {
  const primary = String(table ?? '').trim()
  const fb = String(fallback ?? '').trim()
  const out: string[] = []
  if (primary) out.push(primary)
  if (fb && fb.toLowerCase() !== primary.toLowerCase()) out.push(fb)
  return out
}

type FetchFieldsResult =
  | { ok: true; fields: DefineFieldLike[] }
  | { ok: false; fields: [] }

async function fetchFields(table: string): Promise<FetchFieldsResult> {
  try {
    const res = await appFetch(
      `/api/config/defineLayer/fields/${encodeURIComponent(table)}`
    )
    if (!res.ok) return { ok: false, fields: [] }
    const body = (await res.json()) as { data?: DefineFieldLike[] }
    return {
      ok: true,
      fields: Array.isArray(body?.data) ? body.data : [],
    }
  } catch {
    return { ok: false, fields: [] }
  }
}

async function fetchCodes(tableFieldKey: string): Promise<DefineCodeRow[]> {
  try {
    const res = await appFetch(
      `/api/config/defineLayer/codes/${encodeURIComponent(tableFieldKey)}`
    )
    if (!res.ok) return []
    const body = (await res.json()) as { data?: DefineCodeRow[] }
    return Array.isArray(body?.data) ? body.data : []
  } catch {
    return []
  }
}

/** hjd_cde_CODE.json (서버 유틸) — 테이블별 축소 CODE보다 우선 */
let hjdCodesInflight: Promise<DefineCodeRow[]> | null = null
let hjdCodesCache: DefineCodeRow[] | null = null

async function loadHjdCdeCodes(): Promise<DefineCodeRow[]> {
  if (hjdCodesCache) return hjdCodesCache
  if (hjdCodesInflight) return hjdCodesInflight
  hjdCodesInflight = fetchCodes('hjd_cde')
    .then((codes) => {
      hjdCodesCache = codes
      return codes
    })
    .finally(() => {
      hjdCodesInflight = null
    })
  return hjdCodesInflight
}

async function loadCodesForField(
  tables: string[],
  fieldName: string
): Promise<DefineCodeRow[]> {
  const exact = String(fieldName ?? '').trim()
  if (!exact) return []
  if (exact.toLowerCase() === 'hjd_cde') {
    const hjd = await loadHjdCdeCodes()
    if (hjd.length > 0) return hjd
  }
  for (const table of tables) {
    const codes = await fetchCodes(`${table}__${exact}`)
    if (codes.length > 0) return codes
  }
  return []
}

export function peekWtlDefineDisplayBundle(
  table: string | null | undefined,
  fallback?: string | null
): WtlDefineDisplayBundle | null {
  const key = cacheKey(String(table ?? ''), fallback)
  if (!key) return null
  return bundleCache.get(key) ?? null
}

/** table_*.json + CODE 한글 맵을 한 번 로드해 캐시. 동일 키는 재사용 */
export function loadWtlDefineDisplayBundle(
  table: string | null | undefined,
  fallback?: string | null
): Promise<WtlDefineDisplayBundle> {
  const primary = String(table ?? '').trim()
  const key = cacheKey(primary, fallback)
  if (!key) {
    return Promise.resolve({ fields: [], codesByField: {}, resolvedTable: '' })
  }
  const hit = bundleCache.get(key)
  if (hit) return Promise.resolve(hit)
  const pending = inflight.get(key)
  if (pending) return pending

  const task = (async (): Promise<WtlDefineDisplayBundle> => {
    const tryTables = tablesToTry(primary, fallback)
    let fields: DefineFieldLike[] = []
    let resolvedTable = primary
    let anyOk = false
    for (const t of tryTables) {
      const result = await fetchFields(t)
      if (result.ok) anyOk = true
      if (result.fields.length > 0) {
        fields = dedupeDefineLayerFieldsByName(
          result.fields as Array<DefineFieldLike & Record<string, unknown>>
        )
        resolvedTable = t
        break
      }
    }
    const codeNames = fields
      .filter((f) => isDefineFieldCodeType(f.define_field_type))
      .map((f) => String(f.define_field_name ?? '').trim())
      .filter(Boolean)
    const codesByField: Record<string, DefineCodeRow[]> = {}
    if (codeNames.length > 0) {
      const entries = await Promise.all(
        codeNames.map(async (name) => {
          const codes = await loadCodesForField(tryTables, name)
          return [name.toLowerCase(), codes] as const
        })
      )
      for (const [k, codes] of entries) codesByField[k] = codes
    }
    const bundle: WtlDefineDisplayBundle = { fields, codesByField, resolvedTable }
    // 일시적 404·네트워크 실패는 빈 결과로 캐시하지 않음 (한글화·show_list 누락 방지)
    if (fields.length > 0 || anyOk) {
      bundleCache.set(key, bundle)
    }
    return bundle
  })().finally(() => {
    inflight.delete(key)
  })

  inflight.set(key, task)
  return task
}

/** 관망조회에서 쓸 테이블 묶음을 백그라운드로 미리 채움 */
export function prefetchWtlDefineDisplayBundles(tables: readonly string[]): void {
  const seen = new Set<string>()
  for (const raw of tables) {
    const t = String(raw ?? '').trim()
    if (!t) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    void loadWtlDefineDisplayBundle(t)
  }
}
