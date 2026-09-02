/** 법령정보센터 Open API XML → 첨부파일 목록 */

export type LawHandbookAttachment = {
  name: string
  url: string
}

function normalizeLawUrl(url: string): string {
  const trimmed = url.trim()
  if (trimmed.startsWith("http://")) return `https://${trimmed.slice("http://".length)}`
  if (trimmed.startsWith("https://")) return trimmed
  if (trimmed.startsWith("//")) return `https:${trimmed}`
  if (trimmed.startsWith("/")) return `https://www.law.go.kr${trimmed}`
  return trimmed
}

function stripCdata(raw: string): string {
  const trimmed = raw.trim()
  const cdata = trimmed.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/)?.[1]
  return (cdata ?? trimmed).trim()
}

/** XML `<첨부파일>` 블록에서 파일명·다운로드 URL 추출 */
export function parseLawHandbookAttachmentsXml(xml: string): LawHandbookAttachment[] {
  const block = xml.match(/<첨부파일>([\s\S]*?)<\/첨부파일>/)?.[1]
  if (!block) return []

  const out: LawHandbookAttachment[] = []
  for (const m of block.matchAll(
    /<첨부파일명>([\s\S]*?)<\/첨부파일명>\s*<첨부파일링크>([\s\S]*?)<\/첨부파일링크>/g
  )) {
    const name = stripCdata(m[1] ?? "")
    const url = normalizeLawUrl(m[2] ?? "")
    if (name && url.includes("flDownload.do")) {
      out.push({ name, url })
    }
  }
  return out
}

export async function fetchLawHandbookAttachments(xmlApiUrl: string): Promise<LawHandbookAttachment[]> {
  const res = await fetch(xmlApiUrl, {
    cache: "no-store",
    headers: { Accept: "application/xml, text/xml, */*" },
  })
  if (!res.ok) {
    throw new Error(`법령 XML 조회 실패 (${res.status})`)
  }
  const xml = await res.text()
  return parseLawHandbookAttachmentsXml(xml)
}
