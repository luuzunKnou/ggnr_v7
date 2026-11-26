import { appFetch } from '@/lib/basePath'
import { type SmallPublicAttachScope, parseSmallPublicScope } from '@/lib/smallPublicAttachScope'
import type { SmallPublicFile, SmallPublicFileKind } from './smallPublicMock'

function fileQuery(file: SmallPublicFile): URLSearchParams {
  try {
    return new URLSearchParams((file.url ?? '').split('?')[1] ?? '')
  } catch {
    return new URLSearchParams()
  }
}

/** 파일 주소에 붙은 연도 폴더(없으면 시설 공통 루트 파일) */
export function smallPublicFileYear(file: SmallPublicFile): string {
  return fileQuery(file).get('year') ?? ''
}

/** 파일이 있는 폴더 구분 — 연도가 없으면 시설 공통, 구분이 없는 예전 주소는 안전점검 */
export function smallPublicFileScope(file: SmallPublicFile): SmallPublicAttachScope {
  const q = fileQuery(file)
  if (!q.get('year')) return 'common'
  return parseSmallPublicScope(q.get('scope'))
}

/**
 * 서버 폴더에 첨부 업로드 — 저장된 파일 목록(실제 파일명) 반환.
 * inspection → 안전점검_{연도}/, candidate → 후보지_{연도}/, common → 관리번호 폴더(시설 공통, 연도 무시)
 */
export async function uploadSmallPublicFiles(params: {
  mngNo: string
  scope: SmallPublicAttachScope
  year: string
  files: File[]
  kind: SmallPublicFileKind
}): Promise<SmallPublicFile[]> {
  const { mngNo, scope, year, files, kind } = params
  const fd = new FormData()
  fd.set('mngNo', mngNo)
  fd.set('scope', scope)
  fd.set('year', year)
  for (const f of files) fd.append('files', f)
  const res = await appFetch('/api/small-public/file', { method: 'POST', body: fd })
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean
    error?: string
    files?: Array<{ name: string; url: string; year: string; scope?: SmallPublicAttachScope }>
  }
  if (!res.ok || !json.success || !json.files) throw new Error(json.error || '첨부 업로드에 실패했습니다.')
  return json.files.map((f) => ({
    id: `${mngNo}-${scope}-${f.year || 'root'}-up-${f.name}`,
    name: f.name,
    url: f.url,
    kind,
  }))
}

/** 서버 폴더의 첨부 삭제 — 주소에 담긴 구분·연도 폴더(없으면 시설 공통) 기준 */
export async function deleteSmallPublicFile(mngNo: string, file: SmallPublicFile): Promise<void> {
  const scope = smallPublicFileScope(file)
  const year = smallPublicFileYear(file)
  const qs = new URLSearchParams({ mngNo, name: file.name, scope })
  if (year) qs.set('year', year)
  const res = await appFetch(`/api/small-public/file?${qs.toString()}`, { method: 'DELETE' })
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(json.error || '첨부 삭제에 실패했습니다.')
  }
}

/** 안전점검 첨부 업로드 — 안전점검_{연도}/ */
export function uploadInspectionFiles(mngNo: string, year: string, files: File[]): Promise<SmallPublicFile[]> {
  return uploadSmallPublicFiles({ mngNo, scope: 'inspection', year, files, kind: 'safety' })
}

/** 서버 첨부 삭제(안전점검·후보지·시설 공통 모두) */
export const deleteInspectionFile = deleteSmallPublicFile
