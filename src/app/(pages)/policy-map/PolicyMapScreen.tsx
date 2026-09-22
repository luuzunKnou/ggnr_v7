'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ArrowLeft, ExternalLink, Plus, Trash2, Upload } from 'lucide-react';
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

export function PolicyMapScreen() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const loggedIn = status === 'authenticated' && Boolean(session?.user?.id);
  const myId = session?.user?.id ?? '';

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploadMode, setUploadMode] = useState<'zip' | 'files' | 'folder'>('zip');
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
    void refresh();
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
      for (const f of files) fd.append('files', f);
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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="뒤로"
            title="뒤로"
            onClick={() => {
              if (typeof window !== 'undefined' && window.history.length > 1) {
                router.back();
              } else {
                router.push('/');
              }
            }}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="truncate text-lg font-semibold text-foreground">정책지도 바로가기</h1>
        </div>
        {loggedIn ? (
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1 text-[12px]"
            onClick={() => setFormOpen((v) => !v)}
          >
            <Plus className="h-3.5 w-3.5" />
            등록
          </Button>
        ) : null}
      </div>

      {formOpen ? (
        <div className="rounded-md border border-border bg-muted/20 p-3">
          <p className="mb-2 text-[12px] text-muted-foreground">
            zip · HTML 한 장 · 여러 파일 · 폴더 중 편한 방식으로 올리세요. HTML이 포함되어야 합니다.
          </p>
          <div className="mb-2 flex flex-wrap gap-1">
            {(
              [
                { id: 'zip' as const, label: 'zip' },
                { id: 'files' as const, label: '파일(여러 개)' },
                { id: 'folder' as const, label: '폴더' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                className={cn(
                  'rounded border px-2 py-1 text-[11px]',
                  uploadMode === m.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted/50'
                )}
                onClick={() => {
                  setUploadMode(m.id);
                  setFiles([]);
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1 text-[12px]">
              <span className="mb-1 block text-muted-foreground">제목</span>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="예: 동구 정책지도"
                className="h-8"
              />
            </label>
            <label className="text-[12px]">
              <span className="mb-1 block text-muted-foreground">
                {uploadMode === 'zip'
                  ? 'zip 파일'
                  : uploadMode === 'folder'
                    ? '폴더 선택'
                    : '파일 선택'}
              </span>
              {uploadMode === 'folder' ? (
                <input
                  type="file"
                  multiple
                  className="h-8 max-w-[260px] cursor-pointer text-[11px]"
                  ref={(el) => {
                    if (!el) return;
                    el.setAttribute('webkitdirectory', '');
                    el.setAttribute('directory', '');
                  }}
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                />
              ) : (
                <Input
                  type="file"
                  accept={
                    uploadMode === 'zip'
                      ? '.zip,application/zip'
                      : '.html,.htm,.css,.js,.json,.png,.jpg,.jpeg,.gif,.svg,.webp,.woff,.woff2,.ttf,.geojson,.xml,.txt,image/*,text/css,application/javascript'
                  }
                  multiple={uploadMode === 'files'}
                  className="h-8 max-w-[260px] cursor-pointer text-[11px]"
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                />
              )}
            </label>
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1"
              disabled={saving}
              onClick={() => void handleUpload()}
            >
              <Upload className="h-3.5 w-3.5" />
              {saving ? '올리는 중…' : '올리기'}
            </Button>
          </div>
          {files.length > 0 ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              선택 {files.length}개
              {files.length === 1 ? ` · ${files[0]!.name}` : ''}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex shrink-0 gap-2">
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="제목 검색"
          className="h-8 max-w-xs"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void refresh();
          }}
        />
        <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => void refresh()}>
          검색
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        {loading ? (
          <p className="p-6 text-center text-sm text-muted-foreground">불러오는 중…</p>
        ) : error ? (
          <p className="p-6 text-center text-sm text-destructive">{error}</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">등록된 정책지도가 없습니다.</p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="sticky top-0 border-b border-border bg-muted/60">
              <tr>
                <th className="px-3 py-2 font-medium">제목</th>
                <th className="w-28 px-3 py-2 font-medium">등록자</th>
                <th className="w-28 px-3 py-2 font-medium">날짜</th>
                <th className="w-24 px-3 py-2 font-medium"> </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const canDelete = row.pmCreateUser === myId || isSuperUser(myId);
                return (
                  <tr key={row.pmKey} className="border-b border-border/70 hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <a
                        href={withBasePathNav(row.openPath)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      >
                        {row.pmTitle}
                        <ExternalLink className="h-3 w-3 opacity-70" />
                      </a>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{row.pmCreateUser || '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.dateLabel}</td>
                    <td className="px-3 py-2 text-right">
                      {canDelete ? (
                        <button
                          type="button"
                          className={cn(
                            'inline-flex rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
                          )}
                          title="삭제"
                          onClick={() => void handleRemove(row)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
