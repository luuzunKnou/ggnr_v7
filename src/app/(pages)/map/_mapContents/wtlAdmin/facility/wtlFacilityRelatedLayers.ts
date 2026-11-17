/**
 * 시설·설비관리 탭별 연관 레이어 — tables.json 패턴 resolve
 */
import tablesJson from '@/config/defineLayer/tables.json'
import adminTabsJson from '@/config/wtlAdmin/adminTabs.json'

type TablesJsonRow = {
  define_table_name?: string
  define_table_kor_name?: string
  define_table_group?: string
  define_table_schema?: string
  define_table_parents_layer?: string
}

const ROWS = (Array.isArray(tablesJson) ? tablesJson : []) as TablesJsonRow[]

const EQUIPMENT_TAB_NAMES: readonly string[] = (
  Array.isArray((adminTabsJson as { wtlEquipment?: unknown })?.wtlEquipment)
    ? ((adminTabsJson as { wtlEquipment: unknown[] }).wtlEquipment)
    : []
).map((t) =>
  String(t ?? '')
    .trim()
    .toLowerCase()
).filter(Boolean)

export type WtlFacilityRelatedRule =
  | { kind: 'parents'; parentPattern: string }
  | { kind: 'name'; pattern: string }

export type WtlFacilityRelatedLayer = {
  tableName: string
  korName: string
  schema: string
  /** define_table_parents_layer (소문자) */
  parentsLayer?: string
}

export type WtlFacilityRelatedCategoryGroup = {
  category: string
  layers: WtlFacilityRelatedLayer[]
}

/** 관로 계열 판별 패턴 */
export const PIPE_PARENT_PATTERN = '%wtl_pipe_lm'
export const SPLY_PIPE_PATTERN = '%wtl_sply_ls'
/** 관로 카테고리 표시명(상수관로·급수관로 공통) */
export const PIPE_CATEGORY = '관로'
export const RELATED_EQUIPMENT_CATEGORY = '관련 설비'
export const RELATED_FACILITY_CATEGORY = '관련 시설'

function normalize(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
}

/** `%foo` / `foo` → 기준 문자열 */
function patternCore(pattern: string): string {
  const p = normalize(pattern)
  return p.startsWith('%') ? p.slice(1) : p
}

/** LIKE %core 또는 %core% — 접미·포함·완전일치 */
function matchesNamePattern(tableName: string, pattern: string): boolean {
  const name = normalize(tableName)
  const core = patternCore(pattern)
  if (!name || !core) return false
  return name === core || name.endsWith(core) || name.includes(core)
}

function matchesParentsPattern(parentsLayer: string, pattern: string): boolean {
  const parents = normalize(parentsLayer)
  const core = patternCore(pattern)
  if (!parents || !core) return false
  return parents === core || parents.endsWith(core)
}

/**
 * 전 탭 공통 관로 4종 — 기타·배수·송수(parents of pipe_lm) + 급수.
 * 모관로(wtl_pipe_lm) 본체는 제외.
 */
export const PIPE_ALWAYS_RULES: readonly WtlFacilityRelatedRule[] = [
  { kind: 'parents', parentPattern: '%wtl_pipe_lm' },
  { kind: 'name', pattern: '%wtl_sply_ls' },
]

/** 관로 버튼 표시 순서: 기타 → 배수 → 송수 → 급수 */
const PIPE_DISPLAY_ORDER = [
  'wtl_pipe_lm_etc',
  'wtl_pipe_lm_saa004',
  'wtl_pipe_lm_saa003',
  'wtl_sply_ls',
] as const

/**
 * 시설 탭 → 연관 규칙(관련 시설·설비).
 * 관로는 PIPE_ALWAYS_RULES로 전 탭 공통(버튼 숨김·자동 ON). 직접 매칭은 Shell 자동 ON.
 */
export const FACILITY_RELATED_RULES: Record<string, readonly WtlFacilityRelatedRule[]> = {
  /** 취수장 — 관련 설비·시설 없음 */
  wtl_gain_ps: [],
  /** 정수장 — 관련 설비만(염소투입·수질계측·펌프). 관련 시설(유량계·수압계) 제외 */
  wtl_puri_as: [
    { kind: 'name', pattern: '%wtl_infeed_ps' },
    { kind: 'name', pattern: '%wtl_meter_ps' },
    { kind: 'name', pattern: '%wtl_puri_dt_ps' },
  ],
  /** 배수지 — 관련 없음 */
  wtl_serv_ps: [],
  /** 가압장 — 펌프·흡수정만 */
  wtl_pres_ps: [
    { kind: 'name', pattern: '%wtl_pres_pm_ps' },
    { kind: 'name', pattern: '%wtl_pres_hj_ps' },
  ],
  /** 저수조 — 관련 없음 */
  wtl_rsrv_ps: [],
  /** 소방시설 — 관련 없음 */
  wtl_fire_ps: [],
  /** 유량계 — 관련 없음 */
  wtl_flow_ps: [],
  /** 수압계 — 관련 없음 */
  wtl_prga_ps: [],
}

