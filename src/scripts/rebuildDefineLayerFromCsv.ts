import fs from "node:fs"
import path from "node:path"
import { reorderDefineLayerTableRow } from "../lib/defineLayerTableRowOrder"

type RowRecord = Record<string, string>

const TABLE_OUTPUT_KEYS = [
  "define_table_name",
  "define_table_kor_name",
  "define_table_shp_type",
  "define_table_read_share",
  "define_table_write_share",
  "define_table_group",
  "define_table_idx",
  "define_table_etc",
  "define_table_schema",
  "define_table_source",
] as const

const FIELD_OUTPUT_KEYS = [
  "define_field_name",
  "define_field_kor_name",
  "define_field_is_required",
  "define_field_show_search",
  "define_field_show_list",
  "define_field_show_detail",
  "define_field_type",
  "define_field_sel_list",
  "define_field_read_only",
  "define_field_is_key",
  "define_field_show_search_detail",
  "define_field_max_length",
  "define_field_idx",
  "define_field_sort_idx",
  "define_field_sort_type",
  "define_field_sel_table",
  "define_field_sel_query",
  "define_field_sel_url",
  "define_field_show_detail_list",
  "define_field_sel_key_field",
  "define_field_sel_label_field",
  "define_field_default_value",
  "define_field_show_title",
] as const

const CODE_OUTPUT_KEYS = [
  "define_code_key",
  "define_code_field_key",
  "define_code_name",
  "define_code_kor_name",
] as const

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cell += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
    } else if (ch === ",") {
      row.push(cell)
      cell = ""
    } else if (ch === "\n") {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
    } else if (ch === "\r") {
      continue
    } else {
      cell += ch
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}

function makeUniqueHeaders(headers: string[]): string[] {
  const counts = new Map<string, number>()
  return headers.map((raw) => {
    const header = raw.replace(/^\uFEFF/, "").trim()
    const current = counts.get(header) ?? 0
    counts.set(header, current + 1)
    return current === 0 ? header : `${header}__${current + 1}`
  })
}

function toRowObjects(rows: string[][]): RowRecord[] {
  if (rows.length === 0) return []
  const headers = makeUniqueHeaders(rows[0])
  const dataRows = rows.slice(1)
  return dataRows
    .filter((r) => r.some((v) => String(v ?? "").trim() !== ""))
    .map((r) => {
      const record: RowRecord = {}
      for (let i = 0; i < headers.length; i++) {
        record[headers[i]] = String(r[i] ?? "").trim()
      }
      return record
    })
}

function pickValue(row: RowRecord, key: string): string {
  const direct = row[key]
  if (direct != null && direct !== "") return direct.trim()

  const altKeys = Object.keys(row).filter((k) => k.startsWith(`${key}__`)).sort()
  for (const k of altKeys) {
    const v = row[k]
    if (v != null && v !== "") return v.trim()
  }
  return ""
}

function normalizeFlag(value: string): string {
  const v = String(value ?? "").trim().toLowerCase()
  if (v === "") return ""
  if (v === "t" || v === "true" || v === "1" || v === "y" || v === "yes") return "true"
  if (v === "f" || v === "false" || v === "0" || v === "n" || v === "no") return "false"
  return String(value ?? "").trim()
}

function toIntOrMax(value: string, fallback = Number.MAX_SAFE_INTEGER): number {
  const n = parseInt(String(value ?? "").trim(), 10)
  return Number.isFinite(n) ? n : fallback
}

function compactObject<T extends Record<string, string>>(
  source: T,
  keys: readonly (keyof T)[]
): Record<string, string> {
  const out: Record<string, string> = {}
  keys.forEach((k) => {
    out[String(k)] = String(source[k] ?? "")
  })
  return out
}

function mergeEmptyFields(target: Record<string, string>, source: Record<string, string>) {
  for (const [k, v] of Object.entries(source)) {
    if ((target[k] ?? "") === "" && v !== "") {
      target[k] = v
    }
  }
}

function sortTables(a: Record<string, string>, b: Record<string, string>) {
  const groupA = (a.define_table_group ?? "").toLowerCase()
  const groupB = (b.define_table_group ?? "").toLowerCase()
  if (groupA !== groupB) return groupA.localeCompare(groupB)

  const idxA = toIntOrMax(a.define_table_idx)
  const idxB = toIntOrMax(b.define_table_idx)
  if (idxA !== idxB) return idxA - idxB

  return (a.define_table_name ?? "").toLowerCase().localeCompare((b.define_table_name ?? "").toLowerCase())
}

function sortFields(a: Record<string, string>, b: Record<string, string>) {
  const idxA = toIntOrMax(a.define_field_idx)
  const idxB = toIntOrMax(b.define_field_idx)
  if (idxA !== idxB) return idxA - idxB
  return (a.define_field_name ?? "").toLowerCase().localeCompare((b.define_field_name ?? "").toLowerCase())
}

