/**
 * KRRIS 표준 CSV → defineLayer 병합 (매핑은 아래만 적용, 그 외 컬럼은 define에 넣지 않음)
 *
 * 테이블: layer_code→define_table_name, layer_name_kor→define_table_kor_name,
 *         geom_type→define_table_shp_type(점:POINT, 선:LINE, 면:POLYGON),
 *         group→define_table_group
 * 필드: field_name→define_field_name, field_name_kor→define_field_kor_name,
 *       data_type→define_field_type(varchar→text), length→define_field_max_length
 * 코드: code→define_code_name, code_kor→define_code_kor_name (이 두 키만 저장)
 *
 * define_table_etc 는 CSV로 갱신하는 테이블에 대해 비움(빈 문자열). 매핑 없는 CSV 컬럼은 사용하지 않음.
 *
 * 사용: npx tsx src/scripts/mergeStandardCsvIntoDefineLayer.ts [csv경로]
 */
import fs from "node:fs"
import path from "node:path"
import { normalizeDefineTableSource } from "../lib/defineLayerTablesNormalize"
import { reorderDefineLayerTableRow, reorderDefineLayerTablesArray } from "../lib/defineLayerTableRowOrder"

type RowRecord = Record<string, string>

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

function safeName(value: string): string {
  return String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "")
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

function timestampForVersion(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  const hh = String(date.getHours()).padStart(2, "0")
  const mi = String(date.getMinutes()).padStart(2, "0")
  return `${yyyy}${mm}${dd}${hh}${mi}`
}

/** geom_type: 점→POINT, 선→LINE, 면→POLYGON (매핑에 없는 값은 넣지 않음 → 빈이면 POLYGON 기본은 사용 안 함; 빈이면 기존 유지) */
function mapGeom(raw: string): string {
  const s = String(raw ?? "").trim()
  if (s === "점") return "POINT"
  if (s === "선") return "LINE"
  if (s === "면") return "POLYGON"
  const u = s.toUpperCase()
  if (u === "POINT" || u === "LINE" || u === "POLYGON") return u
  if (u === "LINESTRING" || u === "MULTILINESTRING") return "LINE"
  if (u === "MULTIPOLYGON") return "POLYGON"
  return ""
}

function mapDataTypeToFieldType(dt: string): string {
  const s = String(dt ?? "").trim().toLowerCase()
  if (!s) return "text"
  if (s === "varchar" || s.includes("varchar") || s === "character varying" || s === "text") return "text"
  if (s.includes("int") || s === "bigint" || s === "smallint" || s === "serial") return "integer"
  if (s.includes("numeric") || s.includes("decimal") || s.includes("float") || s.includes("double") || s === "number")
    return "numeric"
  if (s.includes("date") || s.includes("time")) return "date"
  if (s.includes("bool")) return "boolean"
  return s.replace(/\s+/g, "_")
}

function sortTablesJson(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const g = (x: Record<string, unknown>) => String(x.define_table_group ?? "").toLowerCase()
  if (g(a) !== g(b)) return g(a).localeCompare(g(b))
  const ia = parseInt(String(a.define_table_idx ?? "999999"), 10)
  const ib = parseInt(String(b.define_table_idx ?? "999999"), 10)
  if (ia !== ib) return ia - ib
  return String(a.define_table_name ?? "")
    .toLowerCase()
    .localeCompare(String(b.define_table_name ?? "").toLowerCase())
}

function sortFieldsJson(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const ia = typeof a.define_field_idx === "number" ? a.define_field_idx : parseInt(String(a.define_field_idx ?? "999999"), 10)
  const ib = typeof b.define_field_idx === "number" ? b.define_field_idx : parseInt(String(b.define_field_idx ?? "999999"), 10)
  if (ia !== ib) return ia - ib
  return String(a.define_field_name ?? "")
    .toLowerCase()
    .localeCompare(String(b.define_field_name ?? "").toLowerCase())
}

