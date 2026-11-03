/**
 * 설비관리 탭 — 기존 설비 종류 기준.
 * tables.json define_table_kor_name 정확 일치 또는「{종류}현황」포함 시 활성.
 */
import tablesJson from '@/config/defineLayer/tables.json'
import type { WtlFacilityGroupOption } from '../facility/wtlFacilityCatalog'

/** 기존 설비관리 목업 종류 순서 */
export const EQUIPMENT_TABS = [
  '펌프',
  '모터',
  '밸브',
  '변압기',
  '염소투입설비',
  '수질계측기',
  '계측기',
  '여과장치',
  '흡수정',
] as const

export type EquipmentTab = (typeof EQUIPMENT_TABS)[number]

type TablesJsonRow = {
  define_table_name?: string
  define_table_kor_name?: string
  define_table_group?: string
  define_table_schema?: string
}

const ROWS = (Array.isArray(tablesJson) ? tablesJson : []) as TablesJsonRow[]

/** 한글명이 종류와 같거나「종류+현황」을 포함하면 매칭 (펌프장 등 시설명 제외) */
export function tableMatchesEquipmentKind(korName: string, kind: string): boolean {
  const kor = String(korName ?? '').trim()
  const k = String(kind ?? '').trim()
  if (!kor || !k) return false
  if (kor === k) return true
  if (kor.includes(`${k}현황`)) return true
  return false
}

export function isEquipmentTabEnabled(tab: string): boolean {
  const kind = String(tab ?? '').trim()
  if (!kind) return false
  return ROWS.some((r) =>
    tableMatchesEquipmentKind(String(r.define_table_kor_name ?? ''), kind)
  )
}

export function listEnabledEquipmentTabs(): EquipmentTab[] {
  return EQUIPMENT_TABS.filter((t) => isEquipmentTabEnabled(t))
}

/**
 * 종류에 매칭되는 레이어 옵션.
 * select 라벨은 한글명(가압장 펌프현황 등). 동일 한글명·그룹 중복 시 첫 테이블만.
 */
export function listEquipmentGroupOptions(kind: string): WtlFacilityGroupOption[] {
  const k = String(kind ?? '').trim()
  if (!k) return []
  const seen = new Set<string>()
  const out: WtlFacilityGroupOption[] = []
  for (const row of ROWS) {
    const kor = String(row.define_table_kor_name ?? '').trim()
    if (!tableMatchesEquipmentKind(kor, k)) continue
    const tableName = String(row.define_table_name ?? '')
      .trim()
      .toLowerCase()
    if (!tableName) continue
    const label = kor || tableName
    if (seen.has(label)) continue
    seen.add(label)
    out.push({
      group: label,
      tableName,
      schema:
        String(row.define_table_schema ?? '')
          .trim()
          .toLowerCase() || 'layer',
    })
  }
  return out
}

export function listAllEquipmentUndergroundTableNames(): string[] {
  const out = new Set<string>()
  for (const tab of EQUIPMENT_TABS) {
    for (const opt of listEquipmentGroupOptions(tab)) {
      if (opt.tableName) out.add(opt.tableName)
    }
  }
  return [...out]
}