function sortCodes(a: Record<string, string>, b: Record<string, string>) {
  const idxA = toIntOrMax(a.define_code_key)
  const idxB = toIntOrMax(b.define_code_key)
  if (idxA !== idxB) return idxA - idxB
  return (a.define_code_name ?? "").toLowerCase().localeCompare((b.define_code_name ?? "").toLowerCase())
}

function writeJson(filePath: string, data: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8")
}

function timestampForVersion(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  const hh = String(date.getHours()).padStart(2, "0")
  const mi = String(date.getMinutes()).padStart(2, "0")
  return `${yyyy}${mm}${dd}${hh}${mi}`
}

function timestampForBackup(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  const hh = String(date.getHours()).padStart(2, "0")
  const mi = String(date.getMinutes()).padStart(2, "0")
  const ss = String(date.getSeconds()).padStart(2, "0")
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`
}

function safeName(value: string): string {
  return String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "")
}

function calculateGeneratedSize(defineLayerDir: string): number {
  let total = 0
  const walk = (dirPath: string) => {
    if (!fs.existsSync(dirPath)) return
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith("_backup_")) continue
        walk(full)
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        total += fs.statSync(full).size
      }
    }
  }
  walk(defineLayerDir)
  return total
}

function main() {
  const projectRoot = process.cwd()
  const defineLayerDir = path.join(projectRoot, "src", "config", "defineLayer")
  const inputPath = process.argv[2] ?? "C:/Users/Public/Downloads/__output_data.csv"
  const csvPath = path.isAbsolute(inputPath) ? inputPath : path.join(projectRoot, inputPath)

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV 파일을 찾을 수 없습니다: ${csvPath}`)
  }

  const now = new Date()
  const csvText = fs.readFileSync(csvPath, "utf-8")
  const csvRows = parseCsv(csvText)
  const records = toRowObjects(csvRows)

  const tableMap = new Map<string, Record<string, string>>()
  const fieldsMap = new Map<string, Map<string, Record<string, string>>>()
  const codesMap = new Map<string, Map<string, Record<string, string>>>()

  for (const row of records) {
    const tableName = pickValue(row, "define_table_name")
    if (!tableName) continue

    const srcRaw = pickValue(row, "define_table_source").toLowerCase()
    const tableObj = compactObject(
      {
        define_table_name: tableName,
        define_table_kor_name: pickValue(row, "define_table_kor_name"),
        define_table_shp_type: pickValue(row, "define_table_shp_type"),
        define_table_read_share: pickValue(row, "define_table_read_share") || "P",
        define_table_write_share: pickValue(row, "define_table_write_share") || "P",
        define_table_group: pickValue(row, "define_table_group"),
        define_table_idx: pickValue(row, "define_table_idx"),
        define_table_etc: pickValue(row, "define_table_etc"),
        define_table_schema: pickValue(row, "define_table_schema") || "layer",
        define_table_source: srcRaw === "excel" ? "excel" : "shp",
      },
      TABLE_OUTPUT_KEYS
    )

    if (!tableMap.has(tableName)) tableMap.set(tableName, tableObj)
    else mergeEmptyFields(tableMap.get(tableName)!, tableObj)

    const fieldName = pickValue(row, "define_field_name")
    if (!fieldName) continue

    const fieldObj = compactObject(
      {
        define_field_name: fieldName,
        define_field_kor_name: pickValue(row, "define_field_kor_name"),
        define_field_is_required: normalizeFlag(pickValue(row, "define_field_is_required")),
        define_field_show_search: normalizeFlag(pickValue(row, "define_field_show_search")),
        define_field_show_list: normalizeFlag(pickValue(row, "define_field_show_list")),
        define_field_show_detail: normalizeFlag(pickValue(row, "define_field_show_detail")) || "false",
        define_field_type: pickValue(row, "define_field_type").toUpperCase(),
        define_field_sel_list: pickValue(row, "define_field_sel_list"),
        define_field_read_only: normalizeFlag(pickValue(row, "define_field_read_only")),
        define_field_is_key: normalizeFlag(pickValue(row, "define_field_is_key")),
        define_field_show_search_detail: normalizeFlag(pickValue(row, "define_field_show_search_detail")),
        define_field_max_length: pickValue(row, "define_field_max_length"),
        define_field_idx: pickValue(row, "define_field_idx"),
        define_field_sort_idx: pickValue(row, "define_field_sort_idx"),
        define_field_sort_type: (pickValue(row, "define_field_sort_type") || "ASC").toUpperCase(),
        define_field_sel_table: pickValue(row, "define_field_sel_table"),
        define_field_sel_query: pickValue(row, "define_field_sel_query"),
        define_field_sel_url: pickValue(row, "define_field_sel_url"),
        define_field_show_detail_list: normalizeFlag(pickValue(row, "define_field_show_detail_list")),
        define_field_sel_key_field: pickValue(row, "define_field_sel_key_field"),
        define_field_sel_label_field: pickValue(row, "define_field_sel_label_field"),
        define_field_default_value: pickValue(row, "define_field_default_value"),
        define_field_show_title: normalizeFlag(
          pickValue(row, "define_field_show_title") || pickValue(row, "define_field_map_title")
        ),
      },
      FIELD_OUTPUT_KEYS
    )

    if (!fieldsMap.has(tableName)) fieldsMap.set(tableName, new Map())
    const tableFields = fieldsMap.get(tableName)!
    if (!tableFields.has(fieldName)) tableFields.set(fieldName, fieldObj)
    else mergeEmptyFields(tableFields.get(fieldName)!, fieldObj)

    const isCodeField = fieldObj.define_field_type.toUpperCase() === "CODE"
    if (!isCodeField) continue

    const codeName = pickValue(row, "define_code_name")
    const codeKorName = pickValue(row, "define_code_kor_name")
    const codeKey = pickValue(row, "define_code_key")
    const codeFieldKey = pickValue(row, "define_code_field_key")
    if (!codeName && !codeKorName && !codeKey && !codeFieldKey) continue

    const tableFieldKey = `${tableName}__${fieldName}`
    if (!codesMap.has(tableFieldKey)) codesMap.set(tableFieldKey, new Map())
    const codeMap = codesMap.get(tableFieldKey)!
    const uniqueCodeKey = `${codeName}::${codeKey}::${codeKorName}`
    if (!codeMap.has(uniqueCodeKey)) {
      codeMap.set(
        uniqueCodeKey,
        compactObject(
          {
            define_code_key: codeKey,
            define_code_field_key: codeFieldKey,
            define_code_name: codeName,
            define_code_kor_name: codeKorName,
          },
          CODE_OUTPUT_KEYS
        )
      )
    }
  }

  const backupDir = path.join(defineLayerDir, `_backup_${timestampForBackup(now)}`)
  fs.mkdirSync(backupDir, { recursive: true })

  const backupTargets = ["tables.json", "index.json", "stats.json", "fields", "codes"] as const
  for (const target of backupTargets) {
    const src = path.join(defineLayerDir, target)
    if (!fs.existsSync(src)) continue
    const dst = path.join(backupDir, target)
    fs.cpSync(src, dst, { recursive: true })
  }

  const fieldsDir = path.join(defineLayerDir, "fields")
  const codesDir = path.join(defineLayerDir, "codes")
  fs.rmSync(fieldsDir, { recursive: true, force: true })
  fs.rmSync(codesDir, { recursive: true, force: true })
  fs.mkdirSync(fieldsDir, { recursive: true })
  fs.mkdirSync(codesDir, { recursive: true })

  const tables = Array.from(tableMap.values())
    .sort(sortTables)
    .map((t) => reorderDefineLayerTableRow(t as Record<string, unknown>))
  writeJson(path.join(defineLayerDir, "tables.json"), tables)

  let totalFields = 0
  const codeFieldKeys = new Set<string>()
  for (const table of tables) {
    const tableName = String((table as Record<string, unknown>)?.define_table_name ?? '')
    const fieldMap = fieldsMap.get(tableName)
    const fields = fieldMap ? Array.from(fieldMap.values()).sort(sortFields) : []
    totalFields += fields.length
    const fileName = `table_${safeName(tableName)}.json`
    writeJson(path.join(fieldsDir, fileName), fields)

    for (const field of fields) {
      if ((field.define_field_type ?? "").toUpperCase() === "CODE") {
        codeFieldKeys.add(`${tableName}__${field.define_field_name}`)
      }
    }
  }

  let totalCodes = 0
  for (const tableField of codeFieldKeys) {
    const codeMap = codesMap.get(tableField)
    const codes = codeMap ? Array.from(codeMap.values()).sort(sortCodes) : []
    totalCodes += codes.length
    const fileName = `field_${safeName(tableField)}.json`
    writeJson(path.join(codesDir, fileName), codes)
  }

  const indexPayload = {
    version: timestampForVersion(now),
    generatedAt: now.toISOString(),
    splitAt: now.toISOString(),
  }
  writeJson(path.join(defineLayerDir, "index.json"), indexPayload)

  const statsPayload = {
    totalTables: tables.length,
    totalFields,
    totalCodes,
    originalFileSize: fs.statSync(csvPath).size,
    splitFilesSizeSum: calculateGeneratedSize(defineLayerDir),
    splitAt: now.toISOString(),
  }
  writeJson(path.join(defineLayerDir, "stats.json"), statsPayload)

  console.log("[rebuildDefineLayerFromCsv] 완료")
  console.log(`- csv: ${csvPath}`)
  console.log(`- backup: ${backupDir}`)
  console.log(`- tables: ${tables.length}`)
  console.log(`- fields: ${totalFields}`)
  console.log(`- codes: ${totalCodes}`)
}

main()