function sortCodesJson(a: Record<string, unknown>, b: Record<string, unknown>): number {
  return String(a.define_code_name ?? "")
    .toLowerCase()
    .localeCompare(String(b.define_code_name ?? "").toLowerCase())
}

function defaultNewField(): Record<string, unknown> {
  return {
    define_field_name: "",
    define_field_kor_name: "",
    define_field_type: "text",
    define_field_idx: 999999,
    define_field_is_required: false,
    define_field_show_search: false,
    define_field_show_list: true,
    define_field_show_detail: true,
    define_field_read_only: false,
    define_field_is_key: false,
    define_field_show_search_detail: false,
    define_field_max_length: "",
    define_field_sort_idx: "",
    define_field_sort_type: "",
    define_field_sel_list: "",
    define_field_sel_table: "",
    define_field_sel_query: "",
    define_field_sel_url: "",
    define_field_show_detail_list: false,
    define_field_sel_key_field: "",
    define_field_sel_label_field: "",
    define_field_default_value: "",
    define_field_show_title: false,
  }
}

function mergeFieldCsv(
  existing: Record<string, unknown> | undefined,
  patch: { fname: string; kor: string; fieldType: string; maxLen: string }
): Record<string, unknown> {
  const base = existing ? { ...existing } : defaultNewField()
  base.define_field_name = patch.fname
  base.define_field_kor_name = patch.kor || patch.fname
  base.define_field_type = patch.fieldType
  base.define_field_max_length = patch.maxLen
  return base
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

type CsvLayerMeta = {
  layer_code: string
  layer_name_kor: string
  geom_raw: string
  group: string
}

type CsvFieldAgg = {
  canonTable: string
  fieldName: string
  fieldKeyLower: string
  field_name_kor: string
  data_type_raw: string
  length: string
  hasDomain: boolean
}

function main() {
  const projectRoot = process.cwd()
  const defineLayerDir = path.join(projectRoot, "src", "config", "defineLayer")
  const defaultCsv = path.join(
    projectRoot,
    "docs",
    "_SELECT_FROM_layer_standard_L_JOIN_field_standard_f_ON_L_layer_i_202604181421.csv"
  )
  const inputPath = process.argv[2] ?? defaultCsv
  const csvPath = path.isAbsolute(inputPath) ? inputPath : path.join(projectRoot, inputPath)

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV 파일을 찾을 수 없습니다: ${csvPath}`)
  }

  const records = toRowObjects(parseCsv(fs.readFileSync(csvPath, "utf-8")))

  const layerByCode = new Map<string, CsvLayerMeta>()
  const fieldAgg = new Map<string, CsvFieldAgg>()
  const fieldDomain = new Map<string, boolean>()

  for (const row of records) {
    const layerCode = pickValue(row, "layer_code")
    if (!layerCode) continue
    const canonTable = layerCode.toLowerCase()

    if (!layerByCode.has(canonTable)) {
      layerByCode.set(canonTable, {
        layer_code: layerCode,
        layer_name_kor: pickValue(row, "layer_name_kor"),
        geom_raw: pickValue(row, "geom_type"),
        group: pickValue(row, "group"),
      })
    }

    const fieldRaw = pickValue(row, "field_name")
    if (!fieldRaw) continue
    const fieldName = fieldRaw.trim()
    const fieldKeyLower = fieldName.toLowerCase()
    const fk = `${canonTable}__${fieldKeyLower}`

    const code = pickValue(row, "code").replace(/^"|"$/g, "")
    const hasRowDomain = Boolean(code || pickValue(row, "code_kor"))
    fieldDomain.set(fk, Boolean(fieldDomain.get(fk)) || hasRowDomain)

    if (!fieldAgg.has(fk)) {
      fieldAgg.set(fk, {
        canonTable,
        fieldName,
        fieldKeyLower,
        field_name_kor: pickValue(row, "field_name_kor"),
        data_type_raw: pickValue(row, "data_type"),
        length: pickValue(row, "length").replace(/^"|"$/g, ""),
        hasDomain: false,
      })
    }
  }

  for (const [fk, agg] of fieldAgg) {
    agg.hasDomain = fieldDomain.get(fk) ?? false
  }

  const tablesPath = path.join(defineLayerDir, "tables.json")
  const rawTables: Record<string, unknown>[] = fs.existsSync(tablesPath)
    ? (JSON.parse(fs.readFileSync(tablesPath, "utf-8")) as Record<string, unknown>[])
    : []

  const tablesByName = new Map<string, Record<string, unknown>>()
  for (const t of rawTables) {
    const n = String(t.define_table_name ?? "").trim()
    if (n) tablesByName.set(n.toLowerCase(), t)
  }

  for (const [canonTable, meta] of layerByCode) {
    const existing = tablesByName.get(canonTable)
    const geomMapped = mapGeom(meta.geom_raw)
    const tableNameOut = existing ? String(existing.define_table_name ?? "").trim() || meta.layer_code : meta.layer_code

    const merged: Record<string, unknown> = {
      ...(existing ?? {}),
      define_table_name: tableNameOut,
      define_table_kor_name: meta.layer_name_kor || String(existing?.define_table_kor_name ?? tableNameOut),
      define_table_group: meta.group,
      define_table_etc: "",
      define_table_schema: String(existing?.define_table_schema ?? "layer") || "layer",
      define_table_read_share: String(existing?.define_table_read_share ?? "P") || "P",
      define_table_write_share: String(existing?.define_table_write_share ?? "P") || "P",
      define_table_source: existing?.define_table_source ?? "shp",
    }

    if (geomMapped) merged.define_table_shp_type = geomMapped
    else if (existing?.define_table_shp_type) merged.define_table_shp_type = existing.define_table_shp_type
    else merged.define_table_shp_type = "POLYGON"

    tablesByName.set(canonTable, reorderDefineLayerTableRow(merged))
  }

  const mergedTables = Array.from(tablesByName.values()).sort(sortTablesJson)
  normalizeDefineTableSource(mergedTables as Record<string, unknown>[])

  const now = new Date()
  const backupDir = path.join(defineLayerDir, `_backup_merge_${timestampForBackup(now)}`)
  fs.mkdirSync(backupDir, { recursive: true })
  for (const name of ["tables.json", "index.json", "stats.json", "fields", "codes"]) {
    const src = path.join(defineLayerDir, name)
    if (fs.existsSync(src)) {
      const dst = path.join(backupDir, name)
      fs.cpSync(src, dst, { recursive: true })
    }
  }

  fs.writeFileSync(
    tablesPath,
    `${JSON.stringify(reorderDefineLayerTablesArray(mergedTables as Record<string, unknown>[]), null, 2)}\n`,
    "utf-8"
  )

  const fieldsDir = path.join(defineLayerDir, "fields")
  const codesDir = path.join(defineLayerDir, "codes")
  fs.mkdirSync(fieldsDir, { recursive: true })
  fs.mkdirSync(codesDir, { recursive: true })

  const fieldsByTable = new Map<string, CsvFieldAgg[]>()
  for (const agg of fieldAgg.values()) {
    if (!fieldsByTable.has(agg.canonTable)) fieldsByTable.set(agg.canonTable, [])
    fieldsByTable.get(agg.canonTable)!.push(agg)
  }

  let totalCodes = 0

  for (const canonTable of new Set([...tablesByName.keys(), ...fieldsByTable.keys()])) {
    const trow = tablesByName.get(canonTable)
    const physicalName = trow ? String(trow.define_table_name ?? "").trim() || canonTable : canonTable
    const safe = safeName(physicalName)
    const fieldsPath = path.join(fieldsDir, `table_${safe}.json`)

    let existingFields: Record<string, unknown>[] = []
    if (fs.existsSync(fieldsPath)) {
      const parsed = JSON.parse(fs.readFileSync(fieldsPath, "utf-8"))
      if (Array.isArray(parsed)) existingFields = parsed as Record<string, unknown>[]
    }

    const byFname = new Map<string, Record<string, unknown>>()
    for (const f of existingFields) {
      const n = String(f.define_field_name ?? "").trim().toLowerCase()
      if (n) byFname.set(n, f)
    }

    const csvFields = fieldsByTable.get(canonTable) ?? []
    if (csvFields.length === 0 && !fs.existsSync(fieldsPath)) continue

    for (const agg of csvFields) {
      const fieldType = mapDataTypeToFieldType(agg.data_type_raw)
      const mergedF = mergeFieldCsv(byFname.get(agg.fieldKeyLower), {
        fname: agg.fieldName,
        kor: agg.field_name_kor,
        fieldType,
        maxLen: agg.length,
      })
      byFname.set(agg.fieldKeyLower, mergedF)
    }

    const nextFields = Array.from(byFname.values()).sort(sortFieldsJson)
    fs.writeFileSync(fieldsPath, `${JSON.stringify(nextFields, null, 2)}\n`, "utf-8")

    for (const agg of csvFields) {
      const codePath = path.join(codesDir, `field_${safeName(`${physicalName}__${agg.fieldName}`)}.json`)
      if (!agg.hasDomain) {
        if (fs.existsSync(codePath)) fs.unlinkSync(codePath)
        continue
      }

      const codeMap = new Map<string, { define_code_name: string; define_code_kor_name: string }>()

      for (const row of records) {
        const lc = pickValue(row, "layer_code")
        if (!lc || lc.toLowerCase() !== canonTable) continue
        if (pickValue(row, "field_name").trim().toLowerCase() !== agg.fieldKeyLower) continue

        const code = pickValue(row, "code").replace(/^"|"$/g, "")
        const codeKor = pickValue(row, "code_kor")
        if (!code && !codeKor) continue

        const ukey = `${code}::${codeKor}`
        codeMap.set(ukey, { define_code_name: code, define_code_kor_name: codeKor })
      }

      const mergedCodeList = Array.from(codeMap.values()).sort(sortCodesJson)
      totalCodes += mergedCodeList.length
      fs.writeFileSync(codePath, `${JSON.stringify(mergedCodeList, null, 2)}\n`, "utf-8")
    }
  }

  const indexPayload = {
    version: timestampForVersion(now),
    generatedAt: now.toISOString(),
    splitAt: now.toISOString(),
  }
  fs.writeFileSync(path.join(defineLayerDir, "index.json"), `${JSON.stringify(indexPayload, null, 2)}\n`, "utf-8")

  let totalFields = 0
  for (const f of fs.readdirSync(fieldsDir)) {
    if (!f.endsWith(".json")) continue
    const arr = JSON.parse(fs.readFileSync(path.join(fieldsDir, f), "utf-8")) as unknown[]
    if (Array.isArray(arr)) totalFields += arr.length
  }

  const statsPayload = {
    totalTables: mergedTables.length,
    totalFields,
    totalCodes,
    originalFileSize: fs.statSync(csvPath).size,
    splitFilesSizeSum: calculateGeneratedSize(defineLayerDir),
    splitAt: now.toISOString(),
    mergedFrom: path.relative(projectRoot, csvPath),
    mapping: "layer_code, layer_name_kor, geom_type, group / field_name, field_name_kor, data_type, length / code, code_kor only",
  }
  fs.writeFileSync(path.join(defineLayerDir, "stats.json"), `${JSON.stringify(statsPayload, null, 2)}\n`, "utf-8")

  console.log("[mergeStandardCsvIntoDefineLayer] 완료")
  console.log(`- csv: ${csvPath}`)
  console.log(`- backup: ${backupDir}`)
  console.log(`- tables: ${mergedTables.length}`)
  console.log(`- fields (sum of field files): ${totalFields}`)
  console.log(`- code rows (define_code_name/kor only): ${totalCodes}`)
}

main()
