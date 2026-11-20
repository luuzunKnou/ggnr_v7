/** 상하수도 민원 대장 테이블 — 업무 분류·시스템 범위 */

export const COMPLAINT_CATEGORY_LABELS = ['전체', '상수', '하수', '급수', '준설'] as const
export type ComplaintCategoryLabel = (typeof COMPLAINT_CATEGORY_LABELS)[number]
export type ComplaintCategoryTab = Exclude<ComplaintCategoryLabel, never>

export type WaterComplaintSystemScope = 'wtl' | 'swl' | 'all'

const WTL_SYSTEM_KEYS = new Set(['wtl', 'wtladmin'])
const SWL_SYSTEM_KEYS = new Set(['swl', 'swladmin'])

export function waterComplaintSystemScope(systemKey: string | null | undefined): WaterComplaintSystemScope {
  const key = String(systemKey ?? '')
    .trim()
    .toLowerCase()
  if (WTL_SYSTEM_KEYS.has(key)) return 'wtl'
  if (SWL_SYSTEM_KEYS.has(key)) return 'swl'
  return 'all'
}

export function complaintCategoryTabsForSystem(
  scope: WaterComplaintSystemScope
): readonly ComplaintCategoryLabel[] {
  if (scope === 'wtl') return ['전체', '상수', '급수']
  if (scope === 'swl') return ['전체', '하수', '준설']
  return COMPLAINT_CATEGORY_LABELS
}

/** 테이블명 → 업무 분류 (detail 제외) */
export function complaintCategoryFromTableName(tableName: string): Exclude<ComplaintCategoryLabel, '전체'> | null {
  const name = String(tableName ?? '').toLowerCase()
  if (!name || name.includes('_detail')) return null
  if (name.includes('sply') || name.endsWith('_sply')) return '급수'
  if (name.includes('dre') && name.includes('complaint')) return '준설'
  if (name.includes('swl') || (name.includes('complaint') && name.endsWith('_swl'))) return '하수'
  if (name.includes('wtl') || (name.includes('complaint') && name.endsWith('_wtl'))) return '상수'
  return null
}

export function complaintTableMatchesCategory(
  tableName: string,
  category: ComplaintCategoryLabel
): boolean {
  if (category === '전체') return true
  return complaintCategoryFromTableName(tableName) === category
}

export function complaintTablesInSystemScope(
  tableNames: string[],
  scope: WaterComplaintSystemScope
): string[] {
  const scoped =
    scope === 'all'
      ? tableNames
      : tableNames.filter((table) => {
          const cat = complaintCategoryFromTableName(table)
          if (!cat) return false
          if (scope === 'wtl') return cat === '상수' || cat === '급수'
          return cat === '하수' || cat === '준설'
        })
  return scoped
}

export function defaultComplaintTableForCategory(
  tables: string[],
  category: ComplaintCategoryLabel
): string | null {
  if (tables.length === 0) return null
  if (category === '전체') return tables[0] ?? null
  const hit = tables.find((t) => complaintCategoryFromTableName(t) === category)
  return hit ?? tables[0] ?? null
}

export function complaintMapLayerIdsForTables(tableNames: string[]): string[] {
  const ids = new Set<string>()
  for (const table of tableNames) {
    const name = String(table ?? '').trim().toLowerCase()
    if (!name) continue
    ids.add(name)
    if (name.includes('complaint_dre') && !name.includes('detail')) {
      ids.add('complaint_dre_detail')
    }
  }
  return [...ids]
}

export function complaintMenuLabelForTable(tableName: string): string {
  const cat = complaintCategoryFromTableName(tableName)
  if (cat === '상수') return '상수민원'
  if (cat === '급수') return '급수민원'
  if (cat === '하수') return '하수민원'
  if (cat === '준설') return '준설민원'
  return '민원'
}

/** 세부분류 문자열 → 카드 #태그 (· , / | 공백 구분) */
export function parseComplaintCatTags(compCat: string | null | undefined): string[] {
  const raw = String(compCat ?? '').trim()
  if (!raw) return []
  return raw
    .split(/[,·/|]+|\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

/** 접수일자 내림차순 → 같은 일자면 key 내림차순. 일자 없음은 뒤로. */
export function compareComplaintListRows(
  a: { compDate?: string | null; compKey: number },
  b: { compDate?: string | null; compKey: number }
): number {
  const dateA = String(a.compDate ?? '').trim().slice(0, 10)
  const dateB = String(b.compDate ?? '').trim().slice(0, 10)
  if (dateA !== dateB) {
    if (!dateA) return 1
    if (!dateB) return -1
    return dateB.localeCompare(dateA)
  }
  return b.compKey - a.compKey
}
