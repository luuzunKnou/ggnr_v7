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
import {
  RefreshCw,
  Search,
  FileText,
  Check,
  X,
  Loader2,
  RotateCcw,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
} from 'lucide-react';
import { registerExcelHistoryRefresh } from '../layerManager/layerManagerUploadBridge';
import { ExcelProcessLogLines } from './ExcelProcessLogLines';
import { SyncDetailModal } from '../shp/SyncDetailModal';

type HistoryRow = {
  ehKey: number;
  ehSourcePath: string | null;
  ehTableName: string | null;
  ehTableKorName: string | null;
  ehOldRowCount: number | null;
  ehRowCount: number | null;
  ehResult: string | null;
  ehContents: string | null;
  ehCreateDate: string | null;
  ehCreateUser: number | null;
  appendCount?: number | null;
  conflictCount?: number | null;
  removeCount?: number | null;
  keptCount?: number | null;
};

const PAGE_SIZE = 20;

function formatCount(n: number | null | undefined): string {
  if (n == null) return '—';
  return Number(n).toLocaleString('ko-KR');
}

function formatUpdateContents(r: HistoryRow): string {
  const raw = (r.ehContents ?? '').trim();
  if (raw && !raw.includes('\n') && raw.length <= 200) {
    // 예전 «신규 적재» 문구도 목록에서 통일 표기
    if (raw.startsWith('신규 적재 ')) return raw.replace(/^신규 적재 /, '신규 ');
    return raw;
  }
  const oldN = r.ehOldRowCount;
  const newN = r.ehRowCount;
  if (oldN == null && newN == null) return '—';
  if (oldN == null || oldN === 0) {
    if (newN == null) return '신규';
    return `신규 ${formatCount(newN)}건`;
  }
  if (newN == null) return `전체 교체 (이전 ${formatCount(oldN)})`;
  return `전체 교체 (이전 ${formatCount(oldN)} → 현재 ${formatCount(newN)})`;
}

function showHistoryBtn(r: HistoryRow): boolean {
  if (!r.ehTableName?.trim()) return false;
  const a = r.appendCount ?? 0;
  const c = r.conflictCount ?? 0;
  const rm = r.removeCount ?? 0;
  const k = r.keptCount ?? 0;
  if (a + c + rm + k > 0) return true;
  const contents = (r.ehContents ?? '').trim();
  if (/추가|변경|삭제|유지|정합성|신규|전체 교체/.test(contents)) return true;
  // 기존 테이블 갱신 완료 건 — 로그 연결 누락이어도 조회 시도
  if (r.ehResult === '성공' && r.ehOldRowCount != null && r.ehOldRowCount > 0) return true;
  return false;
}

