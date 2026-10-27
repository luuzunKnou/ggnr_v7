'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { ChevronDown, Download, File, FileImage, FileText, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/app/shadcnComponents/ui/button'
import { SER_FILE_ENG } from '@/lib/serviceFileDataSerEng'
import { cn } from '@/lib/utils'
import {
  getRowKey,
  getRowValueByField,
  isDefineFieldFlagTrue,
  type DefineFieldLike,
} from '../../../_mapComponents/standard/defineLayerRowUtils'
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from '../../../_mapComponents/standard/ServiceFileImagePreview'
import {
  isImageServiceFileName,
  isPdfServiceFileName,
  requestServiceFileDataDelete,
  serviceFileDataDownloadUrl,
  serviceFileDataZipDownloadUrl,
  triggerServiceFileDownload,
  useServiceFileChunkedUpload,
  useServiceFileData,
} from '../../../_mapComponents/standard/useServiceFileData'
import { getWtlNetLayerDef } from './wtlNetworkLayerCatalog'
import { getWtlNetMapSource } from './wtlNetworkMapSources'
import type { WtlNetworkRow } from './wtlNetworkTypes'

const SER_ENG = SER_FILE_ENG.dataQuery

function formatFileSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function getFileIcon(name: string) {
  if (isImageServiceFileName(name)) {
    return <FileImage className="h-5 w-5 text-sky-500/80" />
  }
  if (isPdfServiceFileName(name)) {
    return <FileText className="h-5 w-5 text-red-500/80" />
  }
  return <File className="h-5 w-5 text-muted-foreground/80" />
}

/** id = sourceId:layerKey:ogcFid | layerKey:ogcFid */
function parseRowId(id: string): { sourceId?: string; layerKey: string; ogcFid: number } | null {
  const raw = String(id ?? '').trim()
  if (!raw.includes(':')) return null
  const parts = raw.split(':')
  if (parts.length >= 3 && getWtlNetMapSource(parts[0]!)) {
    const ogcFid = Number(parts[parts.length - 1])
    if (!Number.isFinite(ogcFid)) return null
    return {
      sourceId: parts[0],
      layerKey: parts.slice(1, -1).join(':'),
      ogcFid,
    }
  }
  const idx = raw.lastIndexOf(':')
  const layerKey = raw.slice(0, idx)
  const ogcFid = Number(raw.slice(idx + 1))
  if (!layerKey || !Number.isFinite(ogcFid)) return null
  return { layerKey, ogcFid }
}

/** 데이터조회와 동일 — file_data/{물리테이블}/{키}/ */
export function resolveWtlNetworkAttachmentTarget(
  item: WtlNetworkRow,
  fields: readonly DefineFieldLike[]
): { layerSegment: string; keyValue: string; layerDisplayName: string } | null {
  const parsed = parseRowId(item.id)
  const def = getWtlNetLayerDef(item.layerKey || parsed?.layerKey || '')
  const source = parsed?.sourceId ? getWtlNetMapSource(parsed.sourceId) : undefined
  const baseTable = String(def?.table ?? item.fieldsTable ?? '').trim()
  if (!baseTable) return null
  const layerSegment = String(source?.remapTable(baseTable) ?? baseTable).trim()
  if (!layerSegment) return null

  const keyField = fields.find((f) =>
    isDefineFieldFlagTrue((f as { define_field_is_key?: unknown }).define_field_is_key)
  )
  const keyFieldName = String(keyField?.define_field_name ?? '').trim() || null
  const record = item.record ?? null
  let keyValue: string | null = null
  if (record && keyFieldName) {
    const fromKey = getRowKey(record, keyFieldName)
    if (fromKey != null && String(fromKey).trim() !== '') keyValue = String(fromKey).trim()
  }
  if (keyValue == null && record) {
    for (const f of ['ogc_fid', 'gid', 'id'] as const) {
      const v = getRowValueByField(record, f)
      if (v != null && String(v).trim() !== '') {
        keyValue = String(v).trim()
        break
      }
    }
  }
  if (keyValue == null && parsed && Number.isFinite(parsed.ogcFid)) {
    keyValue = String(parsed.ogcFid)
  }
  if (!keyValue) return null

  return {
    layerSegment,
    keyValue,
    layerDisplayName: layerSegment,
  }
}

