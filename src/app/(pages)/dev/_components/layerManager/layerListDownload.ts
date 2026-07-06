export function triggerBlobDownload(blob: Blob, filename: string) {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(a.href)
}

export async function downloadLayerShp(tableName: string, schema: "layer" | "public_layer") {
  const res = await fetch("/api/download/shp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tableName, schema }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(typeof data?.error === "string" ? data.error : "SHP export failed")
  }
  const blob = await res.blob()
  triggerBlobDownload(blob, `${tableName}.zip`)
}

export async function downloadLayerExcel(pathRel: string | null, tableName: string) {
  const path =
    pathRel?.trim() || `excel_data/${tableName.replace(/[^a-zA-Z0-9_]/g, "_")}.xlsx`
  const q = new URLSearchParams({ path })
  const res = await fetch(`/api/download/excel?${q.toString()}`)
  if (!res.ok) {
    throw new Error(res.status === 404 ? "파일 없음" : "Excel 다운로드 실패")
  }
  const blob = await res.blob()
  const name = path.split(/[/\\]/).pop() ?? "download.xlsx"
  triggerBlobDownload(blob, name)
}
