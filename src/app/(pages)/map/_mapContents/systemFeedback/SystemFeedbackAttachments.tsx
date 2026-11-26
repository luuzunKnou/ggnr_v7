'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Download, FileText, Plus, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SER_FILE_ENG } from '@/lib/serviceFileDataSerEng';
import {
  isImageServiceFileName,
  isPdfServiceFileName,
  requestServiceFileDataDelete,
  serviceFileDataDownloadUrl,
  triggerServiceFileDownload,
  useServiceFileChunkedUpload,
  useServiceFileData,
} from '@/app/(pages)/map/_mapComponents/standard/useServiceFileData';
import { ServiceFileAttachmentThumb } from '@/app/(pages)/map/_mapComponents/standard/ServiceFileAttachmentThumb';
import { ServiceFilePdfThumb } from '@/app/(pages)/map/_mapComponents/standard/ServiceFilePdfThumb';
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from '@/app/(pages)/map/_mapComponents/standard/ServiceFileImagePreview';
import {
  buildServiceFilePreviewGalleryItems,
  isServiceFilePreviewableName,
} from '@/app/(pages)/map/_mapComponents/standard/serviceFilePreviewItems';

const LAYER = 'system_feedback';
/** 첨부 행 ~3개 분량 */
const LIST_MAX_H = 'max-h-[12.5rem]';

function formatFileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  sfKey: number | null;
  canEdit: boolean;
  onLocalFiles?: (files: File[]) => void;
  className?: string;
};

