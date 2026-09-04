import { NextResponse } from "next/server"
import { fetchLawHandbookAttachments } from "@/service/roadWorkHandbookLawService"
import { getHandbookMaterialXmlUrl } from "@/service/roadWorkHandbookService"

export const dynamic = "force-dynamic"

/** GET — 자료의 법령 XML에서 첨부파일 목록 */
export async function GET(req: Request) {
  const materialId = new URL(req.url).searchParams.get("materialId")?.trim() ?? ""
  const found = await getHandbookMaterialXmlUrl({ id: materialId })
  const xmlApiUrl = found.xmlUrl
  if (!xmlApiUrl) {
    return NextResponse.json({ error: "invalid materialId" }, { status: 400 })
  }

  try {
    const attachments = await fetchLawHandbookAttachments(xmlApiUrl)
    return NextResponse.json({ attachments })
  } catch (e) {
    console.error("[road-work-handbook/law-attachments]", materialId, e)
    return NextResponse.json({ error: "법령 첨부파일을 불러오지 못했습니다.", attachments: [] }, { status: 502 })
  }
}
