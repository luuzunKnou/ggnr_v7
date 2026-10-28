/**
 * 지자체(GGNR_PROJECT)별 코드 분할 설정.
 * tables.json 공통 정의 위에 프로젝트 오버레이로 자식 레이어를 교체한다.
 */
import fs from 'node:fs'
import path from 'node:path'

import {
  isSplitLayerCode,
  isSplitLayerParent,
  splitChildLayerName,
  splitCodeDivQuery,
  splitEtcDivQuery,
  splitEtcLayerName,
  splitLayerColumn,
  SPLIT_LAYER_COLUMNS,
} from '@/lib/splitLayerTargets'

export const PROJECT_SPLIT_DIR = path.join(
  process.cwd(),
  'src',
  'config',
  'defineLayer',
  'split'
)

export type ProjectSplitItem = {
  code: string
  /** 레이어 한글명. 비우면 부모한글(코드한글) */
  korName?: string
  /** 레이어 그룹. 비우면 부모 그룹 */
  group?: string
  idx?: string
}

export type ProjectSplitEtc = {
  korName?: string
  group?: string
  idx?: string
}

export type ProjectSplitParentConfig = {
  items: ProjectSplitItem[]
  etc?: ProjectSplitEtc
}

/** 부모 테이블명 → 분할 설정 */
export type ProjectSplitConfig = Record<string, ProjectSplitParentConfig>

type TableRow = Record<string, unknown>

/** 빈값만 미설정. 0 포함 숫자 문자열은 레이어 설정 순번으로 인정 */
function meaningfulDefineIdx(value: unknown): string {
  return String(value ?? '').trim()
}

function sanitizeProjectId(project: string): string {
  return String(project ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
}

export function getCurrentGgnrProject(): string | null {
  const project = sanitizeProjectId(process.env.GGNR_PROJECT ?? '')
  return project || null
}

export function getProjectSplitConfigPath(project?: string | null): string | null {
  const id = sanitizeProjectId(project ?? getCurrentGgnrProject() ?? '')
  if (!id) return null
  return path.join(PROJECT_SPLIT_DIR, `${id}.json`)
}

export function readProjectSplitConfig(project?: string | null): ProjectSplitConfig {
  const filePath = getProjectSplitConfigPath(project)
  if (!filePath || !fs.existsSync(filePath)) return {}
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return normalizeProjectSplitConfig(parsed as Record<string, unknown>)
  } catch {
    return {}
  }
}

