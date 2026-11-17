/**
 * 설비관리 그룹·활성 판별 — 탭 키는 adminTabs.json wtlEquipment(영문 테이블명)
 */
import tablesJson from '@/config/defineLayer/tables.json'
import type { WtlFacilityGroupOption } from '../facility/wtlFacilityCatalog'

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
export function equipmentTabLabel(tableName: string): string {
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
export function isEquipmentTabEnabled(tab: string): boolean {
  const want = normalizeTableName(tab)
  if (!want) return false
  return ROWS.some((r) => normalizeTableName(String(r.define_table_name ?? '')) === want)
}

export function listEnabledEquipmentTabs(tabs: readonly string[]): string[] {
  return tabs.filter((t) => isEquipmentTabEnabled(t))
}

/**
 * 탭(영문 테이블명) 한글명과 동일한 레이어들의 define_table_group 모음.
 * 동일 그룹 중복 시 첫 테이블만 (시설관리와 동일).
 */
export function listEquipmentGroupOptions(tableName: string): WtlFacilityGroupOption[] {
  const kor = korNameForTable(tableName)
  if (!kor) return []
  const seen = new Set<string>()
  const out: WtlFacilityGroupOption[] = []
  for (const row of ROWS) {
    if (String(row.define_table_kor_name ?? '').trim() !== kor) continue
    const name = normalizeTableName(String(row.define_table_name ?? ''))
    if (!name) continue
    const defineTableGroup = String(row.define_table_group ?? '').trim() || '(미분류)'
    if (seen.has(defineTableGroup)) continue
    seen.add(defineTableGroup)
    out.push({
      group: defineTableGroup,
      tableName: name,
      schema:
        String(row.define_table_schema ?? '')
          .trim()
          .toLowerCase() || 'layer',
      defineTableGroup,
    })
  }
  return out
}

export function listAllEquipmentUndergroundTableNames(tabs: readonly string[]): string[] {
  const out = new Set<string>()
  for (const tab of tabs) {
    for (const opt of listEquipmentGroupOptions(tab)) {
      if (opt.tableName) out.add(opt.tableName)
    }
  }
  return [...out]
}
