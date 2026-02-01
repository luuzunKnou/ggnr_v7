import { NextResponse } from "next/server"
import * as fs from "fs"
import * as path from "path"

const FIELDS_DIR = path.join(process.cwd(), "src", "config", "defineLayer", "fields")

/** CODE 타입 필드가 하나라도 있는 테이블 키 목록 반환 */
export async function GET() {
  try {
    if (!fs.existsSync(FIELDS_DIR)) {
      return NextResponse.json({ success: true, tableKeys: [] })
    }
    const files = fs.readdirSync(FIELDS_DIR).filter((f) => f.startsWith("table_") && f.endsWith(".json"))
    const tableKeys: string[] = []
    for (const file of files) {
      const tableKey = file.replace(/^table_|\.json$/g, "")
      const filePath = path.join(FIELDS_DIR, file)
      const raw = fs.readFileSync(filePath, "utf-8")
      let arr: unknown[]
      try {
        arr = JSON.parse(raw)
      } catch {
        continue
      }
      if (!Array.isArray(arr)) continue
      const hasCode = arr.some(
        (row) => String((row as Record<string, unknown>).define_field_type ?? "").toUpperCase() === "CODE"
      )
      if (hasCode) tableKeys.push(tableKey)
    }
    return NextResponse.json({ success: true, tableKeys })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