export function SystemFeedbackAttachments({
  sfKey,
  canEdit,
  onLocalFiles,
  className,
}: Props) {
  const enabled = sfKey != null && sfKey > 0;
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<{
    items: ServiceFilePreviewItem[];
    initialIndex: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chunkUpload = useServiceFileChunkedUpload();
  const query = useServiceFileData({
    serEng: SER_FILE_ENG.systemFeedback,
    enabled,
    layerSegment: LAYER,
    keyValue: sfKey,
    refreshNonce,
  });

  const previewGalleryItems = useMemo((): ServiceFilePreviewItem[] => {
    if (!enabled || sfKey == null) return [];
    return buildServiceFilePreviewGalleryItems(query.files, (fileName) =>
      serviceFileDataDownloadUrl(SER_FILE_ENG.systemFeedback, LAYER, sfKey, fileName)
    );
  }, [enabled, sfKey, query.files]);

  const uploadFiles = useCallback(
    async (fileList: FileList | File[] | null) => {
      if (!fileList || sfKey == null || !canEdit) return;
      const files = Array.from(fileList);
      if (!files.length) return;
      onLocalFiles?.(files);
      for (const file of files) {
        const result = await chunkUpload.upload({
          file,
          serEng: SER_FILE_ENG.systemFeedback,
          layerSegment: LAYER,
          keyValue: sfKey,
        });
        if (result && 'error' in result && result.error) break;
      }
      setRefreshNonce((n) => n + 1);
      chunkUpload.reset();
      if (inputRef.current) inputRef.current.value = '';
    },
    [sfKey, canEdit, onLocalFiles, chunkUpload]
  );

  const onDragEnter = (e: React.DragEvent) => {
    if (!canEdit || !enabled) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!canEdit || !enabled) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (!canEdit || !enabled) return;
    void uploadFiles(e.dataTransfer.files);
  };

  const fileCount = enabled ? query.files.length : 0;

  const openFilePicker = () => {
    if (!canEdit || !enabled || chunkUpload.state.status === 'uploading') return;
    chunkUpload.reset();
    inputRef.current?.click();
  };

  return (
    <>
      <div className={cn('flex shrink-0 flex-col gap-1', className)}>
        <span className="shrink-0 text-xs font-medium text-muted-foreground">
          첨부파일{' '}
          <span className="tabular-nums">{fileCount}건</span>
        </span>

        <div className="flex min-h-0 flex-col overflow-hidden rounded border border-border bg-white dark:bg-background">
          {canEdit ? (
            <>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                accept="image/*,video/*,.pdf,.zip,.doc,.docx,.xls,.xlsx,.hwp,.hwpx"
                onChange={(e) => {
                  // value 초기화 전에 File 복사 — FileList는 live라 clear 후 비어짐
                  const files = e.target.files ? Array.from(e.target.files) : [];
                  e.target.value = '';
                  if (files.length) void uploadFiles(files);
                }}
              />
              <div className="flex shrink-0 items-center gap-1 border-b border-border bg-slate-100 px-1.5 py-1 dark:bg-white/10">
                <button
                  type="button"
                  title="파일 추가"
                  disabled={!enabled || chunkUpload.state.status === 'uploading'}
                  className="inline-flex h-7 cursor-pointer items-center gap-0.5 rounded px-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-50"
                  onClick={openFilePicker}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  파일 추가
                </button>
                {chunkUpload.state.status === 'uploading' ? (
                  <span className="ml-1 text-xs text-muted-foreground">
                    업로드 {chunkUpload.state.progress}%
                  </span>
                ) : null}
              </div>
            </>
          ) : null}

          <div
            role={canEdit && enabled ? 'button' : undefined}
            tabIndex={canEdit && enabled ? 0 : undefined}
            title={canEdit && enabled ? '파일 추가' : undefined}
            className={cn(
              'min-h-0 px-2.5 py-2 transition-colors',
              canEdit && enabled && 'cursor-pointer',
              dragOver && canEdit && enabled && 'bg-primary/5 ring-2 ring-inset ring-primary/30'
            )}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={(e) => {
              if (!canEdit || !enabled) return;
              if ((e.target as HTMLElement).closest('button, [role="group"]')) return;
              openFilePicker();
            }}
            onKeyDown={(e) => {
              if (!canEdit || !enabled) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openFilePicker();
              }
            }}
          >
            {!enabled ? (
              <div className="flex min-h-[5.5rem] items-center justify-center text-center text-xs text-muted-foreground">
                초안 준비 후 첨부파일을 등록할 수 있습니다.
              </div>
            ) : chunkUpload.state.status === 'error' && chunkUpload.state.error ? (
              <div className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                {chunkUpload.state.error}
              </div>
            ) : null}

            {enabled && chunkUpload.state.status === 'uploading' ? (
              <div className="mb-2 rounded border border-border bg-muted/30 px-3 py-2">
                <div className="mb-1 flex justify-between text-xs text-muted-foreground">
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

            {enabled ? (
              query.loading ? (
                <div className="py-4 text-center text-xs text-muted-foreground">불러오는 중…</div>
              ) : query.error ? (
                <div className="py-4 text-center text-xs text-red-600">{query.error}</div>
              ) : query.files.length === 0 ? (
                <div className="flex min-h-[5.5rem] items-center justify-center text-center text-xs text-muted-foreground">
                  {canEdit
                    ? dragOver
                      ? '여기에 놓아 업로드'
                      : '첨부파일 없음 — 파일을 끌어오거나 «파일 추가»'
                    : '첨부파일 없음'}
                </div>
              ) : (
                <div
                  className={`${LIST_MAX_H} space-y-1.5 overflow-y-auto overscroll-contain scrollbar-thin`}
                >
                  {query.files.map((file) => {
                    const canPreview = isServiceFilePreviewableName(file.name);
                    const isImg = isImageServiceFileName(file.name);
                    const isPdf = isPdfServiceFileName(file.name);
                    const dateStr =
                      file.modified != null
                        ? (() => {
                            const d = new Date(file.modified);
                            return Number.isNaN(d.getTime())
                              ? '—'
                              : d.toLocaleDateString('ko-KR');
                          })()
                        : '—';
                    const downloadUrl = serviceFileDataDownloadUrl(
                      SER_FILE_ENG.systemFeedback,
                      LAYER,
                      sfKey,
                      file.name
                    );
                    const activateRow = () => {
                      if (canPreview) {
                        const idx = previewGalleryItems.findIndex(
                          (i) => i.fileName === file.name
                        );
                        setPreview({
                          items: previewGalleryItems,
                          initialIndex: idx >= 0 ? idx : 0,
                        });
                      } else {
                        triggerServiceFileDownload(downloadUrl, file.name);
                      }
                    };
                    return (
                      <div
                        key={file.name}
                        tabIndex={0}
                        role="group"
                        aria-label={
                          canPreview
                            ? `${file.name} 크게 보기`
                            : `${file.name} 다운로드`
                        }
                        className="flex cursor-pointer items-center gap-2 rounded border border-border bg-background px-2 py-1.5 transition-colors hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        onClick={activateRow}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            activateRow();
                          }
                        }}
                      >
                        {isImg ? (
                          <ServiceFileAttachmentThumb
                            serEng={SER_FILE_ENG.systemFeedback}
                            layerSegment={LAYER}
                            keyValue={sfKey}
                            fileName={file.name}
                            size="md"
                          />
                        ) : isPdf ? (
                          <ServiceFilePdfThumb
                            serEng={SER_FILE_ENG.systemFeedback}
                            layerSegment={LAYER}
                            keyValue={sfKey}
                            fileName={file.name}
                            size="md"
                          />
                        ) : (
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-amber-100 dark:bg-amber-950/50">
                            <FileText className="h-4 w-4 text-amber-600" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-foreground">
                            {file.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(file.size)} | {dateStr}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            title="다운로드"
                            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              triggerServiceFileDownload(downloadUrl, file.name);
                            }}
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span className="sr-only">다운로드</span>
                          </button>
                          {canEdit ? (
                            <button
                              type="button"
                              title="삭제"
                              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-950/40"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (
                                  !window.confirm(
                                    `「${file.name}」을(를) 삭제할까요?\n삭제 후 목록에는 표시되지 않으며, 서버에는 .tmp 확장자가 붙은 이름으로 남습니다.`
                                  )
                                ) {
                                  return;
                                }
                                void requestServiceFileDataDelete({
                                  serEng: SER_FILE_ENG.systemFeedback,
                                  layerSegment: LAYER,
                                  keyValue: sfKey,
                                  fileName: file.name,
                                }).then((r) => {
                                  if (r.ok) setRefreshNonce((n) => n + 1);
                                  else window.alert(r.error);
                                });
                              }}
                            >
                              <X className="h-3.5 w-3.5" />
                              <span className="sr-only">삭제</span>
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            ) : null}
          </div>
        </div>
      </div>

      {preview != null ? (
        <ServiceFileImagePreview
          items={preview.items}
          initialIndex={preview.initialIndex}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </>
  );
}