/**
 * 설비 탭 → 연관 규칙(관련 시설). 관로는 PIPE_ALWAYS_RULES 공통.
 * 시설 규칙에 해당 설비가 등장하는 시설을 역매핑.
 */
export const EQUIPMENT_RELATED_RULES: Record<string, readonly WtlFacilityRelatedRule[]> = {
  wtl_pres_hj_ps: [{ kind: 'name', pattern: '%wtl_pres_ps' }],
  wtl_pres_pm_ps: [{ kind: 'name', pattern: '%wtl_pres_ps' }],
  wtl_puri_dt_ps: [{ kind: 'name', pattern: '%wtl_puri_as' }],
  /** 염소투입설비 — 관련 시설: 정수장·배수지·가압장 */
  wtl_infeed_ps: [
    { kind: 'name', pattern: '%wtl_puri_as' },
    { kind: 'name', pattern: '%wtl_serv_ps' },
    { kind: 'name', pattern: '%wtl_pres_ps' },
  ],
  /** 수질계측기 — 관련 시설: 정수장·배수지·가압장 */
  wtl_meter_ps: [
    { kind: 'name', pattern: '%wtl_puri_as' },
    { kind: 'name', pattern: '%wtl_serv_ps' },
    { kind: 'name', pattern: '%wtl_pres_ps' },
  ],
  /** 관로만 — 망 전역 설비라 소속 시설 역매핑 없음 */
  wtl_valv_ps: [],
  /** 관로만 (소속 시설 규칙 없음) */
  ufl_btrs_ps: [],
}

function relatedRulesForTab(
  tabKey: string
): readonly WtlFacilityRelatedRule[] | null {
  if (Object.prototype.hasOwnProperty.call(FACILITY_RELATED_RULES, tabKey)) {
    return FACILITY_RELATED_RULES[tabKey] ?? []
  }
  if (Object.prototype.hasOwnProperty.call(EQUIPMENT_RELATED_RULES, tabKey)) {
    return EQUIPMENT_RELATED_RULES[tabKey] ?? []
  }
  return null
}

function rowsForGroup(defineTableGroup: string | null | undefined): TablesJsonRow[] {
  const g = String(defineTableGroup ?? '').trim()
  if (!g) return ROWS
  return ROWS.filter((r) => String(r.define_table_group ?? '').trim() === g)
}

function toLayer(row: TablesJsonRow): WtlFacilityRelatedLayer | null {
  const tableName = normalize(String(row.define_table_name ?? ''))
  if (!tableName) return null
  const korName = String(row.define_table_kor_name ?? '').trim() || tableName
  const schema =
    String(row.define_table_schema ?? '')
      .trim()
      .toLowerCase() || 'layer'
  const parentsLayer = normalize(String(row.define_table_parents_layer ?? ''))
  return {
    tableName,
    korName,
    schema,
    parentsLayer: parentsLayer || undefined,
  }
}

/** 상수관로(%wtl_pipe_lm)·급수관로(%wtl_sply_ls) → 관로 카테고리 */
function isPipeCategoryLayer(layer: WtlFacilityRelatedLayer): boolean {
  const parents = layer.parentsLayer ?? ''
  if (parents && matchesParentsPattern(parents, PIPE_PARENT_PATTERN)) return true
  if (matchesNamePattern(layer.tableName, PIPE_PARENT_PATTERN)) return true
  if (matchesNamePattern(layer.tableName, SPLY_PIPE_PATTERN)) return true
  return false
}

/** 설비관리 탭(adminTabs wtlEquipment)에 해당하는 레이어 → 관련 설비 */
function isEquipmentCategoryLayer(layer: WtlFacilityRelatedLayer): boolean {
  const name = normalize(layer.tableName)
  if (!name) return false
  return EQUIPMENT_TAB_NAMES.some(
    (tab) => name === tab || name.endsWith(tab) || name.includes(tab)
  )
}

