'use client';

import { useRef, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { SER_FILE_ENG } from '@/lib/serviceFileDataSerEng';
import {
  requestServiceFileDataDelete,
  serviceFileDataDownloadUrl,
  serviceFileDataZipDownloadUrl,
  triggerServiceFileDownload,
  useServiceFileChunkedUpload,
  useServiceFileData,
} from '@/app/(pages)/map/_mapComponents/standard/useServiceFileData';
import { Download, FileText, Paperclip, Trash2, Upload } from 'lucide-react';

type BoardKind = 'notice' | 'library';

function formatFileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fileConfig(kind: BoardKind) {
  return kind === 'notice'
    ? { serEng: SER_FILE_ENG.notice, layer: 'notice', label: '공지' }
    : { serEng: SER_FILE_ENG.board, layer: 'board', label: '자료' };
}

export function BoardAttachmentsPanel(props: {
  kind: BoardKind;
  postKey: string | number | null;
  canEdit: boolean;
}) {
  const { kind, postKey, canEdit } = props;
  const { serEng, layer, label } = fileConfig(kind);
  const enabled =
    postKey != null &&
    postKey !== '' &&
    (typeof postKey === 'number' ? postKey > 0 : String(postKey).trim().length > 0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const chunkUpload = useServiceFileChunkedUpload();
  const query = useServiceFileData({
    serEng,
    enabled,
    layerSegment: layer,
    keyValue: postKey,
    refreshNonce,
  });

  if (!enabled) {
    return (
      <p className="text-xs text-muted-foreground border-t border-border pt-4 mt-4">
        게시글 저장 후 첨부파일을 등록할 수 있습니다.
      </p>
    );
  }

  const onPickFile = async (file: File | undefined) => {
    if (!file || postKey == null) return;
    const result = await chunkUpload.upload({
      file,
      serEng,
      layerSegment: layer,
      keyValue: postKey,
    });
    if (!result?.error) {
      setRefreshNonce((n) => n + 1);
      chunkUpload.reset();
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="border-t border-border pt-4 mt-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Paperclip className="h-4 w-4" />
          첨부파일
        </span>
        <div className="flex items-center gap-2">
          {query.files.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                triggerServiceFileDownload(
                  serviceFileDataZipDownloadUrl(serEng, layer, postKey, { layerDisplayName: label }),
                  `${label}_첨부.zip`
                )
              }
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              전체 ZIP
            </Button>
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
                variant="outline"
                disabled={chunkUpload.state.status === 'uploading'}
                onClick={() => inputRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5 mr-1" />
                {chunkUpload.state.status === 'uploading'
                  ? `${chunkUpload.state.progress}%`
                  : '업로드'}
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {chunkUpload.state.status === 'error' && chunkUpload.state.error ? (
        <p className="text-xs text-red-600">{chunkUpload.state.error}</p>
      ) : null}
      {query.loading ? (
        <p className="text-xs text-muted-foreground">불러오는 중…</p>
      ) : query.error ? (
        <p className="text-xs text-red-600">{query.error}</p>
      ) : query.files.length === 0 ? (
        <p className="text-xs text-muted-foreground">첨부파일 없음</p>
      ) : (
        <ul className="space-y-2">
          {query.files.map((f) => {
            const url = serviceFileDataDownloadUrl(serEng, layer, postKey, f.name);
            return (
              <li
                key={f.name}
                className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/20 px-3 py-2"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{f.name}</p>
                  <p className="text-[11px] text-muted-foreground">{formatFileSize(f.size)}</p>
                </div>
                <button
                  type="button"
                  className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
                  title="다운로드"
                  onClick={() => triggerServiceFileDownload(url, f.name)}
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
                {canEdit ? (
                  <button
                    type="button"
                    className="shrink-0 p-1 text-muted-foreground hover:text-destructive"
                    title="삭제"
                    onClick={() => {
                      if (!window.confirm(`「${f.name}」을(를) 삭제할까요?`)) return;
                      void requestServiceFileDataDelete({
                        serEng,
                        layerSegment: layer,
                        keyValue: postKey,
                        fileName: f.name,
                      }).then((r) => {
                        if (r.ok) setRefreshNonce((n) => n + 1);
                        else alert(r.error);
                      });
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
