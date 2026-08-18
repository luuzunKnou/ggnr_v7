import { NextResponse } from "next/server"
import * as fs from "fs"
import * as path from "path"
import * as XLSX from "xlsx"
import { normalizeDefineTableSource, dedupeDefineLayerTablesByName } from "@/lib/defineLayerTablesNormalize"
import { reorderDefineLayerTablesArray } from "@/lib/defineLayerTableRowOrder"

const TABLES_PATH = path.join(process.cwd(), "src", "config", "defineLayer", "tables.json")

/** 정렬: 1. 그룹 2. 순서 3. 테이블 영문명 */
function sortTables<T extends Record<string, unknown>>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    const groupA = String(a.define_table_group ?? "").toLowerCase()
    const groupB = String(b.define_table_group ?? "").toLowerCase()
    if (groupA !== groupB) return groupA.localeCompare(groupB)
    const idxA = parseInt(String(a.define_table_idx ?? "999999"), 10)
    const idxB = parseInt(String(b.define_table_idx ?? "999999"), 10)
    if (idxA !== idxB) return idxA - idxB
    const nameA = String(a.define_table_name ?? "").toLowerCase()
    const nameB = String(b.define_table_name ?? "").toLowerCase()
    return nameA.localeCompare(nameB)
  })
}

const SHARE_CODE_TO_LABEL: Record<string, string> = {
  P: "전체",
  G: "부서",
  O: "개인",
}

const EXPORT_COLUMNS: { key: string; header: string }[] = [
  { key: "define_table_group", header: "그룹" },
  { key: "define_table_name", header: "테이블명" },
  { key: "define_table_kor_name", header: "한글명" },
  { key: "define_table_source", header: "출처" },
  { key: "define_table_idx", header: "순서" },
  { key: "define_table_shp_type", header: "도형" },
  { key: "define_table_read_share", header: "읽기" },
  { key: "define_table_write_share", header: "쓰기" },
  { key: "define_table_etc", header: "비고" },
  { key: "define_table_legend", header: "범례" },
]

/** GET: tables.json 읽고 정렬 후 엑셀 생성해 파일 반환 */
export async function GET() {
  try {
    if (!fs.existsSync(TABLES_PATH)) {
      return NextResponse.json({ success: false, error: "tables.json not found" }, { status: 404 })
    }
    const raw = fs.readFileSync(TABLES_PATH, "utf-8")
    const tables: Record<string, unknown>[] = JSON.parse(raw)
    if (!Array.isArray(tables)) {
      return NextResponse.json({ success: false, error: "Invalid tables format" }, { status: 500 })
    }
    normalizeDefineTableSource(tables)
    const deduped = dedupeDefineLayerTablesByName(tables)
    const reordered = reorderDefineLayerTablesArray(deduped)
    const sorted = sortTables(reordered)

    const rows: Record<string, string>[] = sorted.map((row) => {
      const out: Record<string, string> = {}
      for (const { key, header } of EXPORT_COLUMNS) {
        let val = row[key]
        if (val === undefined || val === null) val = ""
        let str = String(val)
        if (key === "define_table_read_share" || key === "define_table_write_share") {
          str = SHARE_CODE_TO_LABEL[str] ?? str
        }
        if (key === "define_table_source") {
          str = str.toLowerCase() === "excel" ? "Excel" : "SHP"
        }
        out[header] = str
      }
      return out
    })

    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "레이어목록")
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" })

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="layer-list.xlsx"',
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
