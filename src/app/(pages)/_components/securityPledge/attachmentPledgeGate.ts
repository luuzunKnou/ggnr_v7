/**
 * 첨부파일 다운로드 → 보안서약 모달 게이트 (모듈 싱글톤).
 * Host가 등록되어 있으면 직접 다운로드 대신 서약 접수로 넘긴다.
 */
import { decodeServiceFileDataPathB64 } from '@/lib/serviceFileData'

export type AttachmentPledgeSingle = {
  mode: 'single'
  serEng: string
  pathB64?: string
  path?: string
  tableKorName: string
  fileName: string
  schema?: 'layer' | 'public_layer'
  tableName?: string
}

export type AttachmentPledgeFolderZip = {
  mode: 'folderZip'
  serEng: string
  layer: string
  key: string
  label?: string
  tableKorName: string
  schema?: 'layer' | 'public_layer'
  tableName?: string
}

export type AttachmentPledgeMulti = {
  mode: 'multi'
  serEng: string
  files: { pathB64?: string; path?: string; fileName?: string }[]
  zipName?: string
  tableKorName: string
  schema?: 'layer' | 'public_layer'
  tableName?: string
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

/** file_data/{layer}/{key}/... 상대경로 → 레이어명 */
function layerFromFileDataRelative(rel: string | null | undefined): string | undefined {
  const norm = String(rel ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  if (!norm.startsWith('file_data/')) return undefined
  const parts = norm.slice('file_data/'.length).split('/').filter(Boolean)
  const layer = String(parts[0] ?? '').trim()
  return layer || undefined
}

function layerFromPathOrB64(args: {
  path?: string
  pathB64?: string
}): string | undefined {
  const fromPath = layerFromFileDataRelative(args.path)
  if (fromPath) return fromPath
  const b64 = String(args.pathB64 ?? '').trim()
  if (!b64) return undefined
  return layerFromFileDataRelative(decodeServiceFileDataPathB64(b64) ?? '')
}

function layerNameFromAttachmentReq(req: AttachmentPledgeRequest): {
  tableName?: string
  schema?: 'layer' | 'public_layer'
} {
  if (req.mode === 'folderZip') {
    return {
      tableName: req.tableName || req.layer,
      schema: req.schema,
    }
  }
  if (req.mode === 'single') {
    const tableName =
      req.tableName ||
      layerFromPathOrB64({ path: req.path, pathB64: req.pathB64 })
    return { tableName, schema: req.schema }
  }
  if (req.mode === 'multi') {
    const fromFiles = req.files?.[0]
      ? layerFromPathOrB64({
          path: req.files[0].path,
          pathB64: req.files[0].pathB64,
        })
      : undefined
    return {
      tableName: req.tableName || fromFiles,
      schema: req.schema,
    }
  }
  return {}
}

/**
 * true면 Host가 서약 모달을 열었거나 none 즉시 접수를 시작함 — 직접 다운로드 하지 말 것.
 * 레이어 attachment 권한이 none이면 서약 없이 접수·즉시 다운로드.
 */
export function requestAttachmentPledge(req: AttachmentPledgeRequest): boolean {
  const { tableName, schema } = layerNameFromAttachmentReq(req)
  if (tableName) {
    void (async () => {
      try {
        const { call } = await import('@/lib/api')
        const { afterDataRequestSubmit } = await import(
          '@/app/(pages)/_components/securityPledge/downloadDataRequestZip'
        )
        const { postDataRequestJson } = await import(
          '@/app/(pages)/_components/securityPledge/SecurityPledgeModal'
        )
        const authRes = await call('', 'POST', {
          service: 'layerDownloadAuthService',
          action: 'getLayerDownloadAuth',
          params: { tableName, schema },
        })
        const d = authRes?.data ?? authRes
        const attachment =
          d?.attachment ?? d?.data?.attachment ?? null
        if (d?.success && attachment === 'none') {
          let body: Record<string, unknown>
          let url = '/api/data-request/submit-attachment'
          if (req.mode === 'folderZip') {
            body = {
              mode: 'folderZip',
              serEng: req.serEng,
              layer: req.layer,
              key: req.key,
              label: req.label,
              tableKorName: req.tableKorName,
              tableName,
              schema,
            }
          } else if (req.mode === 'multi') {
            body = {
              mode: 'multi',
              serEng: req.serEng,
              files: req.files,
              zipName: req.zipName,
              tableKorName: req.tableKorName,
              tableName,
              schema,
            }
          } else if (req.mode === 'managed') {
            if (req.source === 'cadJob') {
              url = '/api/data-request/submit-cad-job'
              body = {
                jobId: req.paths[0] ?? '',
                tableKorName: req.tableKorName,
              }
            } else {
              url = '/api/data-request/submit-managed-path'
              body = {
                source: req.source,
                paths: req.paths,
                zipName: req.zipName,
                tableKorName: req.tableKorName,
              }
            }
          } else {
            body = {
              mode: 'single',
              serEng: req.serEng,
              pathB64: req.pathB64,
              path: req.path,
              tableKorName: req.tableKorName,
              tableName,
              schema,
            }
          }
          const submitted = await postDataRequestJson(url, body)
          await afterDataRequestSubmit({
            ...submitted,
            immediateDownload: submitted.immediateDownload ?? true,
          })
          return
        }
      } catch (e) {
        console.error('[requestAttachmentPledge] none path', e)
      }
      const opener = getAttachmentOpener()
      if (opener) opener(req)
      else {
        console.warn('[requestAttachmentPledge] SecurityPledgeAttachmentHost 미등록')
        window.alert(
          '보안서약 화면을 열 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.'
        )
      }
    })()
    return true
  }

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
      tableName: layer,
    }
  }

  if (pathname.includes('/api/service-files/download')) {
    const decoded = decodePathFromUrl(u)
    if (!decoded) return null
    let fileName = String(fileNameHint ?? '').trim()
    let relForLayer = String(decoded.path ?? '').trim()
    if (!relForLayer && decoded.pathB64) {
      relForLayer = decodeServiceFileDataPathB64(decoded.pathB64) ?? ''
    }
    if (!fileName) {
      try {
        if (relForLayer) fileName = relForLayer.split('/').pop() ?? ''
      } catch {
        fileName = ''
      }
    }
    if (!fileName) fileName = '첨부파일'
    const tableName = layerFromFileDataRelative(relForLayer)
    return {
      mode: 'single',
      serEng,
      ...decoded,
      tableKorName: fileName,
      fileName,
      ...(tableName ? { tableName } : {}),
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
  const first = files[0]
  const tableName = first
    ? layerFromPathOrB64({ path: first.path, pathB64: first.pathB64 })
    : undefined
  return {
    mode: 'multi',
    serEng,
    files,
    zipName: name,
    tableKorName: (tableKorName ?? '').trim() || name.replace(/\.zip$/i, '') || '첨부파일',
    ...(tableName ? { tableName } : {}),
  }
}
