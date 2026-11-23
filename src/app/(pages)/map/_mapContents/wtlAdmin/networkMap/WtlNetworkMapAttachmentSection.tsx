'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { ChevronDown, Download, File, FileImage, FileSpreadsheet, FileText, Plus, Trash2 } from 'lucide-react'
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
  downloadServiceFilePreviewItemsZip,
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from '../../../_mapComponents/standard/ServiceFileImagePreview'
import {
  buildServiceFilePreviewGalleryItems,
  isServiceFilePreviewableName,
} from '../../../_mapComponents/standard/serviceFilePreviewItems'
import {
  isExcelServiceFileName,
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

/** 첨부 하단 «내려받기»·«선택 삭제» 공통 — enabled/disabled 톤 통일 */
const ATTACH_FOOTER_TOOL_BTN_CLASS =
  'inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] text-muted-foreground enabled:cursor-pointer enabled:hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50'

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
  if (isExcelServiceFileName(name)) {
    return <FileSpreadsheet className="h-5 w-5 text-emerald-500/80" />
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

/** 상세 수정·첨부 공통 — 물리 테이블 + 키 필드/값 */
export function resolveWtlNetworkRowKeyTarget(
  item: WtlNetworkRow,
  fields: readonly DefineFieldLike[]
): { table: string; keyField: string; keyValue: string } | null {
  const parsed = parseRowId(item.id)
  const def = getWtlNetLayerDef(item.layerKey || parsed?.layerKey || '')
  const source = parsed?.sourceId ? getWtlNetMapSource(parsed.sourceId) : undefined
  const baseTable = String(def?.table ?? item.fieldsTable ?? '').trim()
  if (!baseTable) return null
  const table = String(source?.remapTable(baseTable) ?? baseTable).trim()
  if (!table) return null

  const keyFieldDef = fields.find((f) =>
    isDefineFieldFlagTrue((f as { define_field_is_key?: unknown }).define_field_is_key)
  )
  let keyField = String(keyFieldDef?.define_field_name ?? '').trim()
  const record = item.record ?? null
  let keyValue: string | null = null
  if (record && keyField) {
    const fromKey = getRowKey(record, keyField)
    if (fromKey != null && String(fromKey).trim() !== '') keyValue = String(fromKey).trim()
  }
  if (keyValue == null && record) {
    for (const f of ['ogc_fid', 'gid', 'id'] as const) {
      const v = getRowValueByField(record, f)
      if (v != null && String(v).trim() !== '') {
        keyField = f
        keyValue = String(v).trim()
        break
      }
    }
  }
  if (keyValue == null && parsed && Number.isFinite(parsed.ogcFid)) {
    if (!keyField) keyField = 'ogc_fid'
    keyValue = String(parsed.ogcFid)
  }
  if (!keyField || !keyValue) return null

  return { table, keyField, keyValue }
}

/** 데이터조회와 동일 — file_data/{물리테이블}/{키}/ */
export function resolveWtlNetworkAttachmentTarget(
  item: WtlNetworkRow,
  fields: readonly DefineFieldLike[]
): { layerSegment: string; keyValue: string; layerDisplayName: string } | null {
  const target = resolveWtlNetworkRowKeyTarget(item, fields)
  if (!target) return null
  return {
    layerSegment: target.table,
    keyValue: target.keyValue,
    layerDisplayName: target.table,
  }
}

/** 상세 속성 수정 — layerRowService.updateTableRowByKey 용 */
export function resolveWtlNetworkRowEditTarget(
  item: WtlNetworkRow,
  fields: readonly DefineFieldLike[]
): { table: string; schema: string; keyField: string; keyValue: string } | null {
  const target = resolveWtlNetworkRowKeyTarget(item, fields)
  if (!target) return null
  return {
    table: target.table,
    schema: 'layer',
    keyField: target.keyField,
    keyValue: target.keyValue,
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
  const [selectedNames, setSelectedNames] = useState<Set<string>>(() => new Set())
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
    setSelectedNames((prev) => {
      if (prev.size === 0) return prev
      const alive = new Set(query.files.map((f) => f.name))
      let changed = false
      const next = new Set<string>()
      for (const n of prev) {
        if (alive.has(n)) next.add(n)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [query.files])

  useEffect(() => {
    if (!downloadMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (downloadMenuRef.current?.contains(e.target as Node)) return
      setDownloadMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [downloadMenuOpen])

  const toggleSelected = useCallback((name: string) => {
    setSelectedNames((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const downloadSelected = useCallback(() => {
    if (!target) return
    const list = query.files.filter((f) => selectedNames.has(f.name))
    if (list.length === 0) return
    if (list.length === 1) {
      const f = list[0]!
      triggerServiceFileDownload(
        serviceFileDataDownloadUrl(
          SER_ENG,
          target.layerSegment,
          target.keyValue,
          f.name
        ),
        f.name
      )
    } else {
      void downloadServiceFilePreviewItemsZip(
        list.map((f) => ({
          url: serviceFileDataDownloadUrl(
            SER_ENG,
            target.layerSegment,
            target.keyValue,
            f.name
          ),
          fileName: f.name,
        })),
        `${target.layerDisplayName || '첨부'}_선택 첨부파일.zip`
      )
    }
    setDownloadMenuOpen(false)
  }, [target, query.files, selectedNames])

  const deleteSelected = useCallback(async () => {
    if (!target || selectedNames.size === 0) return
    const names = query.files
      .filter((f) => selectedNames.has(f.name))
      .map((f) => f.name)
    if (names.length === 0) return
    if (
      !window.confirm(
        names.length === 1
          ? `「${names[0]}」을(를) 삭제할까요?`
          : `선택한 파일 ${names.length}개를 삭제할까요?`
      )
    ) {
      return
    }
    const failed: string[] = []
    for (const fileName of names) {
      const r = await requestServiceFileDataDelete({
        serEng: SER_ENG,
        layerSegment: target.layerSegment,
        keyValue: target.keyValue,
        fileName,
      })
      if (r.ok) {
        query.removeFile(fileName)
        setSelectedNames((prev) => {
          if (!prev.has(fileName)) return prev
          const next = new Set(prev)
          next.delete(fileName)
          return next
        })
      } else {
        failed.push(fileName)
      }
    }
    if (failed.length > 0) {
      window.alert(
        failed.length === 1
          ? `「${failed[0]}」 삭제에 실패했습니다.`
          : `${failed.length}개 파일 삭제에 실패했습니다.`
      )
    }
  }, [target, query, selectedNames])

  const previewGalleryItems = useMemo((): ServiceFilePreviewItem[] => {
    if (!target) return []
    return buildServiceFilePreviewGalleryItems(query.files, (fileName) =>
      serviceFileDataDownloadUrl(SER_ENG, target.layerSegment, target.keyValue, fileName)
    )
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
        <p className="text-center text-xs text-muted-foreground/80">
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
            <p className="rounded border border-primary/40 bg-background/90 px-3 py-1.5 text-xs font-medium text-primary">
              여기에 파일을 놓으세요
            </p>
          </div>
        ) : null}
        <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
          {query.loading ? (
            <div
              className="flex flex-col gap-1 p-1"
              aria-busy
              aria-label="첨부파일 불러오는 중"
              title="첨부파일 불러오는 중"
            >
              {Array.from({ length: 4 }, (_, i) => (
                <div
                  key={`sk-file-${i}`}
                  className="flex items-center gap-2 rounded-lg border border-border/80 bg-card p-1"
                  aria-hidden
                >
                  <div className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-muted" />
                  <div className="min-w-0 flex-1 space-y-1.5 py-0.5">
                    <div
                      className="h-3 animate-pulse rounded bg-muted"
                      style={{ width: `${58 + ((i * 13) % 28)}%` }}
                    />
                    <div className="h-2.5 w-[40%] animate-pulse rounded bg-muted/80" />
                  </div>
                </div>
              ))}
            </div>
          ) : query.error ? (
            <div className="flex flex-1 items-center justify-center px-3 text-center text-xs text-red-600">
              {query.error}
            </div>
          ) : query.files.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 px-3 text-center">
              <p className="text-xs text-muted-foreground/80">첨부파일이 없습니다.</p>
              {canEdit ? (
                <p className="text-[11px] text-muted-foreground/70">
                  파일을 끌어다 놓거나 «파일 추가»로 등록하세요.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-1 p-1">
              {query.files.map((f) => {
                const url = serviceFileDataDownloadUrl(
                  SER_ENG,
                  target.layerSegment,
                  target.keyValue,
                  f.name
                )
                const canPreview = isServiceFilePreviewableName(f.name)
                const modified =
                  f.modified != null && String(f.modified).trim()
                    ? String(f.modified).slice(0, 19).replace('T', ' ')
                    : '-'
                const activateRow = () => {
                  if (canPreview) {
                    const idx = previewGalleryItems.findIndex((i) => i.fileName === f.name)
                    setAttachmentImagePreview({
                      items: previewGalleryItems,
                      initialIndex: idx >= 0 ? idx : 0,
                    })
                  } else {
                    triggerServiceFileDownload(url, f.name)
                  }
                }
                const checked = selectedNames.has(f.name)
                return (
                  <div
                    key={f.name}
                    tabIndex={0}
                    role="group"
                    aria-label={
                      canPreview ? `${f.name} 크게 보기` : `${f.name} 다운로드`
                    }
                    className="group flex cursor-pointer items-center gap-2 rounded-lg border border-border/80 bg-card p-1 transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    onClick={activateRow}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        activateRow()
                      }
                    }}
                  >
                    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                      <span
                        className={cn(
                          'transition-opacity',
                          checked ? 'hidden' : 'group-hover:opacity-0'
                        )}
                        aria-hidden={checked}
                      >
                        {getFileIcon(f.name)}
                      </span>
                      <input
                        type="checkbox"
                        title="선택"
                        aria-label={`${f.name} 선택`}
                        checked={checked}
                        className={cn(
                          'absolute inset-0 m-auto h-4 w-4 cursor-pointer accent-primary',
                          checked
                            ? 'opacity-100'
                            : 'opacity-0 group-hover:opacity-100'
                        )}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation()
                          toggleSelected(f.name)
                        }}
                      />
                    </div>
                    <div
                      className={cn(
                        'min-w-0 flex-1 transition-[padding]',
                        'group-hover:pl-1'
                      )}
                    >
                      <p className="truncate text-xs font-normal text-foreground/90">{f.name}</p>
                      <p className="text-xs text-muted-foreground/90">
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
                            if (r.ok) {
                              query.removeFile(f.name)
                              setSelectedNames((prev) => {
                                if (!prev.has(f.name)) return prev
                                const next = new Set(prev)
                                next.delete(f.name)
                                return next
                              })
                            } else alert(r.error)
                          })
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">삭제</span>
                      </Button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border px-3 py-2.5">
          <span className="text-xs text-muted-foreground">
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
            <div className="relative" ref={downloadMenuRef}>
              <button
                type="button"
                title="내려받기"
                aria-expanded={downloadMenuOpen}
                aria-haspopup="menu"
                disabled={query.files.length === 0}
                className={ATTACH_FOOTER_TOOL_BTN_CLASS}
                onClick={() => {
                  if (query.files.length === 0) return
                  setDownloadMenuOpen((o) => !o)
                }}
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                내려받기
                <ChevronDown className="h-3 w-3" aria-hidden />
              </button>
              {query.files.length > 0 && downloadMenuOpen ? (
                <div
                  role="menu"
                  className="absolute bottom-full right-0 z-30 mb-1 min-w-[10.5rem] overflow-visible rounded-md border border-border bg-popover py-1 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    title="전체 내려받기"
                    className="flex w-full cursor-pointer px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-muted/50"
                    onClick={() => {
                      setDownloadMenuOpen(false)
                      const zipUrl = serviceFileDataZipDownloadUrl(
                        SER_ENG,
                        target.layerSegment,
                        target.keyValue,
                        { layerDisplayName: target.layerDisplayName }
                      )
                      triggerServiceFileDownload(
                        zipUrl,
                        `${target.layerDisplayName || '첨부'}_첨부파일.zip`
                      )
                    }}
                  >
                    전체 내려받기
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    title="선택 내려받기"
                    disabled={selectedNames.size === 0}
                    className="flex w-full cursor-pointer px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => downloadSelected()}
                  >
                    선택 내려받기
                    {selectedNames.size > 0 ? ` (${selectedNames.size})` : ''}
                  </button>
                </div>
              ) : null}
            </div>
            {canEdit ? (
              <>
                <button
                  type="button"
                  title={
                    selectedNames.size === 0
                      ? '선택 삭제'
                      : `선택 삭제 (${selectedNames.size})`
                  }
                  disabled={selectedNames.size === 0 || isUploading}
                  className={ATTACH_FOOTER_TOOL_BTN_CLASS}
                  onClick={() => void deleteSelected()}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  선택 삭제
                  {selectedNames.size > 0 ? ` (${selectedNames.size})` : ''}
                </button>
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
                <button
                  type="button"
                  title={isUploading ? `업로드 ${uploadLabel}` : '파일 추가'}
                  disabled={isUploading}
                  className="inline-flex h-7 cursor-pointer items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => inputRef.current?.click()}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  {uploadLabel}
                </button>
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
