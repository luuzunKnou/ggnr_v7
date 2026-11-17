'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { ExternalLink, Map, Plus, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { call } from '@/lib/api';
import { appFetch, withBasePathNav } from '@/lib/basePath';
import { isSuperUser } from '@/lib/auth/superUser';
import { cn } from '@/lib/utils';

type Row = {
  pmKey: number;
  pmTitle: string;
  pmCreateUser: string | null;
  dateLabel: string;
  openPath: string;
};

type Props = {
  onClose: () => void;
};

type FsEntry = FileSystemEntry;
type FsFile = FileSystemFileEntry;
type FsDir = FileSystemDirectoryEntry;

type PickedFile = { file: File; relativePath: string };

function readDirEntries(dir: FsDir): Promise<FsEntry[]> {
  const reader = dir.createReader();
  const all: FsEntry[] = [];
  const pull = (): Promise<void> =>
    new Promise((resolve, reject) => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve();
          return;
        }
        all.push(...batch);
        void pull().then(resolve, reject);
      }, reject);
    });
  return pull().then(() => all);
}

async function walkEntry(entry: FsEntry, prefix: string, out: PickedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      (entry as FsFile).file(resolve, reject);
    });
    const rel = prefix ? `${prefix}/${file.name}` : file.name;
    out.push({ file, relativePath: rel });
    return;
  }
  if (!entry.isDirectory) return;
  const next = prefix ? `${prefix}/${entry.name}` : entry.name;
  const children = await readDirEntries(entry as FsDir);
  for (const child of children) {
    await walkEntry(child, next, out);
  }
}

