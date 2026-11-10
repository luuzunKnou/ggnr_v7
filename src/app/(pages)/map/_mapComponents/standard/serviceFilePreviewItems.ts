import {
  isExcelServiceFileName,
  isImageServiceFileName,
  isPdfServiceFileName,
} from './useServiceFileData'
import type { ServiceFilePreviewItem } from './ServiceFileImagePreview'

export type ServiceFilePreviewKind = ServiceFilePreviewItem['kind']

/** 이미지·PDF·엑셀 미리보기 가능 여부 */
export function isServiceFilePreviewableName(name: string): boolean {
  return (
    isImageServiceFileName(name) ||
    isPdfServiceFileName(name) ||
    isExcelServiceFileName(name)
  )
}

export function resolveServiceFilePreviewKind(name: string): ServiceFilePreviewKind | null {
  if (isPdfServiceFileName(name)) return 'pdf'
  if (isExcelServiceFileName(name)) return 'excel'
  if (isImageServiceFileName(name)) return 'image'
  return null
}

export function buildServiceFilePreviewItem(
  fileName: string,
  url: string
): ServiceFilePreviewItem | null {
  const kind = resolveServiceFilePreviewKind(fileName)
  if (!kind) return null
  return { url, fileName, kind }
}

/** 파일 목록 → 갤러리 items (미리보기 불가 확장자 제외) */
export function buildServiceFilePreviewGalleryItems(
  files: { name: string }[],
  urlFor: (fileName: string) => string
): ServiceFilePreviewItem[] {
  const out: ServiceFilePreviewItem[] = []
  for (const f of files) {
    const name = String(f.name ?? '').trim()
    if (!name) continue
    const item = buildServiceFilePreviewItem(name, urlFor(name))
    if (item) out.push(item)
  }
  return out
}
