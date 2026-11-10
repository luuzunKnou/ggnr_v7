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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 선택 레이어 → 단일 DXF/DWG.
 * 서버에서 변환이 길어서 브라우저가 끊기지 않도록 잡 시작 → 폴링 → 파일 받기로 처리.
 */
export async function downloadLayersCad(
  layers: {
    tableName: string
    schema: "layer" | "public_layer"
    labelField?: string | null
  }[],
  format: "dxf" | "dwg",
  onProgress?: (message: string) => void
) {
  let startRes: Response
  try {
    startRes = await fetch("/api/download/cad", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layers, format }),
    })
  } catch {
    throw new Error("서버에 연결하지 못했습니다. 개발 서버가 실행 중인지 확인하세요.")
  }

  const startBody = (await startRes.json().catch(() => ({}))) as {
    jobId?: string
    error?: string
  }
  if (!startRes.ok || !startBody.jobId) {
    throw new Error(
      typeof startBody.error === "string" ? startBody.error : "CAD 변환을 시작하지 못했습니다."
    )
  }

  const jobId = startBody.jobId
  onProgress?.("CAD 변환 중… (레이어·라벨이 많으면 수 분 걸릴 수 있습니다)")

  const deadline = Date.now() + 15 * 60 * 1000
  let fileName = `layers.${format}`

  while (Date.now() < deadline) {
    await sleep(2000)
    let stRes: Response
    try {
      stRes = await fetch(`/api/download/cad?jobId=${encodeURIComponent(jobId)}`, {
        credentials: "include",
        cache: "no-store",
      })
    } catch {
      throw new Error("변환 상태 확인에 실패했습니다. 네트워크를 확인한 뒤 다시 시도하세요.")
    }
    const st = (await stRes.json().catch(() => ({}))) as {
      status?: string
      error?: string
      fileName?: string
      byteLength?: number
    }
    if (!stRes.ok) {
      throw new Error(typeof st.error === "string" ? st.error : "변환 상태 조회 실패")
    }
    if (st.status === "error") {
      throw new Error(typeof st.error === "string" ? st.error : "CAD 변환 실패")
    }
    if (st.status === "done") {
      if (st.fileName) fileName = st.fileName
      const mb =
        typeof st.byteLength === "number" ? ` (${(st.byteLength / (1024 * 1024)).toFixed(1)}MB)` : ""
      onProgress?.(`파일 받는 중…${mb}`)
      break
    }
    onProgress?.("CAD 변환 중…")
  }

  if (Date.now() >= deadline) {
    throw new Error("CAD 변환 시간이 너무 깁니다. 레이어·라벨을 줄인 뒤 다시 시도하세요.")
  }

  // fetch+blob 은 대용량에서 Failed to fetch 가 나기 쉬움 → 브라우저 기본 다운로드 사용
  onProgress?.("파일 저장 중…")
  const url = `/api/download/cad?jobId=${encodeURIComponent(jobId)}&download=1`
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

/** 업로드 원본 Excel/CSV 파일 다운로드 */
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

/** DB 테이블 → CSV 내보내기 (교차 다운로드) */
export async function downloadLayerCsvFromDb(
  tableName: string,
  schema: "layer" | "public_layer"
) {
  const res = await fetch("/api/download/excel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tableName, schema }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(typeof data?.error === "string" ? data.error : "CSV 내보내기 실패")
  }
  const blob = await res.blob()
  const cd = res.headers.get("Content-Disposition") ?? ""
  const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd)
  const rawName = m?.[1] ? decodeURIComponent(m[1]) : m?.[2]
  triggerBlobDownload(blob, rawName?.trim() || `${tableName}.csv`)
}