function ResultBadge({ result }: { result: string | null }) {
  switch (result) {
    case '성공':
      return <Check className="w-3.5 h-3.5 text-green-600 mx-auto" />;
    case '대기':
      return <span className="text-[10px] text-orange-500 font-medium">대기</span>;
    case '롤백':
      return <RotateCcw className="w-3.5 h-3.5 text-muted-foreground mx-auto" />;
    case '부분롤백':
      return <span className="text-[10px] text-yellow-600 font-medium">부분롤백</span>;
    case '진행중':
      return <Loader2 className="w-3.5 h-3.5 text-muted-foreground mx-auto animate-spin" />;
    default:
      return <X className="w-3.5 h-3.5 text-red-500 mx-auto" />;
  }
}

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

  const [syncModal, setSyncModal] = useState<{ ehKey: number; tableName: string } | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      try {
        await call('', 'POST', {
          service: 'excelHistoryService',
          action: 'repairExcelHistoryIntegrityContents',
          params: { limit: 50 },
        });
      } catch {
        /* ignore */
      }
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

  const openHistory = useCallback(async (row: HistoryRow) => {
    const tableName = row.ehTableName?.trim();
    if (!tableName) return;
    // 완료 건 중 로그·이력 번호 미연결이 있으면 조회 직전에 한 번 보정
    try {
      await call('', 'POST', {
        service: 'excelHistoryService',
        action: 'attachExcelIntegritySyncToHistory',
        params: { ehKey: row.ehKey, tableName },
      });
    } catch {
      /* ignore */
    }
    setSyncModal({ ehKey: row.ehKey, tableName });
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col h-full min-h-0 px-2 pt-2 pb-0 gap-2">
      <div className="shrink-0 flex items-center gap-2">
        {!embedded && (
          <span className="text-sm font-medium whitespace-nowrap">Excel 업로드 이력</span>
        )}
        <span className="text-xs text-muted-foreground flex-1">
          총 {total}건 · «이력 조회»로 행 변경 확인 · «처리 로그»로 업로드 로그 확인
        </span>
        <Button variant="outline" size="sm" onClick={fetchList} className="gap-1">
          <RefreshCw className="w-3.5 h-3.5" /> 새로고침
        </Button>
      </div>

      <section className="flex-1 min-h-0 overflow-auto border rounded">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="text-left">
              <th className="py-1 px-1 text-xs font-medium border-r bg-muted w-14 text-center">결과</th>
              <th className="py-1 px-2 text-xs font-medium border-r bg-muted w-36 whitespace-nowrap">업로드 날짜</th>
              <th className="py-1 px-2 text-xs font-medium border-r bg-muted w-44">테이블명</th>
              <th className="py-1 px-2 text-xs font-medium border-r bg-muted w-48">한글명</th>
              <th className="py-1 px-2 text-xs font-medium border-r bg-muted w-20 text-right" title="TRUNCATE 직전 행 수">이전</th>
              <th className="py-1 px-2 text-xs font-medium border-r bg-muted w-20 text-right" title="삽입 후 행 수">현재</th>
              <th className="py-1 px-2 text-xs font-medium border-r bg-muted min-w-[12rem]">업데이트 내용</th>
              <th className="py-1 px-2 text-xs font-medium bg-muted w-36 text-center">액션</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-muted-foreground">
                  로딩 중…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-red-500">
                  {error}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-muted-foreground">
                  이력이 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.ehKey}
                  className={`border-t hover:bg-muted/40 ${
                    selectedKey === r.ehKey && logOpen ? 'bg-muted/60' : ''
                  }`}
                >
                  <td className="h-[28px] px-2 align-middle text-center">
                    <ResultBadge result={r.ehResult} />
                  </td>
                  <td className="h-[28px] px-2 align-middle whitespace-nowrap">
                    {r.ehCreateDate ? String(r.ehCreateDate) : '—'}
                  </td>
                  <td className="h-[28px] px-2 align-middle font-mono truncate max-w-[11rem]" title={r.ehTableName ?? ''}>
                    {r.ehTableName ?? '—'}
                  </td>
                  <td className="h-[28px] px-2 align-middle truncate max-w-[12rem]" title={r.ehTableKorName ?? ''}>
                    {r.ehTableKorName ?? '—'}
                  </td>
                  <td className="h-[28px] px-2 align-middle text-right tabular-nums">
                    {formatCount(r.ehOldRowCount)}
                  </td>
                  <td className="h-[28px] px-2 align-middle text-right tabular-nums">
                    {formatCount(r.ehRowCount)}
                  </td>
                  <td
                    className="h-[28px] px-2 align-middle truncate max-w-[20rem]"
                    title={formatUpdateContents(r)}
                  >
                    {formatUpdateContents(r)}
                  </td>
                  <td className="h-[28px] px-2 align-middle text-center">
                    <div className="inline-flex items-center gap-1.5">
                      {showHistoryBtn(r) ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-0.5 text-[10px] text-blue-600 hover:underline font-medium"
                          onClick={() => {
                            void openHistory(r);
                          }}
                        >
                          <Search className="w-3 h-3" />
                          이력 조회
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:underline font-medium"
                        onClick={() => void openLog(r)}
                      >
                        <FileText className="w-3 h-3" />
                        처리 로그
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <div className="shrink-0 flex items-center justify-center gap-1 text-xs">
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          disabled={page <= 1 || loading}
          onClick={() => setPage(1)}
          title="처음"
          aria-label="처음"
        >
          <ChevronsLeft className="w-4 h-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => p - 1)}
          title="이전"
          aria-label="이전"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="px-2 tabular-nums">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          disabled={page >= totalPages || loading}
          onClick={() => setPage((p) => p + 1)}
          title="다음"
          aria-label="다음"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          disabled={page >= totalPages || loading}
          onClick={() => setPage(totalPages)}
          title="끝"
          aria-label="끝"
        >
          <ChevronsRight className="w-4 h-4" />
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

      {syncModal ? (
        <SyncDetailModal
          source="excel"
          ehKey={syncModal.ehKey}
          tableName={syncModal.tableName}
          readOnly
          onClose={() => {
            setSyncModal(null);
            void fetchList();
          }}
        />
      ) : null}
    </div>
  );
}

function pathBasename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || p;
}
