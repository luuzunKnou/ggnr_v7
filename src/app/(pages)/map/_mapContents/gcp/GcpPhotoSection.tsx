'use client'

import { useMemo, useRef, useState } from 'react'
import { Upload, X } from 'lucide-react'
import { SER_FILE_ENG } from '@/lib/serviceFileDataSerEng'
import {
  isImageServiceFileName,
  requestServiceFileDataDelete,
  serviceFileDataDownloadUrl,
  useServiceFileChunkedUpload,
  useServiceFileData,
} from '@/app/(pages)/map/_mapComponents/standard/useServiceFileData'
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from '@/app/(pages)/map/_mapComponents/standard/ServiceFileImagePreview'

const SER_ENG = SER_FILE_ENG.gcp
const LAYER = 'gcp'

type Props = {
  /** ogc_fid 문자열 */
  gcpId: string
  canEdit?: boolean
}

export function GcpPhotoSection({ gcpId, canEdit = true }: Props) {
  const keyValue = String(gcpId ?? '').trim()
  const enabled = Boolean(keyValue)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [busy, setBusy] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const chunkUpload = useServiceFileChunkedUpload()
  const query = useServiceFileData({
    serEng: SER_ENG,
    enabled,
    layerSegment: LAYER,
    keyValue: enabled ? keyValue : null,
    refreshNonce,
  })

  const imageFiles = useMemo(
    () => query.files.filter((f) => isImageServiceFileName(f.name)),
    [query.files]
  )
  const photo = imageFiles[0] ?? null
  const photoUrl =
    photo && enabled
      ? serviceFileDataDownloadUrl(SER_ENG, LAYER, keyValue, photo.name)
      : null

  const previewItems = useMemo((): ServiceFilePreviewItem[] => {
    if (!photoUrl || !photo) return []
    return [{ url: photoUrl, fileName: photo.name, kind: 'image' }]
  }, [photo, photoUrl])

  const clearAllImages = async () => {
    for (const file of imageFiles) {
      const result = await requestServiceFileDataDelete({
        serEng: SER_ENG,
        layerSegment: LAYER,
        keyValue,
        fileName: file.name,
      })
      if (!result.ok) return result
    }
    return { ok: true as const }
  }

  const handlePick = async (list: FileList | null) => {
    const file = list?.[0]
    if (!file || !enabled || !canEdit) return
    if (!isImageServiceFileName(file.name)) {
      window.alert('이미지 파일만 첨부할 수 있습니다.')
      return
    }
    setBusy(true)
    try {
      const cleared = await clearAllImages()
      if (!cleared.ok) {
        window.alert(cleared.error)
        return
      }
      const result = await chunkUpload.upload({
        file,
        serEng: SER_ENG,
        layerSegment: LAYER,
        keyValue,
      })
      if (result && 'error' in result && result.error) {
        window.alert(result.error)
        return
      }
      setRefreshNonce((n) => n + 1)
      chunkUpload.reset()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '첨부에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!photo || !canEdit) return
    if (!window.confirm(`「${photo.name}」을(를) 삭제할까요?`)) return
    setBusy(true)
    try {
      const result = await requestServiceFileDataDelete({
        serEng: SER_ENG,
        layerSegment: LAYER,
        keyValue,
        fileName: photo.name,
      })
      if (!result.ok) {
        window.alert(result.error)
        return
      }
      setRefreshNonce((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  const uploading = busy || chunkUpload.state.status === 'uploading'

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium text-muted-foreground">첨부파일</div>
        {canEdit ? (
          <button
            type="button"
            disabled={!enabled || uploading}
            onClick={() => {
              chunkUpload.reset()
              inputRef.current?.click()
            }}
            className="shrink-0 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            파일 추가
          </button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void handlePick(e.target.files)
          e.target.value = ''
        }}
      />

      {chunkUpload.state.status === 'uploading' ? (
        <div className="mb-3 rounded border border-border bg-muted/30 px-3 py-2">
          <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Upload className="h-3.5 w-3.5 shrink-0" aria-hidden />
              업로드 중…
            </span>
            <span>{chunkUpload.state.progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[width] duration-150"
              style={{ width: `${chunkUpload.state.progress}%` }}
            />
          </div>
        </div>
      ) : null}

      {chunkUpload.state.status === 'error' && chunkUpload.state.error ? (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          {chunkUpload.state.error}
        </div>
      ) : null}

      {query.error ? (
        <p className="mb-2 text-[11px] text-destructive">{query.error}</p>
      ) : null}

      {query.loading ? (
        <div className="py-8 text-center text-xs text-muted-foreground">불러오는 중…</div>
      ) : !photo || !photoUrl ? (
        <div className="py-8 text-center text-xs text-muted-foreground">첨부파일 없음</div>
      ) : (
        <div className="group relative overflow-hidden rounded border border-border bg-muted/30">
          <button
            type="button"
            className="block w-full"
            onClick={() => setPreviewOpen(true)}
            title="크게 보기"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl}
              alt={photo.name}
              className="mx-auto max-h-56 w-full object-contain"
              decoding="async"
            />
          </button>
          {canEdit ? (
            <button
              type="button"
              disabled={uploading}
              onClick={() => void handleDelete()}
              className="absolute right-1 top-1 rounded bg-background/90 p-1 text-muted-foreground shadow-sm ring-1 ring-border/80 hover:bg-red-50 hover:text-red-600 disabled:pointer-events-none disabled:opacity-50"
              title="삭제"
              aria-label="삭제"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      )}

      {previewOpen && previewItems.length > 0 ? (
        <ServiceFileImagePreview
          items={previewItems}
          initialIndex={0}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </div>
  )
}
