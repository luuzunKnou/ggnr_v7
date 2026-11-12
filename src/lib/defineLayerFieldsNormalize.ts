/** define_field_show_* 계열 — true / 'true' / '1' */
function isShowFlagTrue(v: unknown): boolean {
  if (v === true) return true
  const s = String(v ?? '').trim().toLowerCase()
  return s === 'true' || s === '1'
}

function filledFieldCount(row: Record<string, unknown>): number {
  let n = 0
  for (const v of Object.values(row)) {
    if (v == null) continue
    if (String(v).trim() === '') continue
    n += 1
  }
  return n
}

const SHOW_FLAG_KEYS = [
  'define_field_show_search',
  'define_field_show_list',
  'define_field_show_detail',
  'define_field_show_search_detail',
  'define_field_show_detail_list',
  'define_field_show_title',
  'define_field_is_required',
  'define_field_read_only',
  'define_field_is_key',
] as const

/**
 * 동일 define_field_name(대소문자 무시) 중복 제거.
 * JSON에 같은 필드가 여러 번 있어도 목록·상세 React key 충돌을 막는다.
 * show/flag 는 OR 병합, 그 외는 값이 더 채워진 행을 기준으로 한다.
 */
export function dedupeDefineLayerFieldsByName<T extends Record<string, unknown>>(
  fields: T[]
): T[] {
  if (!Array.isArray(fields) || fields.length === 0) return fields

  const seen = new Map<string, number>()
  const out: T[] = []

  for (const row of fields) {
    const name = String(row.define_field_name ?? '').trim().toLowerCase()
    if (!name) {
      out.push(row)
      continue
    }
    const prevIdx = seen.get(name)
    if (prevIdx == null) {
      seen.set(name, out.length)
      out.push(row)
      continue
    }

    const prev = out[prevIdx]!
    const preferIncoming = filledFieldCount(row) > filledFieldCount(prev)
    const base = preferIncoming ? { ...row } : { ...prev }
    const other = preferIncoming ? prev : row

    for (const key of SHOW_FLAG_KEYS) {
      if (isShowFlagTrue(prev[key]) || isShowFlagTrue(row[key])) {
        ;(base as Record<string, unknown>)[key] = true
      } else if (key in other && !(key in base)) {
        ;(base as Record<string, unknown>)[key] = other[key]
      }
    }

    const prevKor = String(prev.define_field_kor_name ?? '').trim()
    const nextKor = String(row.define_field_kor_name ?? '').trim()
    if (!String(base.define_field_kor_name ?? '').trim()) {
      ;(base as Record<string, unknown>).define_field_kor_name = nextKor || prevKor
    } else if (
      String(base.define_field_kor_name ?? '').trim().toLowerCase() === name &&
      (nextKor || prevKor) &&
      (nextKor || prevKor).toLowerCase() !== name
    ) {
      ;(base as Record<string, unknown>).define_field_kor_name = nextKor || prevKor
    }

    out[prevIdx] = base as T
  }

  return out
}
