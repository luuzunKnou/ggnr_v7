import fs from "node:fs"
import path from "node:path"

import { DEFINE_LAYER_CODES_BASE_DIR, readDefineLayerCodes } from "@/lib/defineLayerCodeFiles"
import {
  applyProjectSplitParentsToTables,
  getCurrentGgnrProject,
  getProjectSplitConfigPath,
  readProjectSplitConfig,
  type ProjectSplitConfig,
  type ProjectSplitParentConfig,
  writeProjectSplitConfig,
} from "@/lib/projectSplitLayers"
import {
  isSplitLayerCode,
  splitChildLayerName,
  splitEtcLayerName,
  splitLayerColumn,
} from "@/lib/splitLayerTargets"
import {
  applyDefaultStyleToLayer,
  createOrUpdateGeoServerLayer,
  deletePublishedGeoServerLayer,
  invalidateDefineLayerTablesCache,
  saveDefineLayerTables,
} from "@/service/devTestService"

const TABLES_PATH = path.join(process.cwd(), "src", "config", "defineLayer", "tables.json")

type TableRow = Record<string, unknown>

export type SplitLayerCodeOption = {
  code: string
  korName: string
}

function readTablesFileRaw(): TableRow[] {
  const raw = fs.readFileSync(TABLES_PATH, "utf-8")
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) throw new Error("tables.json 형식이 올바르지 않습니다.")
  return parsed as TableRow[]
}

function findCodeFileKey(parent: string, column: string): string | null {
  const want = `field_${parent}__${column}.json`.toLowerCase()
  const files = fs.readdirSync(DEFINE_LAYER_CODES_BASE_DIR)
  const hit = files.find((name) => name.toLowerCase() === want)
  if (!hit) return null
  return hit.slice("field_".length, -".json".length)
}

function loadCodeOptions(parent: string, column: string): SplitLayerCodeOption[] {
  const key = findCodeFileKey(parent, column)
  if (!key) return []
  const rows = readDefineLayerCodes(key)
  const seen = new Set<string>()
  const out: SplitLayerCodeOption[] = []
  for (const row of rows) {
    const code = String(row.define_code_name ?? "").trim()
    if (!isSplitLayerCode(code)) continue
    const id = code.toLowerCase()
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      code,
      korName: String(row.define_code_kor_name ?? "").trim(),
    })
  }
  return out
}

function rowName(row: TableRow): string {
  return String(row.define_table_name ?? "").trim().toLowerCase()
}

/** 구분 컬럼 코드·한글명 */
export async function listSplitLayerCodes(params: { parent?: string } = {}) {
  const parent = String(params?.parent ?? "").trim().toLowerCase()
  const column = splitLayerColumn(parent)
  if (!column) return { success: false as const, error: "분할 대상 레이어가 아닙니다." }
  const codes = loadCodeOptions(parent, column)
  if (codes.length === 0) {
    return { success: false as const, error: "구분 컬럼 코드 정의가 없습니다.", column, codes: [] }
  }
  return { success: true as const, column, codes }
}

/** 현재 프로젝트의 부모 분할 설정 (없으면 tables 기반 추정은 UI에서 처리) */
export async function getProjectSplitParentConfig(params: { parent?: string } = {}) {
  const parent = String(params?.parent ?? "").trim().toLowerCase()
  const column = splitLayerColumn(parent)
  if (!column) return { success: false as const, error: "분할 대상 레이어가 아닙니다." }
  const project = getCurrentGgnrProject()
  const config = readProjectSplitConfig(project)
  const entry = config[parent] ?? null
  return {
    success: true as const,
    project,
    configPath: getProjectSplitConfigPath(project),
    column,
    config: entry,
  }
}

/**
 * 선택한 코드는 부모_코드 분할로, 나머지와 빈 값은 부모_etc 로 정의한 뒤
 * 프로젝트 분할 설정 저장 → tables.json 반영 → 발행·기본 스타일.
 */
