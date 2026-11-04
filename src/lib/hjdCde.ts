import fs from 'fs'
import path from 'path'
import { sql } from 'drizzle-orm'
import { db } from '@/database/db'

export type HjdCdeCodeRow = {
  define_code_key?: string
  define_code_field_key?: string
  define_code_name: string
  define_code_kor_name: string
}

const HJD_CODE_FILE = 'hjd_cde_CODE.json'

let allCodesCache: HjdCdeCodeRow[] | null = null
let labelMapCache: Map<string, string> | null = null

function normalizeCodeKey(raw: string): string {
  const s = raw.trim().toLowerCase()
  if (/^-?\d+\.0+$/.test(s)) return s.replace(/\.0+$/, '')
  return s
}

function readHjdCdeCodeFile(): HjdCdeCodeRow[] {
  if (allCodesCache) return allCodesCache
  try {
    const p = path.join(process.cwd(), 'src', 'config', 'defineLayer', 'codes', HJD_CODE_FILE)
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as unknown
    const rows = Array.isArray(raw) ? raw : []
    const out: HjdCdeCodeRow[] = []
    for (const row of rows) {
      const r = row as Record<string, unknown>
      const name = String(r.define_code_name ?? '').trim()
      if (!name) continue
      out.push({
        define_code_key: String(r.define_code_key ?? '').trim() || undefined,
        define_code_field_key: String(r.define_code_field_key ?? '').trim() || undefined,
        define_code_name: name,
        define_code_kor_name: String(r.define_code_kor_name ?? '').trim(),
      })
    }
    allCodesCache = out
    return out
  } catch {
    allCodesCache = []
    return allCodesCache
  }
}

function buildLabelMap(codes: readonly HjdCdeCodeRow[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of codes) {
    const name = String(row.define_code_name ?? '').trim()
    if (!name) continue
    const kor = String(row.define_code_kor_name ?? '').trim()
    map.set(normalizeCodeKey(name), kor || name)
  }
  return map
}

function getFullLabelMap(): Map<string, string> {
  if (labelMapCache) return labelMapCache
  labelMapCache = buildLabelMap(readHjdCdeCodeFile())
  return labelMapCache
}

/** public_layer.sgg 의 distinct adm_sect_c */
export async function fetchPublicLayerAdmSectCValues(): Promise<string[]> {
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT DISTINCT trim(adm_sect_c::text) AS adm_sect_c
         FROM public_layer.sgg
         WHERE adm_sect_c IS NOT NULL
           AND trim(adm_sect_c::text) <> ''
         ORDER BY 1`
      )
    )
    const out: string[] = []
    const seen = new Set<string>()
    for (const row of res.rows ?? []) {
      const v = String((row as { adm_sect_c?: unknown }).adm_sect_c ?? '').trim()
      if (!v || seen.has(v)) continue
      seen.add(v)
      out.push(v)
    }
    return out
  } catch {
    return []
  }
}

/**
 * 현재 sgg(adm_sect_c)에 맞는 hjd_cde 목록.
 * public_layer.sgg.adm_sect_c 로 시작하는 define_code_name 만 반환.
 */
export async function fetchHjdCdeCodesForCurrentSgg(): Promise<HjdCdeCodeRow[]> {
  const prefixes = await fetchPublicLayerAdmSectCValues()
  const all = readHjdCdeCodeFile()
  if (prefixes.length === 0) return []

  const seen = new Set<string>()
  const out: HjdCdeCodeRow[] = []
  for (const row of all) {
    const name = row.define_code_name
    if (!prefixes.some((p) => name.startsWith(p))) continue
    const key = normalizeCodeKey(name)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

/** hjd_cde_CODE.json 전체 행 (표시·API용) */
export function listHjdCdeCodes(): HjdCdeCodeRow[] {
  return readHjdCdeCodeFile()
}

/**
 * hjd_cde 한글화.
 * codes를 넘기면 그 목록에서, 없으면 hjd_cde_CODE.json 전체에서 조회.
 * 일치 항목 없으면 원문 문자열 반환.
 */
export function toHjdCdeKorName(
  value: unknown,
  codes?: readonly HjdCdeCodeRow[]
): string {
  const raw = value == null ? '' : String(value).trim()
  if (!raw) return raw
  const map = codes ? buildLabelMap(codes) : getFullLabelMap()
  return map.get(normalizeCodeKey(raw)) ?? raw
}