export function writeProjectSplitConfig(
  config: ProjectSplitConfig,
  project?: string | null
): { success: true; path: string } | { success: false; error: string } {
  const filePath = getProjectSplitConfigPath(project)
  if (!filePath) {
    return { success: false, error: 'GGNR_PROJECT가 없어 프로젝트 분할 설정을 저장할 수 없습니다.' }
  }
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const normalized = normalizeProjectSplitConfig(config)
    fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf-8')
    return { success: true, path: filePath }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function normalizeProjectSplitConfig(raw: Record<string, unknown>): ProjectSplitConfig {
  const out: ProjectSplitConfig = {}
  for (const [parentRaw, value] of Object.entries(raw)) {
    const parent = String(parentRaw ?? '')
      .trim()
      .toLowerCase()
    if (!parent || !isSplitLayerParent(parent)) continue
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const entry = value as Record<string, unknown>
    const itemsRaw = Array.isArray(entry.items) ? entry.items : []
    const items: ProjectSplitItem[] = []
    const seen = new Set<string>()
    for (const item of itemsRaw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const row = item as Record<string, unknown>
      const code = String(row.code ?? '').trim()
      if (!isSplitLayerCode(code)) continue
      const id = code.toLowerCase()
      if (seen.has(id)) continue
      seen.add(id)
      const korName = String(row.korName ?? '').trim()
      const group = String(row.group ?? '').trim()
      const idx = String(row.idx ?? '').trim()
      items.push({
        code,
        ...(korName ? { korName } : {}),
        ...(group ? { group } : {}),
        ...(idx ? { idx } : {}),
      })
    }
    if (items.length === 0) continue
    const etcRaw =
      entry.etc && typeof entry.etc === 'object' && !Array.isArray(entry.etc)
        ? (entry.etc as Record<string, unknown>)
        : null
    const etc: ProjectSplitEtc | undefined = etcRaw
      ? {
          ...(String(etcRaw.korName ?? '').trim()
            ? { korName: String(etcRaw.korName).trim() }
            : {}),
          ...(String(etcRaw.group ?? '').trim() ? { group: String(etcRaw.group).trim() } : {}),
          ...(String(etcRaw.idx ?? '').trim() ? { idx: String(etcRaw.idx).trim() } : {}),
        }
      : undefined
    out[parent] = { items, ...(etc && Object.keys(etc).length > 0 ? { etc } : {}) }
  }
  return out
}

function rowName(row: TableRow): string {
  return String(row.define_table_name ?? '')
    .trim()
    .toLowerCase()
}

/**
 * 코드 분할 UI가 관리하는 자식(기타·코드 suffix).
 * `…_old`처럼 숫자 없는 커스텀 분할은 제외한다.
 */
export function isManagedCodeSplitChildRow(row: TableRow, parent: string): boolean {
  if (String(row.define_table_parents_layer ?? '').trim().toLowerCase() !== parent) return false
  const name = rowName(row)
  const prefix = `${parent}_`
  if (!name.startsWith(prefix)) return false
  const suffix = name.slice(prefix.length)
  if (suffix === 'etc') return true
  return isSplitLayerCode(suffix) && /\d/.test(suffix)
}

function buildChildRow(
  parentRow: TableRow,
  parent: string,
  name: string,
  korName: string,
  divQuery: string,
  group: string,
  idx: string,
  existing: TableRow | undefined
): TableRow {
  const base = existing ?? parentRow
  return {
    define_table_name: name,
    define_table_kor_name: korName,
    define_table_shp_type: String(base.define_table_shp_type ?? parentRow.define_table_shp_type ?? ''),
    define_table_read_share: String(
      base.define_table_read_share ?? parentRow.define_table_read_share ?? 'P'
    ),
    define_table_write_share: String(
      base.define_table_write_share ?? parentRow.define_table_write_share ?? 'P'
    ),
    define_table_group: group,
    define_table_idx: idx,
    define_table_etc: existing ? String(existing.define_table_etc ?? '') : '',
    define_table_schema: String(base.define_table_schema ?? parentRow.define_table_schema ?? 'layer'),
    define_table_source: String(base.define_table_source ?? parentRow.define_table_source ?? 'shp'),
    define_table_div_query: divQuery,
    define_table_parents_layer: parent,
  }
}

export function materializeParentSplitChildren(
  parentRow: TableRow,
  parent: string,
  config: ProjectSplitParentConfig,
  existingByName?: Map<string, TableRow>
): TableRow[] {
  const column = splitLayerColumn(parent)
  if (!column) return []
  const parentKor = String(parentRow.define_table_kor_name ?? parent).trim() || parent
  const parentGroup = String(parentRow.define_table_group ?? '').trim()
  const codes = config.items.map((item) => item.code)
  const rows: TableRow[] = []

  for (const item of config.items) {
    const name = splitChildLayerName(parent, item.code)
    const existing = existingByName?.get(name)
    const kor =
      String(item.korName ?? '').trim() ||
      String(existing?.define_table_kor_name ?? '').trim() ||
      `${parentKor}(${item.code})`
    const group =
      String(item.group ?? '').trim() ||
      String(existing?.define_table_group ?? '').trim() ||
      parentGroup
    /** 레이어 설정 순번(1 이상)이 있으면 우선. 0·빈값은 미설정 → 분할 기본 idx */
    const existingIdx = meaningfulDefineIdx(existing?.define_table_idx)
    const idx = existingIdx || String(item.idx ?? '').trim() || ''
    rows.push(
      buildChildRow(
        parentRow,
        parent,
        name,
        kor,
        splitCodeDivQuery(column, item.code),
        group,
        idx,
        existing
      )
    )
  }

  const etcName = splitEtcLayerName(parent)
  const etcExisting = existingByName?.get(etcName)
  const etcKor =
    String(config.etc?.korName ?? '').trim() ||
    String(etcExisting?.define_table_kor_name ?? '').trim() ||
    `${parentKor}(기타)`
  const etcGroup =
    String(config.etc?.group ?? '').trim() ||
    String(etcExisting?.define_table_group ?? '').trim() ||
    parentGroup
  const etcExistingIdx = meaningfulDefineIdx(etcExisting?.define_table_idx)
  const etcIdx = etcExistingIdx || String(config.etc?.idx ?? '').trim() || ''
  rows.push(
    buildChildRow(
      parentRow,
      parent,
      etcName,
      etcKor,
      splitEtcDivQuery(column, codes),
      etcGroup,
      etcIdx,
      etcExisting
    )
  )
  return rows
}

/**
 * 프로젝트 분할 설정이 있는 부모의 관리 자식을 교체한다.
 * 설정 파일이 없거나 해당 부모 항목이 없으면 tables 원본을 유지한다.
 */
export function mergeProjectSplitIntoTables(
  tables: TableRow[],
  project?: string | null
): TableRow[] {
  const config = readProjectSplitConfig(project)
  const parents = Object.keys(config).filter((p) => p in SPLIT_LAYER_COLUMNS)
  if (parents.length === 0) return tables

  const existingByName = new Map(tables.map((row) => [rowName(row), row]))
  const parentSet = new Set(parents)
  const next: TableRow[] = []
  const inserted = new Set<string>()

  for (const row of tables) {
    const name = rowName(row)
    let skip = false
    for (const parent of parentSet) {
      if (isManagedCodeSplitChildRow(row, parent)) {
        skip = true
        break
      }
    }
    if (skip) continue

    next.push(row)

    if (parentSet.has(name) && !inserted.has(name)) {
      const parentConfig = config[name]
      const children = materializeParentSplitChildren(
        row,
        name,
        parentConfig,
        existingByName
      )
      next.push(...children)
      inserted.add(name)
    }
  }

  for (const parent of parents) {
    if (inserted.has(parent)) continue
    const parentRow = existingByName.get(parent)
    if (!parentRow) continue
    const children = materializeParentSplitChildren(
      parentRow,
      parent,
      config[parent],
      existingByName
    )
    next.push(...children)
  }

  return next
}

/** tables.json에 프로젝트 분할 자식을 물리 반영 (배포·정적 import 동기화) */
export function applyProjectSplitParentsToTables(
  tables: TableRow[],
  parents: string[],
  config: ProjectSplitConfig
): TableRow[] {
  const parentSet = new Set(
    parents.map((p) => p.trim().toLowerCase()).filter((p) => p in SPLIT_LAYER_COLUMNS)
  )
  if (parentSet.size === 0) return tables

  const existingByName = new Map(tables.map((row) => [rowName(row), row]))
  const next: TableRow[] = []
  const inserted = new Set<string>()

  for (const row of tables) {
    let skip = false
    for (const parent of parentSet) {
      if (isManagedCodeSplitChildRow(row, parent)) {
        skip = true
        break
      }
    }
    if (skip) continue

    next.push(row)
    const name = rowName(row)
    if (parentSet.has(name) && config[name] && !inserted.has(name)) {
      next.push(
        ...materializeParentSplitChildren(row, name, config[name], existingByName)
      )
      inserted.add(name)
    }
  }

  return next
}