function pipeDisplayRank(tableName: string): number {
  const name = normalize(tableName)
  const idx = PIPE_DISPLAY_ORDER.findIndex(
    (key) => name === key || name.endsWith(key)
  )
  return idx >= 0 ? idx : PIPE_DISPLAY_ORDER.length
}

/**
 * 연관 레이어 → 카테고리 그룹.
 * 1) 상수관로·급수관로 계열 → 관로(기타·배수·송수·급수 순)
 * 2) 설비관리 탭 계열 → 관련 설비
 * 3) 그 외 → 관련 시설
 */
export function groupRelatedLayersByCategory(
  layers: readonly WtlFacilityRelatedLayer[]
): WtlFacilityRelatedCategoryGroup[] {
  const pipe: WtlFacilityRelatedLayer[] = []
  const equipment: WtlFacilityRelatedLayer[] = []
  const related: WtlFacilityRelatedLayer[] = []

  for (const layer of layers) {
    if (isPipeCategoryLayer(layer)) pipe.push(layer)
    else if (isEquipmentCategoryLayer(layer)) equipment.push(layer)
    else related.push(layer)
  }

  pipe.sort(
    (a, b) => pipeDisplayRank(a.tableName) - pipeDisplayRank(b.tableName)
  )

  const out: WtlFacilityRelatedCategoryGroup[] = []
  if (pipe.length > 0) out.push({ category: PIPE_CATEGORY, layers: pipe })
  if (equipment.length > 0) {
    out.push({ category: RELATED_EQUIPMENT_CATEGORY, layers: equipment })
  }
  if (related.length > 0) {
    out.push({ category: RELATED_FACILITY_CATEGORY, layers: related })
  }
  return out
}

/**
 * 선택 탭·레이어 그룹 기준 연관 레이어 목록(직접 매칭 제외).
 * 그룹에 없는 후보는 제외(미표시).
 */
export function resolveRelatedLayers(
  tab: string | null | undefined,
  defineTableGroup?: string | null
): WtlFacilityRelatedLayer[] {
  const tabKey = normalize(String(tab ?? ''))
  const rules = relatedRulesForTab(tabKey)
  if (rules == null) return []

  const scope = rowsForGroup(defineTableGroup)
  const tabKor =
    String(
      ROWS.find((r) => normalize(String(r.define_table_name ?? '')) === tabKey)
        ?.define_table_kor_name ?? ''
    ).trim()
  const seen = new Set<string>()
  const out: WtlFacilityRelatedLayer[] = []

  const pushRow = (row: TablesJsonRow) => {
    const layer = toLayer(row)
    if (!layer || seen.has(layer.tableName)) return
    // 탭 시설·동일 한글명(직접 매칭)은 버튼에 넣지 않음
    if (layer.tableName === tabKey) return
    if (tabKor && layer.korName === tabKor) return
    seen.add(layer.tableName)
    out.push(layer)
  }

  const applyRules = (ruleList: readonly WtlFacilityRelatedRule[]) => {
    for (const rule of ruleList) {
      if (rule.kind === 'parents') {
        for (const row of scope) {
          const parents = String(row.define_table_parents_layer ?? '')
          if (!matchesParentsPattern(parents, rule.parentPattern)) continue
          pushRow(row)
        }
        continue
      }
      for (const row of scope) {
        const name = String(row.define_table_name ?? '')
        if (!matchesNamePattern(name, rule.pattern)) continue
        pushRow(row)
      }
    }
  }

  // 관로 4종 공통 → 탭별 관련 시설·설비
  applyRules(PIPE_ALWAYS_RULES)
  if (rules.length > 0) applyRules(rules)

  return out
}

/** 전 탭·전 그룹 연관 후보 테이블명 — managed underground 정리용 */
export function listAllRelatedUndergroundTableNames(
  tabs: readonly string[]
): string[] {
  const out = new Set<string>()
  const groups = new Set<string>()
  for (const row of ROWS) {
    const g = String(row.define_table_group ?? '').trim()
    if (g) groups.add(g)
  }
  // 그룹 미지정 전체도 한 번
  const groupList = groups.size > 0 ? [...groups, ''] : ['']
  for (const tab of tabs) {
    for (const g of groupList) {
      for (const layer of resolveRelatedLayers(tab, g || null)) {
        out.add(layer.tableName)
      }
    }
  }
  return [...out]
}
