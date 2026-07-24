'use client';

import { useState, useEffect, useCallback } from 'react';
import { call } from '@/lib/api';
import { Button } from '@/app/shadcnComponents/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/app/shadcnComponents/ui/dialog';
import { RefreshCw } from 'lucide-react';
import { registerExcelHistoryRefresh } from '../layerManager/layerManagerUploadBridge';
import { ExcelProcessLogLines } from './ExcelProcessLogLines';

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

  const [logOpen, setLogOpen] = useState(false);
  const [logLoading, setLogLoading] = useState(false);
  const [logTitle, setLogTitle] = useState('');
  const [logPath, setLogPath] = useState<string | null>(null);
  const [logContent, setLogContent] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<number | null>(null);

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

  useEffect(() => {
    return registerExcelHistoryRefresh(() => {
      void fetchList();
    });
  }, [fetchList]);

  const openLog = useCallback(async (row: HistoryRow) => {
    const sourcePath = row.ehSourcePath?.trim();
    if (!sourcePath) {
      setSelectedKey(row.ehKey);
      setLogTitle(row.ehTableKorName || row.ehTableName || `이력 #${row.ehKey}`);
      setLogPath(null);
      setLogContent(null);
      setLogError('파일 경로가 없어 로그를 찾을 수 없습니다.');
      setLogOpen(true);
      return;
    }

    setSelectedKey(row.ehKey);
    setLogTitle(row.ehTableKorName || row.ehTableName || pathBasename(sourcePath));
    setLogPath(null);
    setLogContent(null);
    setLogError(null);
    setLogOpen(true);
    setLogLoading(true);
    try {
      const res = await call('', 'POST', {
        service: 'excelHistoryService',
        action: 'getExcelHistoryLog',
        params: { sourcePath },
      });
      const d = res?.data ?? res;
      if (d?.logPath) setLogPath(String(d.logPath));
      if (!d?.success) {
        setLogError(d?.error ?? '로그 조회 실패');
        setLogContent(null);
        return;
      }
      setLogContent(typeof d.content === 'string' ? d.content : '');
    } catch (e: unknown) {
      setLogError(e instanceof Error ? e.message : String(e));
      setLogContent(null);
    } finally {
      setLogLoading(false);
    }
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col h-full min-h-0 px-2 pt-2 pb-0 gap-2">
      <div className="shrink-0 flex items-center gap-2">
        {!embedded && (
          <span className="text-sm font-medium whitespace-nowrap">Excel 업로드 이력</span>
        )}
        <span className="text-xs text-muted-foreground flex-1">
          총 {total}건 · 행 클릭 시 처리 로그 보기
        </span>
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
            <thead className="sticky top-0 z-10">
              <tr className="text-left">
                <th className="py-1 px-2 text-xs font-medium border-r bg-muted w-40">업로드 날짜</th>
                <th className="py-1 px-2 text-xs font-medium border-r bg-muted w-40">테이블명</th>
                <th className="py-1 px-2 text-xs font-medium border-r bg-muted w-40">한글명</th>
                <th className="py-1 px-2 text-xs font-medium border-r bg-muted w-18 text-right">행 수</th>
                <th className="py-1 px-2 text-xs font-medium border-r bg-muted w-18 text-center">결과</th>
                <th className="py-1 px-2 text-xs font-medium bg-muted">파일 경로</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.ehKey}
                  className={`border-t hover:bg-muted/40 cursor-pointer ${
                    selectedKey === r.ehKey && logOpen ? 'bg-muted/60' : ''
                  }`}
                  onClick={() => void openLog(r)}
                >
                  <td className="h-[28px] px-2 align-middle whitespace-nowrap">{r.ehCreateDate ? new Date(r.ehCreateDate).toLocaleString() : '—'}</td>
                  <td className="h-[28px] px-2 align-middle font-mono truncate max-w-[7rem]" title={r.ehTableName ?? ''}>{r.ehTableName ?? '—'}</td>
                  <td className="h-[28px] px-2 align-middle truncate max-w-[14rem]" title={r.ehTableKorName ?? ''}>{r.ehTableKorName ?? '—'}</td>
                  <td className="h-[28px] px-2 align-middle text-right">{r.ehRowCount != null ? r.ehRowCount.toLocaleString('ko-KR') : '—'}</td>
                  <td className="h-[28px] px-2 align-middle text-center">{r.ehResult ?? '—'}</td>
                  <td className="h-[28px] px-2 align-middle text-muted-foreground truncate max-w-[20rem]" title={r.ehSourcePath ?? ''}>
                    {r.ehSourcePath ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

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

      <Dialog
        open={logOpen}
        onOpenChange={(open) => {
          setLogOpen(open);
          if (!open) setSelectedKey(null);
        }}
      >
        <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col gap-2 overflow-hidden">
          <DialogHeader className="shrink-0 space-y-1">
            <DialogTitle className="text-base">처리 로그 — {logTitle}</DialogTitle>
            <DialogDescription className="text-xs font-mono break-all">
              {logPath ?? '—'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-auto rounded border bg-muted/30 p-3">
            {logLoading ? (
              <p className="text-xs text-muted-foreground">로그 불러오는 중…</p>
            ) : logError ? (
              <p className="text-xs text-red-500">{logError}</p>
            ) : (
              <ExcelProcessLogLines text={logContent} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function pathBasename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || p;
}
