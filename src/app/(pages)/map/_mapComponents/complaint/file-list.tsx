'use client';

import { useMemo, useRef, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
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
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from '@/app/(pages)/map/_mapComponents/standard/ServiceFileImagePreview';
import { Download, File, FileImage, FileText, Plus, Trash2 } from 'lucide-react';

const SER_ENG = SER_FILE_ENG.complaint;
const LAYER = 'comp';

function formatFileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(name: string) {
  if (isImageServiceFileName(name)) {
    return <FileImage className="h-5 w-5 text-sky-500/80" />;
  }
  if (isPdfServiceFileName(name)) {
    return <FileText className="h-5 w-5 text-red-500/80" />;
  }
  return <File className="h-5 w-5 text-muted-foreground/80" />;
}

interface FileListProps {
  /** 민원 접수번호 — 없으면 첨부 불가 */
  compKey: number | null | undefined;
  canEdit?: boolean;
}

export function FileList({ compKey, canEdit = true }: FileListProps) {
  const enabled =
    compKey != null && typeof compKey === 'number' && Number.isFinite(compKey) && compKey > 0;
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [attachmentImagePreview, setAttachmentImagePreview] = useState<{
    items: ServiceFilePreviewItem[];
    initialIndex: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chunkUpload = useServiceFileChunkedUpload();
  const query = useServiceFileData({
    serEng: SER_ENG,
    enabled,
    layerSegment: LAYER,
    keyValue: enabled ? compKey : null,
    refreshNonce,
  });

  const previewGalleryItems = useMemo((): ServiceFilePreviewItem[] => {
    if (!enabled) return [];
    return query.files
      .filter((f) => isImageServiceFileName(f.name) || isPdfServiceFileName(f.name))
      .map((f) => ({
        url: serviceFileDataDownloadUrl(SER_ENG, LAYER, compKey, f.name),
        fileName: f.name,
        kind: isPdfServiceFileName(f.name) ? ('pdf' as const) : ('image' as const),
      }));
  }, [compKey, enabled, query.files]);

  const onPickFile = async (file: File | undefined) => {
    if (!file || !enabled) return;
    const result = await chunkUpload.upload({
      file,
      serEng: SER_ENG,
      layerSegment: LAYER,
      keyValue: compKey,
    });
    if (!result?.error) {
      setRefreshNonce((n) => n + 1);
      chunkUpload.reset();
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  if (!enabled) {
    return (
      <div className="flex flex-col h-full min-h-0 items-center justify-center p-6">
        <p className="text-[12px] text-muted-foreground/80 text-center">
          민원 저장 후 첨부파일을 등록할 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col h-full min-h-0">
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
          <div className="flex flex-col gap-2 p-1">
            {query.loading ? (
              <div className="py-8 text-center text-[12px] text-muted-foreground/80">불러오는 중…</div>
            ) : query.error ? (
              <div className="py-8 text-center text-[12px] text-red-600">{query.error}</div>
            ) : query.files.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-muted-foreground/80">
                첨부파일이 없습니다.
              </div>
            ) : (
              query.files.map((f) => {
                const url = serviceFileDataDownloadUrl(SER_ENG, LAYER, compKey, f.name);
                const isImg = isImageServiceFileName(f.name);
                const isPdf = isPdfServiceFileName(f.name);
                const modified =
                  f.modified != null && String(f.modified).trim()
                    ? String(f.modified).slice(0, 19).replace('T', ' ')
                    : '-';
                const activateRow = () => {
                  if (isImg || isPdf) {
                    const idx = previewGalleryItems.findIndex((i) => i.fileName === f.name);
                    setAttachmentImagePreview({
                      items: previewGalleryItems,
                      initialIndex: idx >= 0 ? idx : 0,
                    });
                  } else {
                    triggerServiceFileDownload(url, f.name);
                  }
                };
                return (
                  <div
                    key={f.name}
                    tabIndex={0}
                    role="group"
                    aria-label={
                      isImg || isPdf ? `${f.name} 크게 보기` : `${f.name} 다운로드`
                    }
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/80 bg-card p-3 hover:bg-muted/30 transition-colors group focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    onClick={activateRow}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        activateRow();
                      }
                    }}
                  >
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-muted/50">
                      {getFileIcon(f.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-normal text-foreground/90 truncate">{f.name}</p>
                      <p className="text-[12px] text-muted-foreground/90">
                        {formatFileSize(f.size)} | {modified}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="다운로드"
                      className="h-8 w-8 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerServiceFileDownload(url, f.name);
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
                        className="h-8 w-8 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!window.confirm(`「${f.name}」을(를) 삭제할까요?`)) return;
                          void requestServiceFileDataDelete({
                            serEng: SER_ENG,
                            layerSegment: LAYER,
                            keyValue: compKey,
                            fileName: f.name,
                          }).then((r) => {
                            if (r.ok) setRefreshNonce((n) => n + 1);
                            else alert(r.error);
                          });
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">삭제</span>
                      </Button>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-3 mt-auto gap-2">
          <span className="text-[12px] text-muted-foreground">
            첨부파일{' '}
            <span className="font-semibold text-foreground">{query.files.length}</span>건
          </span>
          <div className="flex items-center gap-2">
            {chunkUpload.state.status === 'error' && chunkUpload.state.error ? (
              <span className="text-[11px] text-red-600 max-w-[8rem] truncate" title={chunkUpload.state.error}>
                {chunkUpload.state.error}
              </span>
            ) : null}
            {canEdit ? (
              <>
                <input
                  ref={inputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => void onPickFile(e.target.files?.[0])}
                />
                <Button
                  type="button"
                  size="sm"
                  title={
                    chunkUpload.state.status === 'uploading'
                      ? `업로드 ${chunkUpload.state.progress}%`
                      : '파일 추가'
                  }
                  disabled={chunkUpload.state.status === 'uploading'}
                  className="cursor-pointer gap-1.5 text-[12px] bg-primary text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed"
                  onClick={() => inputRef.current?.click()}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {chunkUpload.state.status === 'uploading'
                    ? `${chunkUpload.state.progress}%`
                    : '파일 추가'}
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
  );
}
