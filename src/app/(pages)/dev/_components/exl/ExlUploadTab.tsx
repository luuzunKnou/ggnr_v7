'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Folder, File as FileIcon, ChevronUp, RefreshCw, Upload } from 'lucide-react';
import { ExlWizardModal } from './ExlWizardModal';

type DirEntry = { name: string; isDirectory: boolean; size: number; mtime: string };
type DirListResult = {
  directories: string[];
  files: { name: string; size: number; modified?: string }[];
};

function formatSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

type Props = {
  relativePath: string;
  onPathChange: (p: string) => void;
  onGoHistory?: () => void;
};

export function ExlUploadTab({ relativePath, onPathChange, onGoHistory }: Props) {
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

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
    parts.pop();
    onPathChange(parts.join('/'));
  }, [relativePath, onPathChange]);

  const goInto = useCallback(
    (name: string) => onPathChange(relativePath.replace(/\\/g, '/').replace(/\/$/, '') + '/' + name),
    [relativePath, onPathChange]
  );

  return (
    <div className="flex flex-col h-full min-h-0 p-2 gap-2">
      <div className="shrink-0 flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={goUp} disabled={!relativePath.replace(/\\/g, '/').trim()}>
          <ChevronUp className="w-3.5 h-3.5" /> 상위로
        </Button>
        <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">{relativePath}</span>
        <Button variant="outline" size="sm" onClick={fetchList} disabled={loading}>
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          새로고침
        </Button>
        <Button size="sm" onClick={() => setWizardOpen(true)}>
          <Upload className="w-3.5 h-3.5" />
          파일 업로드
        </Button>
      </div>
      {listError && <p className="text-sm text-destructive shrink-0">{listError}</p>}
      <section className="flex-1 min-h-0 overflow-auto border rounded-md">
        {loading ? (
          <div className="flex items-center justify-center h-full min-h-[8rem] text-xs text-muted-foreground">로딩 중…</div>
        ) : listError ? (
          <div className="flex items-center justify-center h-full min-h-[8rem] text-xs text-destructive">{listError}</div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center h-full min-h-[8rem] text-xs text-muted-foreground">
            폴더가 비어 있습니다. &quot;파일 업로드&quot; 버튼으로 Excel 파일을 업로드하세요.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted z-10">
              <tr className="text-left text-muted-foreground">
                <th className="py-1 px-2 w-6" />
                <th className="py-1 px-2">이름</th>
                <th className="py-1 px-2 w-20 text-right">크기</th>
                <th className="py-1 px-2 w-44">수정일</th>
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
                    {e.isDirectory ? <Folder className="w-4 h-4 text-yellow-500" /> : <FileIcon className="w-4 h-4 text-muted-foreground" />}
                  </td>
                  <td className="py-1 px-2 truncate max-w-[16rem]" title={e.name}>{e.name}</td>
                  <td className="py-1 px-2 text-right whitespace-nowrap">{e.isDirectory ? '—' : formatSize(e.size)}</td>
                  <td className="py-1 px-2 whitespace-nowrap">{e.mtime ? new Date(e.mtime).toLocaleString('ko-KR') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <ExlWizardModal
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        relativePath={relativePath}
        onSuccess={() => { fetchList(); onGoHistory?.(); }}
      />
    </div>
  );
}
