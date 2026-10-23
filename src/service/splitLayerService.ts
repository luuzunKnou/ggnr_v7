import fs from "node:fs"
import path from "node:path"

import { DEFINE_LAYER_CODES_BASE_DIR, readDefineLayerCodes } from "@/lib/defineLayerCodeFiles"
import {
  isSplitLayerCode,
  splitChildLayerName,
  splitCodeDivQuery,
  splitEtcDivQuery,
  splitEtcLayerName,
  splitLayerColumn,
} from "@/lib/splitLayerTargets"
import {
  applyDefaultStyleToLayer,
  createOrUpdateGeoServerLayer,
  deletePublishedGeoServerLayer,
  saveDefineLayerTables,
} from "@/service/devTestService"

const TABLES_PATH = path.join(process.cwd(), "src", "config", "defineLayer", "tables.json")

type TableRow = Record<string, unknown>

export type SplitLayerCodeOption = {
  code: string
  korName: string
}

function readTablesFile(): TableRow[] {
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

function isManagedSplitRow(row: TableRow, parent: string, codeIds: Set<string>): boolean {
  if (String(row.define_table_parents_layer ?? "").trim().toLowerCase() !== parent) return false
  const name = rowName(row)
  const prefix = `${parent}_`
  if (!name.startsWith(prefix)) return false
  const suffix = name.slice(prefix.length)
  return suffix === "etc" || codeIds.has(suffix)
}

function childRow(
  parentRow: TableRow,
  parent: string,
  name: string,
  korName: string,
  divQuery: string,
  existing: TableRow | undefined
): TableRow {
  const base = existing ?? parentRow
  return {
    define_table_name: name,
    define_table_kor_name: korName,
    define_table_shp_type: String(base.define_table_shp_type ?? parentRow.define_table_shp_type ?? ""),
    define_table_read_share: String(base.define_table_read_share ?? parentRow.define_table_read_share ?? "P"),
    define_table_write_share: String(base.define_table_write_share ?? parentRow.define_table_write_share ?? "P"),
    define_table_group: String(base.define_table_group ?? parentRow.define_table_group ?? ""),
    define_table_idx: existing ? String(existing.define_table_idx ?? "") : "",
    define_table_etc: existing ? String(existing.define_table_etc ?? "") : "",
    define_table_schema: String(base.define_table_schema ?? parentRow.define_table_schema ?? "layer"),
    define_table_source: String(base.define_table_source ?? parentRow.define_table_source ?? "shp"),
    define_table_div_query: divQuery,
    define_table_parents_layer: parent,
  }
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

/**
 * 선택한 코드는 부모_코드 분할로, 나머지와 빈 값은 부모_etc 로 정의한 뒤 발행·기본 스타일을 붙인다.
 * 코드 이름 규칙의 기존 분할만 갱신·제거한다.
 */
export async function applySplitLayers(params: {
  parent?: string
  codes?: string[]
  /** 레이어명 → 발행에 쓸 한글명. 비어 있으면 코드 한글명으로 채운다. */
  korNames?: Record<string, string>
  url?: string
  workspace?: string
}) {
  const parent = String(params?.parent ?? "").trim().toLowerCase()
  const column = splitLayerColumn(parent)
  if (!column) return { success: false as const, error: "분할 대상 레이어가 아닙니다." }

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

  const codeIds = new Set(catalog.map((item) => item.code.toLowerCase()))
  let tables: TableRow[]
  try {
    tables = readTablesFile()
  } catch (e: unknown) {
    return { success: false as const, error: e instanceof Error ? e.message : String(e) }
  }

  const parentRow = tables.find((row) => rowName(row) === parent)
  if (!parentRow) return { success: false as const, error: "부모 레이어 정의가 없습니다." }
  const parentKor = String(parentRow.define_table_kor_name ?? parent).trim() || parent

  const existingByName = new Map(tables.map((row) => [rowName(row), row]))
  const korNames = params?.korNames ?? {}
  const resolveKor = (layerName: string, fallback: string) => {
    const custom = String(korNames[layerName] ?? "").trim()
    return custom || fallback
  }
  const wanted = new Map<string, TableRow>()
  for (const item of picked) {
    const name = splitChildLayerName(parent, item.code)
    const kor = item.korName ? `${parentKor}(${item.korName})` : `${parentKor}(${item.code})`
    wanted.set(
      name,
      childRow(
        parentRow,
        parent,
        name,
        resolveKor(name, kor),
        splitCodeDivQuery(column, item.code),
        existingByName.get(name)
      )
    )
  }
  const etcName = splitEtcLayerName(parent)
  wanted.set(
    etcName,
    childRow(
      parentRow,
      parent,
      etcName,
      resolveKor(etcName, `${parentKor}(기타)`),
      splitEtcDivQuery(column, picked.map((item) => item.code)),
      existingByName.get(etcName)
    )
  )

  const removed: string[] = []
  const next: TableRow[] = []
  for (const row of tables) {
    const name = rowName(row)
    if (isManagedSplitRow(row, parent, codeIds)) {
      const replacement = wanted.get(name)
      if (replacement) {
        next.push(replacement)
        wanted.delete(name)
      } else {
        removed.push(name)
      }
      continue
    }
    next.push(row)
  }
  if (wanted.size > 0) {
    const insertAt = next.findIndex((row) => rowName(row) === parent)
    const rows = Array.from(wanted.values())
    if (insertAt >= 0) next.splice(insertAt + 1, 0, ...rows)
    else next.push(...rows)
  }

  const saveRes = await saveDefineLayerTables({ tables: next })
  if (!saveRes.success) {
    return { success: false as const, error: saveRes.error ?? "레이어 정의 저장 실패" }
  }

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
      published,
      styled,
      removed,
      failed,
    }
  }

  return {
    success: true as const,
    published,
    styled,
    removed,
    failed,
  }
}