type Props = {
  item: WtlNetworkRow
  fields: readonly DefineFieldLike[]
  canEdit?: boolean
}

export function WtlNetworkMapAttachmentSection({ item, fields, canEdit = true }: Props) {
  const target = useMemo(
    () => resolveWtlNetworkAttachmentTarget(item, fields),
    [item, fields]
  )
  const enabled = target != null
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(
    null
  )
  const [attachmentImagePreview, setAttachmentImagePreview] = useState<{
    items: ServiceFilePreviewItem[]
    initialIndex: number
  } | null>(null)
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false)
  const [individualMenuOpen, setIndividualMenuOpen] = useState(false)
  const downloadMenuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadingLockRef = useRef(false)
  const chunkUpload = useServiceFileChunkedUpload()
  const query = useServiceFileData({
    serEng: SER_ENG,
    enabled,
    layerSegment: target?.layerSegment ?? null,
    keyValue: target?.keyValue ?? null,
    refreshNonce,
  })
  const isUploading = batchProgress != null || chunkUpload.state.status === 'uploading'

  useEffect(() => {
    if (!downloadMenuOpen) {
      setIndividualMenuOpen(false)
      return
    }
    const onDoc = (e: MouseEvent) => {
      if (downloadMenuRef.current?.contains(e.target as Node)) return
      setDownloadMenuOpen(false)
      setIndividualMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [downloadMenuOpen])

  const previewGalleryItems = useMemo((): ServiceFilePreviewItem[] => {
    if (!target) return []
    return query.files
      .filter((f) => isImageServiceFileName(f.name) || isPdfServiceFileName(f.name))
      .map((f) => ({
        url: serviceFileDataDownloadUrl(SER_ENG, target.layerSegment, target.keyValue, f.name),
        fileName: f.name,
        kind: isPdfServiceFileName(f.name) ? ('pdf' as const) : ('image' as const),
      }))
  }, [query.files, target])

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!target || files.length === 0 || uploadingLockRef.current) return
      uploadingLockRef.current = true
      setBatchProgress({ done: 0, total: files.length })
      let failed: string | null = null
      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i]!
          setBatchProgress({ done: i, total: files.length })
          const result = await chunkUpload.upload({
            file,
            serEng: SER_ENG,
            layerSegment: target.layerSegment,
            keyValue: target.keyValue,
          })
          if (result?.error) {
            failed = result.error
            break
          }
          chunkUpload.reset()
        }
      } finally {
        uploadingLockRef.current = false
        setBatchProgress(null)
        setRefreshNonce((n) => n + 1)
        chunkUpload.reset()
        if (inputRef.current) inputRef.current.value = ''
      }
      if (failed) window.alert(failed)
    },
    [chunkUpload, target]
  )

  const onDragEnter = (e: DragEvent) => {
    if (!canEdit || !target) return
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }
  const onDragOver = (e: DragEvent) => {
    if (!canEdit || !target) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }
  const onDragLeave = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const next = e.relatedTarget as Node | null
    if (next && e.currentTarget.contains(next)) return
    setDragOver(false)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    if (!canEdit || !target || isUploading) return
    const list = Array.from(e.dataTransfer.files ?? []).filter((f) => f.size >= 0)
    void uploadFiles(list)
  }

  if (!enabled || !target) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center p-6">
        <p className="text-center text-[12px] text-muted-foreground/80">
          첨부 폴더를 확인할 수 없습니다. (레이어·키 값 없음)
        </p>
      </div>
    )
  }

  const uploadLabel =
    batchProgress != null
      ? `${batchProgress.done + 1}/${batchProgress.total}`
      : chunkUpload.state.status === 'uploading'
        ? `${chunkUpload.state.progress}%`
        : '파일 추가'

  return (
    <>
      <div
        className={cn(
          'relative flex h-full min-h-0 flex-col rounded-xl transition-colors',
          dragOver && 'ring-2 ring-primary ring-inset bg-primary/5'
        )}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {dragOver && canEdit ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-primary/10">
            <p className="rounded border border-primary/40 bg-background/90 px-3 py-1.5 text-[12px] font-medium text-primary">
              여기에 파일을 놓으세요
            </p>
          </div>
        ) : null}
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-1 p-1">
            {query.loading ? (
              <div className="py-8 text-center text-[12px] text-muted-foreground/80">불러오는 중…</div>
            ) : query.error ? (
              <div className="py-8 text-center text-[12px] text-red-600">{query.error}</div>
            ) : query.files.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-1 px-3 py-8 text-center">
                <p className="text-[12px] text-muted-foreground/80">첨부파일이 없습니다.</p>
                {canEdit ? (
                  <p className="text-[11px] text-muted-foreground/70">
                    파일을 끌어다 놓거나 «파일 추가»로 등록하세요.
                  </p>
                ) : null}
              </div>
            ) : (
              query.files.map((f) => {
                const url = serviceFileDataDownloadUrl(
                  SER_ENG,
                  target.layerSegment,
                  target.keyValue,
                  f.name
                )
                const isImg = isImageServiceFileName(f.name)
                const isPdf = isPdfServiceFileName(f.name)
                const modified =
                  f.modified != null && String(f.modified).trim()
                    ? String(f.modified).slice(0, 19).replace('T', ' ')
                    : '-'
                const activateRow = () => {
                  if (isImg || isPdf) {
                    const idx = previewGalleryItems.findIndex((i) => i.fileName === f.name)
                    setAttachmentImagePreview({
                      items: previewGalleryItems,
                      initialIndex: idx >= 0 ? idx : 0,
                    })
                  } else {
                    triggerServiceFileDownload(url, f.name)
                  }
                }
                return (
                  <div
                    key={f.name}
                    tabIndex={0}
                    role="group"
                    aria-label={
                      isImg || isPdf ? `${f.name} 크게 보기` : `${f.name} 다운로드`
                    }
                    className="group flex cursor-pointer items-center gap-2 rounded-lg border border-border/80 bg-card p-1 transition-colors hover:bg-muted/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    onClick={activateRow}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        activateRow()
                      }
                    }}
                  >
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-muted/50">
                      {getFileIcon(f.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-normal text-foreground/90">{f.name}</p>
                      <p className="text-[12px] text-muted-foreground/90">
                        {formatFileSize(f.size)} | {modified}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="다운로드"
                      className="h-8 w-8 cursor-pointer text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation()
                        triggerServiceFileDownload(url, f.name)
                      }}
                    >
                      <Download className="h-4 w-4" />
                      <span className="sr-only">다운로드</span>
                    </Button>
                    {canEdit ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="삭제"
                        className="h-8 w-8 cursor-pointer text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!window.confirm(`「${f.name}」을(를) 삭제할까요?`)) return
                          void requestServiceFileDataDelete({
                            serEng: SER_ENG,
                            layerSegment: target.layerSegment,
                            keyValue: target.keyValue,
                            fileName: f.name,
                          }).then((r) => {
                            if (r.ok) setRefreshNonce((n) => n + 1)
                            else alert(r.error)
                          })
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">삭제</span>
                      </Button>
                    ) : null}
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border px-3 py-2.5">
          <span className="text-[12px] text-muted-foreground">
            첨부파일{' '}
            <span className="font-semibold text-foreground">{query.files.length}</span>건
          </span>
          <div className="flex items-center gap-1.5">
            {chunkUpload.state.status === 'error' && chunkUpload.state.error ? (
              <span
                className="max-w-[8rem] truncate text-[11px] text-red-600"
                title={chunkUpload.state.error}
              >
                {chunkUpload.state.error}
              </span>
            ) : null}
            {query.files.length === 0 ? (
              <span className="inline-flex h-7 cursor-not-allowed items-center rounded border border-border bg-muted/30 px-2 text-[11px] text-muted-foreground">
                내려받기
              </span>
            ) : query.files.length === 1 ? (
              <button
                type="button"
                title="내려받기"
                className="inline-flex h-7 cursor-pointer items-center rounded border border-border bg-background px-2 text-[11px] text-muted-foreground hover:bg-muted/50"
                onClick={() => {
                  const f = query.files[0]!
                  triggerServiceFileDownload(
                    serviceFileDataDownloadUrl(
                      SER_ENG,
                      target.layerSegment,
                      target.keyValue,
                      f.name
                    ),
                    f.name
                  )
                }}
              >
                내려받기
              </button>
            ) : (
              <div className="relative" ref={downloadMenuRef}>
                <button
                  type="button"
                  title="내려받기"
                  aria-expanded={downloadMenuOpen}
                  aria-haspopup="menu"
                  className="inline-flex h-7 cursor-pointer items-center gap-0.5 rounded border border-border bg-background px-2 text-[11px] text-muted-foreground hover:bg-muted/50"
                  onClick={() => setDownloadMenuOpen((o) => !o)}
                >
                  내려받기
                  <ChevronDown className="h-3 w-3" aria-hidden />
                </button>
                {downloadMenuOpen ? (
                  <div
                    role="menu"
                    className="absolute bottom-full right-0 z-30 mb-1 min-w-[10.5rem] overflow-visible rounded-md border border-border bg-popover py-1 shadow-lg"
                  >
                    <a
                      role="menuitem"
                      href={serviceFileDataZipDownloadUrl(
                        SER_ENG,
                        target.layerSegment,
                        target.keyValue,
                        { layerDisplayName: target.layerDisplayName }
                      )}
                      download
                      title="묶음 내려받기"
                      className="flex w-full cursor-pointer px-3 py-2 text-left text-[12px] text-foreground transition-colors hover:bg-muted/50"
                      onClick={() => setDownloadMenuOpen(false)}
                    >
                      묶음 내려받기
                    </a>
                    <div className="relative">
                      <button
                        type="button"
                        role="menuitem"
                        title="개별 다운로드"
                        className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-[12px] text-foreground transition-colors hover:bg-muted/50"
                        onClick={() => setIndividualMenuOpen((o) => !o)}
                      >
                        개별 다운로드
                        <ChevronDown
                          className={cn(
                            'h-3 w-3 shrink-0 transition-transform',
                            individualMenuOpen && 'rotate-180'
                          )}
                          aria-hidden
                        />
                      </button>
                      {individualMenuOpen ? (
                        <ul className="max-h-40 overflow-y-auto border-t border-border py-1">
                          {query.files.map((f) => (
                            <li key={f.name}>
                              <button
                                type="button"
                                title={f.name}
                                className="flex w-full cursor-pointer truncate px-3 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                                onClick={() => {
                                  triggerServiceFileDownload(
                                    serviceFileDataDownloadUrl(
                                      SER_ENG,
                                      target.layerSegment,
                                      target.keyValue,
                                      f.name
                                    ),
                                    f.name
                                  )
                                  setDownloadMenuOpen(false)
                                  setIndividualMenuOpen(false)
                                }}
                              >
                                {f.name}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
            {canEdit ? (
              <>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const list = Array.from(e.target.files ?? [])
                    void uploadFiles(list)
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  title={isUploading ? `업로드 ${uploadLabel}` : '파일 추가 (여러 개 선택 가능)'}
                  disabled={isUploading}
                  className={cn(
                    'h-7 cursor-pointer gap-1.5 bg-primary px-2 text-[11px] text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed'
                  )}
                  onClick={() => inputRef.current?.click()}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {uploadLabel}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </div>
      {attachmentImagePreview != null && (
        <ServiceFileImagePreview
          items={attachmentImagePreview.items}
          initialIndex={attachmentImagePreview.initialIndex}
          onClose={() => setAttachmentImagePreview(null)}
        />
      )}
    </>
  )
}
