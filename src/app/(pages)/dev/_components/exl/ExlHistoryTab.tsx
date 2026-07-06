'use client';

import { useState, useEffect, useCallback } from 'react';
import { call } from '@/lib/api';
import { Button } from '@/app/shadcnComponents/ui/button';
import { RefreshCw } from 'lucide-react';

type HistoryRow = {
  ehKey: number;
  ehSourcePath: string | null;
  ehTableName: string | null;
  ehTableKorName: string | null;
  ehRowCount: number | null;
  ehResult: string | null;
  ehContents: string | null;
  ehCreateDate: string | null;
  ehCreateUser: number | null;
};

const PAGE_SIZE = 20;

export function ExlHistoryTab({ embedded = false }: { embedded?: boolean } = {}) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'excelHistoryService',
        action: 'getExcelHistoryList',
        params: { page, limit: PAGE_SIZE },
      });
      const d = res?.data ?? res;
      if (!d?.success) {
        setError(d?.error ?? '조회 실패');
        setRows([]);
        setTotal(0);
        return;
      }
      setRows(Array.isArray(d.data) ? d.data : []);
      setTotal(d.total ?? 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col h-full min-h-0 p-2 gap-2">
      <div className="shrink-0 flex items-center gap-2">
        {!embedded && (
          <span className="text-sm font-medium whitespace-nowrap">Excel 업로드 이력</span>
        )}
        <span className="text-xs text-muted-foreground flex-1">총 {total}건</span>
        <Button variant="outline" size="sm" onClick={fetchList} className="gap-1">
          <RefreshCw className="w-3.5 h-3.5" /> 새로고침
        </Button>
      </div>

      <section className="flex-1 min-h-0 overflow-auto border rounded">
        {loading ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">로딩 중…</div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-xs text-red-500">{error}</div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">이력이 없습니다.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted z-10">
              <tr className="text-muted-foreground">
                <th className="py-1.5 px-2 text-left w-36">업로드 날짜</th>
                <th className="py-1.5 px-2 text-left w-28">테이블명</th>
                <th className="py-1.5 px-2 text-left w-40">한글명</th>
                <th className="py-1.5 px-2 text-right w-16">행 수</th>
                <th className="py-1.5 px-2 text-left w-24">결과</th>
                <th className="py-1.5 px-2 text-left">파일 경로</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ehKey} className="border-t hover:bg-muted/40">
                  <td className="py-1 px-2 whitespace-nowrap">{r.ehCreateDate ? new Date(r.ehCreateDate).toLocaleString() : '—'}</td>
                  <td className="py-1 px-2 font-mono truncate max-w-[7rem]" title={r.ehTableName ?? ''}>{r.ehTableName ?? '—'}</td>
                  <td className="py-1 px-2 truncate max-w-[14rem]" title={r.ehTableKorName ?? ''}>{r.ehTableKorName ?? '—'}</td>
                  <td className="py-1 px-2 text-right">{r.ehRowCount ?? '—'}</td>
                  <td className="py-1 px-2">{r.ehResult ?? '—'}</td>
                  <td className="py-1 px-2 text-muted-foreground truncate max-w-[20rem]" title={r.ehSourcePath ?? ''}>
                    {r.ehSourcePath ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {totalPages > 1 && (
        <div className="shrink-0 flex items-center justify-center gap-2 text-xs">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            이전
          </Button>
          <span>
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            다음
          </Button>
        </div>
      )}
    </div>
  );
}
