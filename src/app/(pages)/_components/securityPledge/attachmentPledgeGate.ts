/**
 * 첨부파일 다운로드 → 보안서약 모달 게이트 (모듈 싱글톤).
 * Host가 등록되어 있으면 직접 다운로드 대신 서약 접수로 넘긴다.
 */

export type AttachmentPledgeSingle = {
  mode: 'single'
  serEng: string
  pathB64?: string
  path?: string
  tableKorName: string
  fileName: string
}

export type AttachmentPledgeFolderZip = {
  mode: 'folderZip'
  serEng: string
  layer: string
  key: string
  label?: string
  tableKorName: string
}

export type AttachmentPledgeMulti = {
  mode: 'multi'
  serEng: string
  files: { pathB64?: string; path?: string; fileName?: string }[]
  zipName?: string
  tableKorName: string
}

/** 파일관리자·도로대장/CAD·정사영상·CAD잡 등 경로/잡 기반 */
export type AttachmentPledgeManaged = {
  mode: 'managed'
  source: 'fileManager' | 'roadDoc' | 'roadCad' | 'aerial' | 'cadJob'
  paths: string[]
  zipName?: string
  tableKorName: string
}

export type AttachmentPledgeRequest =
  | AttachmentPledgeSingle
  | AttachmentPledgeFolderZip
  | AttachmentPledgeMulti
  | AttachmentPledgeManaged

type Opener = (req: AttachmentPledgeRequest) => void

/** Turbopack/청크 중복 모듈에서도 같은 Host를 보게 globalThis에 둔다 */
const ATTACHMENT_PLEDGE_OPENER_KEY = '__ggnrAttachmentPledgeOpener__'

type AttachmentPledgeGlobal = typeof globalThis & {
  [ATTACHMENT_PLEDGE_OPENER_KEY]?: Opener | null
}

function getAttachmentOpener(): Opener | null {
  return (globalThis as AttachmentPledgeGlobal)[ATTACHMENT_PLEDGE_OPENER_KEY] ?? null
}

export function registerAttachmentPledgeOpener(fn: Opener | null): void {
  ;(globalThis as AttachmentPledgeGlobal)[ATTACHMENT_PLEDGE_OPENER_KEY] = fn
}

export function hasAttachmentPledgeOpener(): boolean {
  return getAttachmentOpener() != null
}

/** true면 Host가 서약 모달을 열었음 — 직접 다운로드 하지 말 것 */
export function requestAttachmentPledge(req: AttachmentPledgeRequest): boolean {
  const opener = getAttachmentOpener()
  if (!opener) return false
  opener(req)
  return true
}

function decodePathFromUrl(u: URL): { pathB64?: string; path?: string } | null {
  const pathB64 = u.searchParams.get('pathB64')
  if (pathB64 != null && pathB64.trim() !== '') return { pathB64: pathB64.trim() }
  const pathParam = u.searchParams.get('path')
  if (pathParam != null && pathParam.trim() !== '') return { path: pathParam.trim() }
  return null
}

/** /api/service-files/download|download-zip URL → 서약 요청 본문 */
export function parseServiceFileDownloadToPledge(
  url: string,
  fileNameHint?: string
): AttachmentPledgeRequest | null {
  let u: URL
  try {
    u = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://local.invalid')
  } catch {
    return null
  }
  const pathname = u.pathname
  const serEng = String(u.searchParams.get('serEng') ?? '').trim()
  if (!serEng) return null

  if (pathname.includes('/api/service-files/download-zip')) {
    const layer = String(u.searchParams.get('layer') ?? '').trim()
    const key = String(u.searchParams.get('key') ?? '').trim()
    if (!layer || !key) return null
    const label = String(u.searchParams.get('label') ?? '').trim()
    const tableKorName = label || fileNameHint?.replace(/\.zip$/i, '') || '첨부파일'
    return {
      mode: 'folderZip',
      serEng,
      layer,
      key,
      label: label || undefined,
      tableKorName,
    }
  }

  if (pathname.includes('/api/service-files/download')) {
    const decoded = decodePathFromUrl(u)
    if (!decoded) return null
    let fileName = String(fileNameHint ?? '').trim()
    if (!fileName) {
      try {
        const rel =
          decoded.pathB64 != null
            ? // 클라이언트에선 파일명만 힌트로 — pathB64 디코드는 서버에서
              ''
            : String(decoded.path ?? '')
        if (rel) fileName = rel.split('/').pop() ?? ''
      } catch {
        fileName = ''
      }
    }
    if (!fileName) fileName = '첨부파일'
    return {
      mode: 'single',
      serEng,
      ...decoded,
      tableKorName: fileName,
      fileName,
    }
  }

  return null
}

export function parseServiceFileUrlsToMultiPledge(
  items: { url: string; fileName: string }[],
  zipFileName: string,
  tableKorName?: string
): AttachmentPledgeMulti | null {
  if (items.length === 0) return null
  const files: AttachmentPledgeMulti['files'] = []
  let serEng = ''
  for (const item of items) {
    let u: URL
    try {
      u = new URL(
        item.url,
        typeof window !== 'undefined' ? window.location.origin : 'http://local.invalid'
      )
    } catch {
      continue
    }
    if (!u.pathname.includes('/api/service-files/download')) continue
    const eng = String(u.searchParams.get('serEng') ?? '').trim()
    if (!eng) continue
    if (!serEng) serEng = eng
    const decoded = decodePathFromUrl(u)
    if (!decoded) continue
    files.push({ ...decoded, fileName: item.fileName })
  }
  if (!serEng || files.length === 0) return null
  const name = zipFileName.toLowerCase().endsWith('.zip') ? zipFileName : `${zipFileName}.zip`
  return {
    mode: 'multi',
    serEng,
    files,
    zipName: name,
    tableKorName: (tableKorName ?? '').trim() || name.replace(/\.zip$/i, '') || '첨부파일',
  }
}