/** 끌어다 놓은 zip·파일·폴더를 구분 없이 읽는다 */
async function filesFromDataTransfer(dt: DataTransfer): Promise<PickedFile[]> {
  const entries: FsEntry[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (!entries.length) {
    return Array.from(dt.files ?? []).map((file) => ({ file, relativePath: file.name }));
  }
  const out: PickedFile[] = [];
  for (const entry of entries) {
    await walkEntry(entry, '', out);
  }
  if (out.length) return out;
  return Array.from(dt.files ?? []).map((file) => ({ file, relativePath: file.name }));
}

/** 왼쪽 메뉴 정책지도 — 파일 등록과 목록 */
export function PolicyMapListPanel({ onClose }: Props) {
  const { data: session, status } = useSession();
  const loggedIn = status === 'authenticated' && Boolean(session?.user?.id);
  const myId = session?.user?.id ?? '';

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'policyMapService',
        action: 'list',
        params: { keyword, limit: 100 },
      });
      if (!res?.success) {
        setError(String((res as { error?: string })?.error ?? '목록을 불러오지 못했습니다.'));
        setRows([]);
        return;
      }
      const data = (res.data ?? res) as { rows?: Row[] };
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [keyword]);

  useEffect(() => {
    if (status === 'loading') return;
    if (!loggedIn) {
      setLoading(false);
      setError('로그인이 필요합니다.');
      return;
    }
    const timer = window.setTimeout(() => {
      void refresh();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loggedIn, status, refresh]);

  const handleUpload = async () => {
    if (!title.trim()) {
      window.alert('제목을 입력하세요.');
      return;
    }
    if (!files.length) {
      window.alert('올릴 파일을 선택하세요.');
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set('title', title.trim());
      fd.set('paths', JSON.stringify(files.map((item) => item.relativePath)));
      for (const item of files) fd.append('files', item.file);
      const res = await appFetch('/api/policy-map/upload', { method: 'POST', body: fd });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error || '업로드에 실패했습니다.');
      }
      setTitle('');
      setFiles([]);
      setFormOpen(false);
      await refresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '업로드에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (row: Row) => {
    if (!window.confirm(`«${row.pmTitle}»을(를) 삭제할까요?`)) return;
    try {
      const res = await call('', 'POST', {
        service: 'policyMapService',
        action: 'remove',
        params: { pmKey: row.pmKey },
      });
      if (!res?.success) {
        throw new Error(String((res as { error?: string })?.error ?? '삭제에 실패했습니다.'));
      }
      await refresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '삭제에 실패했습니다.');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/5">
            <Map className="h-4 w-4 text-primary/80" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-foreground/90">정책지도</h1>
            <p className="text-[11px] text-muted-foreground">
              전체 <span className="font-medium text-foreground/80">{rows.length}</span>건
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            className={cn(
              'h-[26px] min-h-[26px] gap-1 rounded-lg border px-2.5 text-[12px] font-medium',
              formOpen
                ? 'border-primary bg-primary/15 text-primary hover:bg-primary/20'
                : 'border-border bg-background text-foreground hover:border-primary hover:bg-primary/10 hover:text-primary'
            )}
            onClick={() => setFormOpen((v) => !v)}
          >
            <Plus className="h-3 w-3" />
            등록
          </Button>
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="닫기"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {formOpen ? (
        <div className="shrink-0 border-b border-border bg-muted/25 px-3 py-3">
          <div className="rounded-lg border border-border bg-background p-3 shadow-sm">
            <p className="text-[12px] font-semibold text-foreground">정책지도 등록</p>
            <label className="mt-2.5 block text-[11px] font-medium text-foreground/80" htmlFor="policy-map-title">
              제목
            </label>
            <Input
              id="policy-map-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="지도 이름을 입력하세요"
              className="mt-1 h-8 text-[12px]"
            />
            <label
              className={cn(
                'mt-2.5 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-5 text-center transition-colors',
                dragOver
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-muted/40 hover:border-primary/50 hover:bg-muted/60'
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void filesFromDataTransfer(e.dataTransfer).then(setFiles);
              }}
            >
              <Upload className={cn('h-5 w-5', dragOver ? 'text-primary' : 'text-muted-foreground')} />
              <span className="text-[12px] font-medium text-foreground">파일을 놓거나 눌러 선택</span>
              <span className="text-[11px] leading-relaxed text-muted-foreground">
                zip, 파일, 폴더를 올리면 됩니다.
              </span>
              <input
                type="file"
                multiple
                className="sr-only"
                onChange={(e) =>
                  setFiles(
                    Array.from(e.target.files ?? []).map((file) => ({
                      file,
                      relativePath: file.webkitRelativePath?.trim() || file.name,
                    }))
                  )
                }
              />
            </label>
            {files.length > 0 ? (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-muted/60 px-2.5 py-1.5">
                <p className="min-w-0 truncate text-[11px] text-foreground">
                  {files.length}개 선택
                  <span className="text-muted-foreground">
                    {' '}
                    · {files[0]!.file.name}
                    {files.length > 1 ? ` 외 ${files.length - 1}개` : ''}
                  </span>
                </p>
                <button
                  type="button"
                  className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => setFiles([])}
                >
                  지우기
                </button>
              </div>
            ) : null}
            <div className="mt-3 flex justify-end gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-3 text-[12px]"
                disabled={saving}
                onClick={() => setFormOpen(false)}
              >
                취소
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1 px-3 text-[12px]"
                disabled={saving}
                onClick={() => void handleUpload()}
              >
                <Upload className="h-3.5 w-3.5" />
                {saving ? '올리는 중…' : '등록'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="shrink-0 border-b border-border px-3 py-2">
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="제목 검색"
          className="h-8 bg-muted/50 text-xs"
        />
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2.5 py-2">
        {loading ? (
          <p className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</p>
        ) : error ? (
          <p className="py-10 text-center text-xs text-destructive">{error}</p>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">등록된 정책지도가 없습니다.</p>
        ) : (
          rows.map((row) => {
            const canDelete = row.pmCreateUser === myId || isSuperUser(myId);
            return (
              <div
                key={row.pmKey}
                className="rounded-lg border border-border/80 bg-card px-3 py-2 hover:border-border hover:bg-muted/20"
              >
                <div className="flex items-start gap-2">
                  <a
                    href={withBasePathNav(row.openPath)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1"
                  >
                    <p className="truncate text-[12px] font-medium text-foreground/90">{row.pmTitle}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {[row.dateLabel, row.pmCreateUser].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </a>
                  <a
                    href={withBasePathNav(row.openPath)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary"
                    aria-label="열기"
                    title="열기"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  {canDelete ? (
                    <button
                      type="button"
                      className="mt-0.5 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label="삭제"
                      title="삭제"
                      onClick={() => void handleRemove(row)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
