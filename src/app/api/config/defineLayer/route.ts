import { NextRequest, NextResponse } from "next/server"
import * as fs from "fs"
import * as path from "path"

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

/** 테이블 목록 조회 (fields 제외). page, limit 있으면 페이징, 없으면 전체. 항상 그룹→순서→이름 정렬 후 반환 */
export async function GET(request: NextRequest) {
  try {
    if (!fs.existsSync(TABLES_PATH)) {
      return NextResponse.json({ success: false, error: "tables.json not found" }, { status: 404 })
    }
    const raw = fs.readFileSync(TABLES_PATH, "utf-8")
    const tables = JSON.parse(raw)
    if (!Array.isArray(tables)) {
      return NextResponse.json({ success: false, error: "Invalid tables format" }, { status: 500 })
    }
    const sorted = sortTables(tables)

    const pageParam = request.nextUrl.searchParams.get("page")
    const limitParam = request.nextUrl.searchParams.get("limit")
    if (pageParam != null && limitParam != null) {
      const page = Math.max(1, parseInt(pageParam, 10) || 1)
      const limit = Math.min(100, Math.max(1, parseInt(limitParam, 10) || 50))
      const start = (page - 1) * limit
      const slice = sorted.slice(start, start + limit)
      return NextResponse.json({ success: true, data: slice, total: sorted.length })
    }

    return NextResponse.json({ success: true, data: sorted })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/** 테이블 목록 저장 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const tables = body.data ?? body
    if (!Array.isArray(tables)) {
      return NextResponse.json(
        { success: false, error: "Invalid body: array of tables required" },
        { status: 400 }
      )
    }
    fs.mkdirSync(path.dirname(TABLES_PATH), { recursive: true })
    fs.writeFileSync(TABLES_PATH, JSON.stringify(tables, null, 2), "utf-8")
    return NextResponse.json({ success: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