export async function applySplitLayers(params: {
  parent?: string
  codes?: string[]
  /** 레이어명 → 발행에 쓸 한글명 */
  korNames?: Record<string, string>
  /** 레이어명 → 그룹. 비우면 부모 그룹 */
  groups?: Record<string, string>
  url?: string
  workspace?: string
}) {
  const parent = String(params?.parent ?? "").trim().toLowerCase()
  const column = splitLayerColumn(parent)
  if (!column) return { success: false as const, error: "분할 대상 레이어가 아닙니다." }

  const project = getCurrentGgnrProject()
  if (!project) {
    return {
      success: false as const,
      error: "GGNR_PROJECT가 없습니다. 프로젝트별 분할 설정을 저장하려면 프로젝트를 지정하세요.",
    }
  }

  const catalog = loadCodeOptions(parent, column)
  const byId = new Map(catalog.map((item) => [item.code.toLowerCase(), item]))
  const picked: SplitLayerCodeOption[] = []
  const seen = new Set<string>()
  for (const raw of params?.codes ?? []) {
    const code = String(raw ?? "").trim()
    if (!isSplitLayerCode(code)) continue
    const item = byId.get(code.toLowerCase())
    if (!item || seen.has(item.code.toLowerCase())) continue
    seen.add(item.code.toLowerCase())
    picked.push(item)
  }
  if (picked.length === 0) {
    return { success: false as const, error: "분할할 코드를 하나 이상 선택하세요." }
  }

  let tables: TableRow[]
  try {
    tables = readTablesFileRaw()
  } catch (e: unknown) {
    return { success: false as const, error: e instanceof Error ? e.message : String(e) }
  }

  const parentRow = tables.find((row) => rowName(row) === parent)
  if (!parentRow) return { success: false as const, error: "부모 레이어 정의가 없습니다." }
  const parentKor = String(parentRow.define_table_kor_name ?? parent).trim() || parent
  const parentGroup = String(parentRow.define_table_group ?? "").trim()

  const korNames = params?.korNames ?? {}
  const groups = params?.groups ?? {}
  const resolveKor = (layerName: string, fallback: string) => {
    const custom = String(korNames[layerName] ?? "").trim()
    return custom || fallback
  }
  const resolveGroup = (layerName: string) => {
    const custom = String(groups[layerName] ?? "").trim()
    return custom || parentGroup
  }

  const prevConfig = readProjectSplitConfig(project)
  const prevEntry = prevConfig[parent]
  const prevByCode = new Map(
    (prevEntry?.items ?? []).map((item) => [item.code.toLowerCase(), item])
  )

  const parentConfig: ProjectSplitParentConfig = {
    items: picked.map((item) => {
      const name = splitChildLayerName(parent, item.code)
      const fallbackKor = item.korName ? `${parentKor}(${item.korName})` : `${parentKor}(${item.code})`
      const korName = resolveKor(name, prevByCode.get(item.code.toLowerCase())?.korName || fallbackKor)
      const group = resolveGroup(name) || prevByCode.get(item.code.toLowerCase())?.group || parentGroup
      const prevIdx = prevByCode.get(item.code.toLowerCase())?.idx
      return {
        code: item.code,
        korName,
        ...(group ? { group } : {}),
        ...(prevIdx ? { idx: prevIdx } : {}),
      }
    }),
    etc: {
      korName: resolveKor(
        splitEtcLayerName(parent),
        prevEntry?.etc?.korName || `${parentKor}(기타)`
      ),
      ...(resolveGroup(splitEtcLayerName(parent)) || prevEntry?.etc?.group
        ? { group: resolveGroup(splitEtcLayerName(parent)) || prevEntry?.etc?.group }
        : {}),
      ...(prevEntry?.etc?.idx ? { idx: prevEntry.etc.idx } : {}),
    },
  }

  const nextProjectConfig: ProjectSplitConfig = {
    ...prevConfig,
    [parent]: parentConfig,
  }
  const saveProject = writeProjectSplitConfig(nextProjectConfig, project)
  if (!saveProject.success) {
    return { success: false as const, error: saveProject.error }
  }

  const prevManagedNames = new Set<string>()
  if (prevEntry) {
    for (const item of prevEntry.items) prevManagedNames.add(splitChildLayerName(parent, item.code))
    prevManagedNames.add(splitEtcLayerName(parent))
  } else {
    for (const row of tables) {
      if (String(row.define_table_parents_layer ?? "").trim().toLowerCase() !== parent) continue
      const name = rowName(row)
      const suffix = name.startsWith(`${parent}_`) ? name.slice(parent.length + 1) : ""
      if (suffix === "etc" || isSplitLayerCode(suffix)) prevManagedNames.add(name)
    }
  }

  const nextTables = applyProjectSplitParentsToTables(tables, [parent], nextProjectConfig)
  const nextManagedNames = new Set([
    splitEtcLayerName(parent),
    ...picked.map((item) => splitChildLayerName(parent, item.code)),
  ])
  const removed = [...prevManagedNames].filter((name) => !nextManagedNames.has(name))

  const saveRes = await saveDefineLayerTables({ tables: nextTables })
  if (!saveRes.success) {
    return { success: false as const, error: saveRes.error ?? "레이어 정의 저장 실패" }
  }
  invalidateDefineLayerTablesCache()

  const failed: Array<{ layer: string; error: string }> = []
  for (const layerName of removed) {
    const delRes = await deletePublishedGeoServerLayer({
      layerName,
      url: params?.url,
      workspace: params?.workspace,
    })
    if (!delRes.success) failed.push({ layer: layerName, error: delRes.error ?? "발행 제거 실패" })
  }

  const published: string[] = []
  const styled: string[] = []
  const etcName = splitEtcLayerName(parent)
  for (const layerName of [etcName, ...picked.map((item) => splitChildLayerName(parent, item.code))]) {
    const pubRes = await createOrUpdateGeoServerLayer({
      layerName,
      url: params?.url,
      workspace: params?.workspace,
    })
    if (!pubRes.success) {
      failed.push({ layer: layerName, error: pubRes.error ?? "발행 실패" })
      continue
    }
    published.push(layerName)
    const styleRes = await applyDefaultStyleToLayer({
      layerName,
      url: params?.url,
      workspace: params?.workspace,
    })
    if (!styleRes.success) {
      failed.push({ layer: layerName, error: styleRes.error ?? "스타일 생성 실패" })
      continue
    }
    styled.push(layerName)
  }

  if (failed.length > 0) {
    return {
      success: false as const,
      error: failed.map((item) => `${item.layer}: ${item.error}`).join("\n"),
      project,
      configPath: saveProject.path,
      published,
      styled,
      removed,
      failed,
    }
  }

  return {
    success: true as const,
    project,
    configPath: saveProject.path,
    published,
    styled,
    removed,
    failed,
  }
}
