/**
 * 시설관리 그룹·활성 판별 — 탭 키는 adminTabs.json wtlFacility(영문 테이블명)
 */
import tablesJson from '@/config/defineLayer/tables.json'

export type WtlFacilityGroupOption = {
  /** select 표시·값 (시설: define_table_group / 설비: 한글명) */
  group: string
  tableName: string
  schema: string
  /** tables.json define_table_group — 위치필터(상수) 판별용 */
  defineTableGroup: string
}

/** 레이어 그룹명이 상수 계열인지 (위치: 읍면동·리·급수블록) */
export function isSangsuLayerGroup(opt: WtlFacilityGroupOption | null | undefined): boolean {
  const g = String(opt?.defineTableGroup ?? opt?.group ?? '').trim()
  return g.includes('상수')
}

type TablesJsonRow = {
  define_table_name?: string
  define_table_kor_name?: string
  define_table_group?: string
  define_table_schema?: string
}

const ROWS = (Array.isArray(tablesJson) ? tablesJson : []) as TablesJsonRow[]

function normalizeTableName(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
}

/** define_table_name → 한글명 (없으면 영문명 그대로) */
export function facilityTabLabel(tableName: string): string {
  const want = normalizeTableName(tableName)
  if (!want) return ''
  for (const row of ROWS) {
    if (normalizeTableName(String(row.define_table_name ?? '')) !== want) continue
    const kor = String(row.define_table_kor_name ?? '').trim()
    if (kor) return kor
  }
  return String(tableName ?? '').trim()
}

function korNameForTable(tableName: string): string | null {
  const want = normalizeTableName(tableName)
  if (!want) return null
  for (const row of ROWS) {
    if (normalizeTableName(String(row.define_table_name ?? '')) !== want) continue
    const kor = String(row.define_table_kor_name ?? '').trim()
    if (kor) return kor
  }
  return null
}

/** 영문 테이블명이 tables.json에 있으면 활성 */
export function isFacilityTabEnabled(tab: string): boolean {
  const want = normalizeTableName(tab)
  if (!want) return false
  return ROWS.some((r) => normalizeTableName(String(r.define_table_name ?? '')) === want)
}

export function listEnabledFacilityTabs(tabs: readonly string[]): string[] {
  return tabs.filter((t) => isFacilityTabEnabled(t))
}

/**
 * 탭(영문 테이블명)의 한글명과 동일한 레이어들의 그룹 options.
 * 그룹 중복 시 첫 테이블.
 */
export function listFacilityGroupOptions(tableName: string): WtlFacilityGroupOption[] {
  const kor = korNameForTable(tableName)
  if (!kor) return []
  const seen = new Set<string>()
  const out: WtlFacilityGroupOption[] = []
  for (const row of ROWS) {
    if (String(row.define_table_kor_name ?? '').trim() !== kor) continue
    const group = String(row.define_table_group ?? '').trim() || '(미분류)'
    const name = normalizeTableName(String(row.define_table_name ?? ''))
    if (!name || seen.has(group)) continue
    seen.add(group)
    out.push({
      group,
      tableName: name,
      schema:
        String(row.define_table_schema ?? '')
          .trim()
          .toLowerCase() || 'layer',
      defineTableGroup: group,
    })
  }
  return out
}

/** 시설관리가 지하시설물 visible에서 관리하는 테이블명(전 탭·그룹) */
export function listAllFacilityUndergroundTableNames(tabs: readonly string[]): string[] {
  const out = new Set<string>()
  for (const tab of tabs) {
    for (const opt of listFacilityGroupOptions(tab)) {
      if (opt.tableName) out.add(opt.tableName)
    }
  }
  return [...out]
}
