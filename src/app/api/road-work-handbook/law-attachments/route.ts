import { NextResponse } from "next/server"
import {
  fetchLawHandbookAttachments,
  getHandbookLawXmlApiUrl,
  isHandbookLawMaterialId,
} from "@/service/roadWorkHandbookLawService"

export const dynamic = "force-dynamic"

/** GET — materialId에 연결된 법령 XML에서 첨부파일 목록 */
export async function GET(req: Request) {
  const materialId = new URL(req.url).searchParams.get("materialId")?.trim() ?? ""
  if (!materialId || !isHandbookLawMaterialId(materialId)) {
    return NextResponse.json({ error: "invalid materialId" }, { status: 400 })
  }

  const xmlApiUrl = getHandbookLawXmlApiUrl(materialId)
  if (!xmlApiUrl) {
    return NextResponse.json({ error: "not a law xml material" }, { status: 404 })
  }

  try {
    const attachments = await fetchLawHandbookAttachments(xmlApiUrl)
    return NextResponse.json({ attachments })
  } catch (e) {
    console.error("[road-work-handbook/law-attachments]", materialId, e)
    return NextResponse.json({ error: "법령 첨부파일을 불러오지 못했습니다.", attachments: [] }, { status: 502 })
  }
}
