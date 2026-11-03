/**
 * 시설관리 탭·그룹 — tables.json define_table_kor_name 정확 일치
 */
import tablesJson from '@/config/defineLayer/tables.json'

export const FACILITY_TABS = [
  '취수장',
  '정수장',
  '배수지',
  '가압장',
  '저수조',
  '소방시설',
  '유량계',
  '수압계',
  '감압변',
  'CCTV',
] as const

export type FacilityTab = (typeof FACILITY_TABS)[number]

export type WtlFacilityGroupOption = {
  group: string
  tableName: string
  schema: string
}

type TablesJsonRow = {
  define_table_name?: string
  define_table_kor_name?: string
  define_table_group?: string
  define_table_schema?: string
}

const ROWS = (Array.isArray(tablesJson) ? tablesJson : []) as TablesJsonRow[]

/** 탭 라벨과 한글명이 일치하는 행이 하나라도 있으면 활성 */
export function isFacilityTabEnabled(tab: string): boolean {
  const label = String(tab ?? '').trim()
  if (!label) return false
  return ROWS.some((r) => String(r.define_table_kor_name ?? '').trim() === label)
}

export function listEnabledFacilityTabs(): FacilityTab[] {
  return FACILITY_TABS.filter((t) => isFacilityTabEnabled(t))
}

/** 동일 한글명의 그룹 options (그룹 중복 시 첫 테이블) */
export function listFacilityGroupOptions(korName: string): WtlFacilityGroupOption[] {
  const kor = String(korName ?? '').trim()
  if (!kor) return []
  const seen = new Set<string>()
  const out: WtlFacilityGroupOption[] = []
  for (const row of ROWS) {
    if (String(row.define_table_kor_name ?? '').trim() !== kor) continue
    const group = String(row.define_table_group ?? '').trim() || '(미분류)'
    const tableName = String(row.define_table_name ?? '')
      .trim()
      .toLowerCase()
    if (!tableName || seen.has(group)) continue
    seen.add(group)
    out.push({
      group,
      tableName,
      schema:
        String(row.define_table_schema ?? '')
          .trim()
          .toLowerCase() || 'layer',
    })
  }
  return out
}

/** 시설관리가 지하시설물 visible에서 관리하는 테이블명(전 탭·그룹) */
export function listAllFacilityUndergroundTableNames(): string[] {
  const out = new Set<string>()
  for (const tab of FACILITY_TABS) {
    for (const opt of listFacilityGroupOptions(tab)) {
      if (opt.tableName) out.add(opt.tableName)
    }
  }
  return [...out]
}
