import { NextRequest, NextResponse } from "next/server"
import {
  readDefineLayerCodes,
  writeDefineLayerCodes,
} from "@/lib/defineLayerCodeFiles"

/** tableField = tableName__fieldName. 해당 필드의 코드 목록 조회 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tableField: string }> }
) {
  try {
    const { tableField } = await params
    const data = readDefineLayerCodes(tableField)
    return NextResponse.json({ success: true, data })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/** 해당 필드의 코드 목록 저장 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ tableField: string }> }
) {
  try {
    const { tableField } = await params
    const body = await req.json()
    const codes = body.data ?? body
    if (!Array.isArray(codes)) {
      return NextResponse.json(
        { success: false, error: "Invalid body: array of codes required" },
        { status: 400 }
      )
    }
    writeDefineLayerCodes(tableField, codes)
    return NextResponse.json({ success: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
