'use client'

import { useMemo, useRef, useState } from 'react'
import { Download, Image as ImageIcon, Paperclip, Plus, Trash2, Upload } from 'lucide-react'
import { SER_FILE_ENG } from '@/lib/serviceFileDataSerEng'
import {
  isImageServiceFileName,
  requestServiceFileDataDelete,
  serviceFileDataDownloadUrl,
  triggerServiceFileDownload,
  useServiceFileChunkedUpload,
  useServiceFileData,
} from '@/app/(pages)/map/_mapComponents/standard/useServiceFileData'
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from '@/app/(pages)/map/_mapComponents/standard/ServiceFileImagePreview'

const SER_ENG = SER_FILE_ENG.gcp
const LAYER = 'gcp'

const btnPrimary =
  'inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50'

type Props = {
  /** ogc_fid 문자열 */
  gcpId: string
  canEdit?: boolean
}

/** GCP 위치 사진 1장 — 공사대장형 헤더 + 사진·동영상 파일상세처럼 큰 미리보기 */
export function GcpPhotoSection({ gcpId, canEdit = true }: Props) {
  const keyValue = String(gcpId ?? '').trim()
  const enabled = Boolean(keyValue)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [busy, setBusy] = useState(false)
  /** 삭제 전 미리보기 언마운트 — SMB 잠금(EBUSY) 완화 */
  const [hidePreview, setHidePreview] = useState(false)
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
    !hidePreview && photo && enabled
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
    setHidePreview(true)
    try {
      await new Promise((r) => setTimeout(r, 120))
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
      setHidePreview(false)
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const handleDelete = async () => {
    if (!photo || !canEdit || !enabled) return
    if (!window.confirm(`«${photo.name}»을(를) 삭제할까요?`)) return
    setBusy(true)
    setPreviewOpen(false)
    setHidePreview(true)
    try {
      /** 브라우저 img 핸들 해제 대기 */
      await new Promise((r) => setTimeout(r, 150))
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
      setHidePreview(false)
      setBusy(false)
    }
  }

  const handleDownload = () => {
    if (!photo || !enabled) return
    const url = serviceFileDataDownloadUrl(SER_ENG, LAYER, keyValue, photo.name)
    triggerServiceFileDownload(url, photo.name)
  }

  const uploading = busy || chunkUpload.state.status === 'uploading'

  return (
    <div className="mt-3 flex min-h-[12rem] flex-col border-t border-border pt-2">
      <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
        <div className="standard-detail-section-toggle-label flex items-center gap-1">
          <Paperclip className="h-3.5 w-3.5" />
          첨부파일
        </div>
        {canEdit ? (
          <button
            type="button"
            className={btnPrimary}
            disabled={!enabled || uploading}
            title={enabled ? '첨부 업로드' : '저장 후 첨부할 수 있습니다'}
            onClick={() => {
              chunkUpload.reset()
              inputRef.current?.click()
            }}
          >
            <Plus className="h-3 w-3" />
            첨부
          </button>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void handlePick(e.target.files)}
        />
      </div>

      {chunkUpload.state.status === 'uploading' ? (
        <div className="mb-2 rounded border border-border bg-muted/30 px-3 py-2">
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
        <div className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          {chunkUpload.state.error}
        </div>
      ) : null}

      {query.error ? (
        <p className="mb-2 text-[11px] text-destructive">{query.error}</p>
      ) : null}

      {query.loading ? (
        <p className="py-3 text-center text-[11px] text-muted-foreground">첨부 목록 불러오는 중…</p>
      ) : !photo || !photoUrl ? (
        <div className="flex min-h-[12rem] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-4 text-muted-foreground">
          <ImageIcon className="h-8 w-8 opacity-70" aria-hidden />
          <p className="text-center text-[11px]">등록된 첨부파일이 없습니다.</p>
        </div>
      ) : (
        <div className="group relative overflow-hidden rounded-lg border border-border bg-muted/30">
          <button
            type="button"
            className="block w-full cursor-zoom-in text-left"
            onClick={() => setPreviewOpen(true)}
            title="클릭하여 크게 보기"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- 인증 쿠키 포함 미리보기 */}
            <img
              src={photoUrl}
              alt=""
              className="mx-auto max-h-[min(56vh,420px)] w-full object-contain"
              decoding="async"
            />
          </button>
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end gap-1 p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              disabled={uploading}
              onClick={(e) => {
                e.stopPropagation()
                handleDownload()
              }}
              className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-background text-foreground/90 shadow-md ring-1 ring-border/80 hover:bg-muted/50 hover:text-primary disabled:pointer-events-none disabled:opacity-50"
              title="다운로드"
              aria-label="다운로드"
            >
              <Download className="h-4 w-4" />
            </button>
            {canEdit ? (
              <button
                type="button"
                disabled={uploading}
                onClick={(e) => {
                  e.stopPropagation()
                  void handleDelete()
                }}
                className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-background text-destructive shadow-md ring-1 ring-border/80 hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
                title="삭제"
                aria-label="삭제"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
          </div>
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
