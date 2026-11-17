/**
 * 통합검색 — CODE 필드 한글명 → 저장 코드 매칭 (시설·관망 등 공통)
 */
import { readDefineLayerCodes } from '@/lib/defineLayerCodeFiles'
import { listHjdCdeCodes } from '@/lib/hjdCde'

export function isDefineCodeFieldType(typeRaw: unknown): boolean {
  const t = String(typeRaw ?? '')
    .trim()
    .toUpperCase()
  return t === 'CODE' || t.startsWith('CODE:')
}

/** CODE 필드 코드목록 — hjd_cde 는 유틸 파일, 그 외는 레이어별 codes */
export function loadDefineFieldCodesForKeyword(
  fieldsTable: string,
  fieldName: string
): Array<{ code: string; kor: string }> {
  const fn = String(fieldName ?? '').trim()
  if (!fn) return []
  if (fn.toLowerCase() === 'hjd_cde') {
    return listHjdCdeCodes().map((r) => ({
      code: String(r.define_code_name ?? '').trim(),
      kor: String(r.define_code_kor_name ?? '').trim(),
    }))
  }
  const tableField = `${fieldsTable}__${fn}`.replace(/[^a-zA-Z0-9_-]/g, '')
  const rows = readDefineLayerCodes(tableField)
  const out: Array<{ code: string; kor: string }> = []
  for (const row of rows) {
    const code = String(row.define_code_name ?? '').trim()
    if (!code) continue
    out.push({
      code,
      kor: String(row.define_code_kor_name ?? '').trim(),
    })
  }
  return out
}

/** 한글명(또는 코드값)에 keyword 포함 → DB 저장 코드 목록 (IN 절용, 상한 500) */
export function matchCodesByKeyword(
  codes: Array<{ code: string; kor: string }>,
  keyword: string
): string[] {
  const kw = String(keyword ?? '')
    .trim()
    .toLowerCase()
  if (!kw || codes.length === 0) return []
  const seen = new Set<string>()
  const matched: string[] = []
  for (const row of codes) {
    const code = row.code
    if (!code || seen.has(code)) continue
    const korLc = row.kor.toLowerCase()
    const codeLc = code.toLowerCase()
    if (!korLc.includes(kw) && !codeLc.includes(kw)) continue
    seen.add(code)
    matched.push(code)
    if (matched.length >= 500) break
  }
  return matched
}

/**
 * define CODE 필드 → `COALESCE(t."col"::text,'') IN (...)` SQL 조각들.
 * skipField: 컬럼 미존재 등 제외 (소문자 필드명).
 */
export function buildCodeKeywordInClauses(opts: {
  fieldsTable: string
  defineFields: Array<Record<string, unknown>>
  keyword: string
  esc: (s: string) => string
  /** 물리 컬럼명 해석. 없으면 define_field_name 그대로 */
  resolveCol?: (fieldName: string) => string | null
  skipField?: (fieldNameLower: string) => boolean
}): string[] {
  const keyword = String(opts.keyword ?? '').trim()
  if (!keyword || !opts.fieldsTable) return []
  const parts: string[] = []
  for (const f of opts.defineFields) {
    const fn = String(f.define_field_name ?? '').trim()
    if (!fn || !isDefineCodeFieldType(f.define_field_type)) continue
    const fnLc = fn.toLowerCase()
    if (opts.skipField?.(fnLc)) continue
    const col = opts.resolveCol ? opts.resolveCol(fn) : fn
    if (!col) continue
    const matched = matchCodesByKeyword(
      loadDefineFieldCodesForKeyword(opts.fieldsTable, fn),
      keyword
    )
    if (matched.length === 0) continue
    const inList = matched.map((c) => `'${opts.esc(c)}'`).join(', ')
    parts.push(
      `COALESCE(t."${col.replace(/"/g, '""')}"::text,'') IN (${inList})`
    )
  }
  return parts
}
