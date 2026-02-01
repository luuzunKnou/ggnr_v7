import { NextRequest, NextResponse } from "next/server"
import * as fs from "fs"
import * as path from "path"

const CODES_DIR = path.join(process.cwd(), "src", "config", "defineLayer", "codes")

function getFilePath(fieldKey: string): string {
  const safe = String(fieldKey).replace(/[^a-zA-Z0-9_-]/g, "")
  return path.join(CODES_DIR, `field_${safe}.json`)
}

/** 해당 필드의 코드 목록 조회 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ fieldKey: string }> }
) {
  try {
    const { fieldKey } = await params
    const filePath = getFilePath(fieldKey)
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ success: true, data: [] })
    }
    const raw = fs.readFileSync(filePath, "utf-8")
    const data = JSON.parse(raw)
    if (!Array.isArray(data)) {
      return NextResponse.json({ success: false, error: "Invalid codes format" }, { status: 500 })
    }
    return NextResponse.json({ success: true, data })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/** 해당 필드의 코드 목록 저장 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ fieldKey: string }> }
) {
  try {
    const { fieldKey } = await params
    const body = await req.json()
    const codes = body.data ?? body
    if (!Array.isArray(codes)) {
      return NextResponse.json(
        { success: false, error: "Invalid body: array of codes required" },
        { status: 400 }
      )
    }
    const filePath = getFilePath(fieldKey)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(codes, null, 2), "utf-8")
    return NextResponse.json({ success: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
