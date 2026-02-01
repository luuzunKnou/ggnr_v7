import { NextRequest, NextResponse } from "next/server"
import * as fs from "fs"
import * as path from "path"

const FIELDS_DIR = path.join(process.cwd(), "src", "config", "defineLayer", "fields")

/** 정렬: 1. define_field_idx 2. define_field_name */
function sortFields<T extends Record<string, unknown>>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    const idxA = parseInt(String(a.define_field_idx ?? "999999"), 10)
    const idxB = parseInt(String(b.define_field_idx ?? "999999"), 10)
    if (idxA !== idxB) return idxA - idxB
    const nameA = String(a.define_field_name ?? "").toLowerCase()
    const nameB = String(b.define_field_name ?? "").toLowerCase()
    return nameA.localeCompare(nameB)
  })
}

function getFilePath(tableKey: string): string {
  const safe = String(tableKey).replace(/[^a-zA-Z0-9_-]/g, "")
  return path.join(FIELDS_DIR, `table_${safe}.json`)
}

/** 해당 테이블의 필드 목록 조회. page, limit 있으면 페이징, 없으면 전체. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tableKey: string }> }
) {
  try {
    const { tableKey } = await params
    const filePath = getFilePath(tableKey)
    if (!fs.existsSync(filePath)) {
      // 필드 파일이 없는 테이블은 빈 배열로 응답 → UI에서 빈 목록으로 표시, 저장 시 파일 생성
      const pageParam = _request.nextUrl.searchParams.get("page")
      const limitParam = _request.nextUrl.searchParams.get("limit")
      if (pageParam != null && limitParam != null) {
        return NextResponse.json({
          success: true,
          data: [],
          total: 0,
        })
      }
      return NextResponse.json({ success: true, data: [] })
    }
    const raw = fs.readFileSync(filePath, "utf-8")
    const fields = JSON.parse(raw)
    if (!Array.isArray(fields)) {
      return NextResponse.json(
        { success: false, error: "Invalid fields format" },
        { status: 500 }
      )
    }
    const sorted = sortFields(fields)

    const pageParam = _request.nextUrl.searchParams.get("page")
    const limitParam = _request.nextUrl.searchParams.get("limit")
    if (pageParam != null && limitParam != null) {
      const page = Math.max(1, parseInt(pageParam, 10) || 1)
      const limit = Math.min(100, Math.max(1, parseInt(limitParam, 10) || 50))
      const start = (page - 1) * limit
      const slice = sorted.slice(start, start + limit)
      return NextResponse.json({
        success: true,
        data: slice,
        total: sorted.length,
      })
    }

    return NextResponse.json({ success: true, data: sorted })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/** 해당 테이블의 필드 목록 저장 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ tableKey: string }> }
) {
  try {
    const { tableKey } = await params
    const body = await req.json()
    const fields = body.data ?? body
    if (!Array.isArray(fields)) {
      return NextResponse.json(
        { success: false, error: "Invalid body: array of fields required" },
        { status: 400 }
      )
    }
    const filePath = getFilePath(tableKey)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const sorted = sortFields(fields)
    fs.writeFileSync(filePath, JSON.stringify(sorted, null, 2), "utf-8")
    return NextResponse.json({ success: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
