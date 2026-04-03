'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { call } from '@/lib/api';
import { RefreshCw } from 'lucide-react';

type Entry = {
  at: string;
  fileCount: number;
  savedPathsSample: string[];
  validation: {
    invalidTopCount: number;
    invalidKeyCount: number;
    looseFileCount: number;
    missingKeyTableCount?: number;
    keyQueryFailedCount?: number;
  };
  logFileRelative?: string;
};

export function FileDataHistoryTab() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [path, setPath] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'fileDataUploadService',
        action: 'getFileDataUploadHistory',
        params: { limit: 100 },
      });
      const d = res?.data ?? res;
      setEntries((d?.entries ?? []) as Entry[]);
      setPath(String(d?.path ?? ''));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  return (
    <div className="flex flex-col h-full min-h-0 p-2 gap-2">
      <div className="shrink-0 flex items-center gap-2">
        <span className="text-sm font-medium">첨부(file_data) 업로드 이력</span>
        <span className="text-xs text-muted-foreground flex-1 truncate" title={path}>
          {path ? `저장: ${path}` : ''}
        </span>
        <Button variant="outline" size="sm" onClick={() => void fetchList()} disabled={loading} className="gap-1">
          <RefreshCw className={loading ? 'w-3.5 h-3.5 animate-spin' : 'w-3.5 h-3.5'} /> 새로고침
        </Button>
      </div>

      <section className="flex-1 min-h-0 overflow-auto border rounded">
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">로딩 중…</div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-xs text-red-500 px-4">{error}</div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">이력이 없습니다.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted z-10">
              <tr className="text-left text-muted-foreground">
                <th className="py-1.5 px-2 w-44">일시</th>
                <th className="py-1.5 px-2 w-16 text-center">파일 수</th>
                <th className="py-1.5 px-2 w-28 text-center">검증 이슈</th>
                <th className="py-1.5 px-2">로그·샘플 경로</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row, idx) => {
                const v = row.validation;
                const issue =
                  v.invalidTopCount +
                  v.invalidKeyCount +
                  v.looseFileCount +
                  (v.missingKeyTableCount ?? 0) +
                  (v.keyQueryFailedCount ?? 0);
                return (
                  <tr key={`${row.at}-${idx}`} className="border-t hover:bg-muted/30 align-top">
                    <td className="py-1.5 px-2 whitespace-nowrap">{new Date(row.at).toLocaleString('ko-KR')}</td>
                    <td className="py-1.5 px-2 text-center">{row.fileCount}</td>
                    <td className="py-1.5 px-2 text-center">{issue > 0 ? <span className="text-amber-600">{issue}</span> : '—'}</td>
                    <td className="py-1.5 px-2">
                      {row.logFileRelative && (
                        <div className="font-mono text-[10px] text-muted-foreground mb-0.5">log: {row.logFileRelative}</div>
                      )}
                      <div className="text-[10px] text-muted-foreground space-y-0.5 max-h-20 overflow-auto">
                        {(row.savedPathsSample ?? []).slice(0, 5).map((p) => (
                          <div key={p} className="truncate" title={p}>
                            {p}
                          </div>
                        ))}
                        {(row.savedPathsSample?.length ?? 0) > 5 && <div>…</div>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
