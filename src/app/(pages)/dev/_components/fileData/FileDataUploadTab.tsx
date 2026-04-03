'use client';

import { useState, useEffect, useCallback, useRef, type InputHTMLAttributes } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Folder, File as FileIcon, ChevronUp, RefreshCw, Loader2, ArrowRight, Trash2 } from 'lucide-react';
import { useChunkedUpload } from '../useChunkedUpload';

type DirEntry = { name: string; isDirectory: boolean; size: number; mtime: string };
type DirListResult = {
  directories: string[];
  files: { name: string; size: number; modified?: string }[];
};

type UploadRow = { file: string; status: 'pending' | 'ok' | 'fail'; error?: string };

type Props = {
  relativePath: string;
  onPathChange: (p: string) => void;
  onGoHistory?: () => void;
};

/** 폴더 업로드 시 브라우저가 붙이는 최상위(선택한 폴더명) 한 단계를 제거 → 테이블/키/파일부터 저장 */
function fileDataSavePathFromWebkit(webkitRelativePath: string): string {
  const norm = webkitRelativePath.replace(/\\/g, '/');
  const parts = norm.split('/').filter(Boolean);
  if (parts.length <= 1) return norm;
  return parts.slice(1).join('/');
}

export function FileDataUploadTab({ relativePath, onPathChange, onGoHistory }: Props) {
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const abortRef = useRef(false);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<UploadRow[]>([]);
  const [sessionDone, setSessionDone] = useState(false);
  const [logNote, setLogNote] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  const { upload, cancel, reset } = useChunkedUpload();

  const fetchList = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await call('', 'POST', {
        service: 'fileManagerService',
        action: 'listDirectory',
        params: { relativePath },
      });
      const data: DirListResult = res?.data ?? res;
      const merged: DirEntry[] = [
        ...(data?.directories ?? []).map((name: string) => ({ name, isDirectory: true, size: 0, mtime: '' })),
        ...(data?.files ?? []).map((f: { name: string; size: number; modified?: string }) => ({
          name: f.name,
          isDirectory: false,
          size: f.size,
          mtime: f.modified ?? '',
        })),
      ];
      setEntries(merged);
    } catch (e: unknown) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [relativePath]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const goUp = useCallback(() => {
    const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length <= 2) return;
    parts.pop();
    onPathChange(parts.join('/'));
  }, [relativePath, onPathChange]);

  const goInto = useCallback(
    (name: string) => onPathChange(relativePath.replace(/\\/g, '/').replace(/\/$/, '') + '/' + name),
    [relativePath, onPathChange]
  );

  const deleteEntry = useCallback(
    async (name: string, isDirectory: boolean) => {
      const base = relativePath.replace(/\\/g, '/').replace(/\/$/, '');
      const targetRel = `${base}/${name}`.replace(/\\/g, '/');
      const kind = isDirectory ? '폴더(하위 포함)' : '파일';
      if (!confirm(`"${name}" ${kind}을(를) 삭제할까요?`)) return;
      setDeletingName(name);
      try {
        const res = await call('', 'POST', {
          service: 'fileManagerService',
          action: 'deleteFileDataPath',
          params: { relativePath: targetRel },
        });
        const d = res?.data ?? res;
        if (d?.ok === false) {
          alert(typeof d?.error === 'string' ? d.error : '삭제 실패');
          return;
        }
        await fetchList();
      } catch (e: unknown) {
        alert(e instanceof Error ? e.message : String(e));
      } finally {
        setDeletingName(null);
      }
    },
    [relativePath, fetchList]
  );

  const runFolderUpload = useCallback(
    async (fileList: File[]) => {
      if (fileList.length === 0) return;

      const withRel = fileList.filter((f) => {
        const w = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
        return typeof w === 'string' && w.includes('/');
      });
      if (withRel.length === 0) {
        alert('폴더 구조를 유지하려면 "폴더 업로드"로 선택하세요.\n경로: 테이블폴더/키값폴더/파일');
        return;
      }

      setRows([]);
      setSessionDone(false);
      setLogNote(null);
      setUploading(true);
      abortRef.current = false;
      setProgress({ current: 0, total: withRel.length });

      const savedPaths: string[] = [];
      const nextRows: UploadRow[] = [];

      for (let i = 0; i < withRel.length; i++) {
        if (abortRef.current) break;
        setProgress({ current: i + 1, total: withRel.length });
        const file = withRel[i];
        const webkit = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name;
        const savePath = fileDataSavePathFromWebkit(webkit);

        try {
          const result = await upload(file, 'fileData', { fileDataSavePath: savePath });
          if (result && 'error' in result && result.error) {
            nextRows.push({ file: savePath, status: 'fail', error: result.error });
          } else {
            const sp = result && typeof result === 'object' && 'savedPath' in result ? String(result.savedPath ?? '') : '';
            if (sp) savedPaths.push(sp.replace(/\\/g, '/'));
            nextRows.push({ file: savePath, status: 'ok' });
          }
        } catch (e: unknown) {
          nextRows.push({ file: savePath, status: 'fail', error: e instanceof Error ? e.message : String(e) });
        }
      }

      setRows(nextRows);
      setUploading(false);
      setProgress({ current: 0, total: 0 });
      reset();
      fetchList();

      if (savedPaths.length > 0) {
        try {
          const rec = await call('', 'POST', {
            service: 'fileDataUploadService',
            action: 'recordFileDataUploadSession',
            params: { savedPaths, logRelativeDir: 'service_data/file_data' },
          });
          const d = rec?.data ?? rec;
          const logPath = d?.logPath as string | undefined;
          setLogNote(logPath ? `검증 로그: ${logPath}` : '검증 로그가 기록되었습니다.');
        } catch {
          setLogNote('이력 기록 중 오류 (파일은 저장됨)');
        }
      }
      setSessionDone(true);
    },
    [upload, reset, fetchList]
  );

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    void runFolderUpload(files);
  }, [runFolderUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleFolderSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      void runFolderUpload(files);
      e.target.value = '';
    },
    [runFolderUpload]
  );

  const pathParts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const canGoUp = pathParts.length > 2;
  const busy = uploading;
  const showExplorer = !busy && rows.length === 0;

  return (
    <div className="flex flex-col h-full min-h-0 p-2 gap-2">
      <div className="shrink-0 flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={!canGoUp || busy} onClick={goUp} className="gap-1">
          <ChevronUp className="w-3.5 h-3.5" /> 상위로
        </Button>
        <span className="text-xs text-muted-foreground truncate flex-1">{relativePath}</span>
        <Button variant="outline" size="sm" onClick={fetchList} className="gap-1" disabled={busy}>
          <RefreshCw className="w-3.5 h-3.5" /> 새로고침
        </Button>
        <Button variant="default" size="sm" onClick={() => folderInputRef.current?.click()} disabled={busy}>
          폴더 업로드
        </Button>
        <input
          ref={folderInputRef}
          type="file"
          className="hidden"
          {...({ webkitdirectory: '', directory: '' } as InputHTMLAttributes<HTMLInputElement>)}
          onChange={handleFolderSelect}
        />
      </div>

      <p className="text-[11px] text-muted-foreground shrink-0">
        저장 위치: GGNR_DATA_DIR 기준 <code className="text-foreground">service_data/file_data/테이블명/키값/</code> — 폴더 업로드 시 선택한
        폴더 이름 한 단계는 제외하고, 그 아래(테이블/키/파일) 구조만 저장됩니다.
      </p>

      {showExplorer && (
        <section className="flex-1 min-h-0 overflow-auto border rounded" onDrop={handleDrop} onDragOver={handleDragOver}>
          {loading ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">로딩 중…</div>
          ) : listError ? (
            <div className="flex items-center justify-center h-full text-xs text-red-500">{listError}</div>
          ) : entries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground px-4 text-center">
              비어 있음. 테이블명/키값 하위 폴더 구조로 &quot;폴더 업로드&quot; 하거나 폴더를 끌어 넣으세요.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted z-10">
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 px-2 w-6" />
                  <th className="py-1 px-2">이름</th>
                  <th className="py-1 px-2 w-20 text-right">크기</th>
                  <th className="py-1 px-2 w-44">수정일</th>
                  <th className="py-1 px-2 w-14 text-center">삭제</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr
                    key={e.name}
                    className={cn('border-t hover:bg-muted/40', e.isDirectory && 'cursor-pointer')}
                    onClick={e.isDirectory ? () => goInto(e.name) : undefined}
                  >
                    <td className="py-1 px-2">
                      {e.isDirectory ? (
                        <Folder className="w-4 h-4 text-yellow-500" />
                      ) : (
                        <FileIcon className="w-4 h-4 text-muted-foreground" />
                      )}
                    </td>
                    <td className="py-1 px-2 truncate max-w-[16rem]" title={e.name}>
                      {e.name}
                    </td>
                    <td className="py-1 px-2 text-right whitespace-nowrap">{e.isDirectory ? '—' : formatSize(e.size)}</td>
                    <td className="py-1 px-2 whitespace-nowrap">{e.mtime ? new Date(e.mtime).toLocaleString('ko-KR') : ''}</td>
                    <td className="py-1 px-2 text-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        disabled={busy || deletingName === e.name}
                        title={e.isDirectory ? '폴더 전체 삭제' : '파일 삭제'}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          void deleteEntry(e.name, e.isDirectory);
                        }}
                      >
                        {deletingName === e.name ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {uploading && (
        <div className="shrink-0 px-3 py-2 border rounded bg-muted/20">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              업로드: {progress.current}/{progress.total}
            </span>
            <Button variant="ghost" size="sm" className="h-5 text-xs" onClick={() => { abortRef.current = true; cancel(); }}>
              취소
            </Button>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}%` }}
            />
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <section className="flex-1 min-h-0 overflow-auto border rounded">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted z-10">
              <tr className="text-left text-muted-foreground">
                <th className="py-1 px-2">경로</th>
                <th className="py-1 px-2 w-16 text-center">상태</th>
                <th className="py-1 px-2">비고</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={cn('border-t', r.status === 'fail' && 'bg-red-50 dark:bg-red-950/20')}>
                  <td className="py-1 px-2 truncate max-w-[20rem]" title={r.file}>
                    {r.file}
                  </td>
                  <td className="py-1 px-2 text-center">{r.status === 'ok' ? '완료' : r.status === 'fail' ? '실패' : '—'}</td>
                  <td className="py-1 px-2 text-red-600 dark:text-red-400 truncate">{r.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {sessionDone && rows.length > 0 && (
        <div className="shrink-0 px-3 py-2 border rounded bg-muted/20 flex flex-col gap-1">
          {logNote && <span className="text-xs text-muted-foreground">{logNote}</span>}
          <div className="flex items-center justify-between">
            <span className="text-xs">
              성공 {rows.filter((r) => r.status === 'ok').length} / 실패 {rows.filter((r) => r.status === 'fail').length}
            </span>
            <div className="flex items-center gap-2">
              {onGoHistory && (
                <button
                  type="button"
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5"
                  onClick={() => onGoHistory()}
                >
                  이력 조회 <ArrowRight className="w-3 h-3" />
                </button>
              )}
              <button
                type="button"
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => {
                  setRows([]);
                  setSessionDone(false);
                  setLogNote(null);
                }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
