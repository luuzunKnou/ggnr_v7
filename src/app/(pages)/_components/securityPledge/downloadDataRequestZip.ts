'use client'

import { withBasePath } from '@/lib/basePath'

/** 데이터요청 그룹 ZIP을 브라우저로 즉시 저장 (서약없음·자동승인 후) */
export async function downloadDataRequestZip(fileGroupKey: number): Promise<void> {
  const key = Number(fileGroupKey)
  if (!Number.isFinite(key) || key <= 0) {
    throw new Error('다운로드 키가 없습니다.')
  }
  const res = await fetch(
    withBasePath(`/api/data-request/download?fileGroupKey=${encodeURIComponent(String(key))}`),
    { credentials: 'include', cache: 'no-store' }
  )
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(typeof data.error === 'string' ? data.error : '다운로드 실패')
  }
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') ?? ''
  const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd)
  const rawName = m?.[1] ? decodeURIComponent(m[1]) : m?.[2]
  const fileName = rawName?.trim() || `data-request-${key}.zip`

  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(a.href)
}

/** 접수 성공 후 immediateDownload면 ZIP 저장, 아니면 confirm으로 데이터요청 이동 */
export async function afterDataRequestSubmit(result: {
  success: boolean
  fileGroupKey?: number
  immediateDownload?: boolean
  warning?: string | null
  error?: string
}): Promise<boolean> {
  if (!result.success) {
    window.alert(result.error ?? '접수에 실패했습니다.')
    return false
  }
  if (result.warning) {
    window.alert(String(result.warning))
  }
  if (result.immediateDownload && result.fileGroupKey) {
    try {
      await downloadDataRequestZip(result.fileGroupKey)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '다운로드 실패')
      return false
    }
    return true
  }
  return false
}
