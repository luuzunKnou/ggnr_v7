'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { RefreshCw, ChevronDown, ChevronRight, Check, X, RotateCcw, Search, Loader2 } from 'lucide-react';
import { SyncDetailModal } from './SyncDetailModal';

type HistoryRow = {
  lhKey: number;
  lhContents: string | null;
  lhSuccessCount: number | null;
  lhFailCount: number | null;
  lhCreateUser: number | null;
  lhCreateDate: string | null;
};

type DetailRow = {
  dhKey: number;
  dhLhKey: number | null;
  dhGroup: string | null;
  dhName: string | null;
  dhKorName: string | null;
  dhType: string | null;
  dhOldData: number | null;
  dhNewData: number | null;
  dhAppendCount: number | null;
  dhConflictCount: number | null;
  dhRemoveCount: number | null;
  dhContents: string | null;
  dhResult: string | null;
  dhShpPath: string | null;
};

export function ShpHistoryTab({ embedded = false }: { embedded?: boolean } = {}) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expandedKey, setExpandedKey] = useState<number | null>(null);
  const [details, setDetails] = useState<DetailRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [syncModal, setSyncModal] = useState<{ dhKey: number; tableName: string; shpPath?: string | null } | null>(null);
  const [syncLoading, setSyncLoading] = useState<number | null>(null);

  const PAGE_SIZE = 20;

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'layerHistoryService',
        action: 'getLayerHistoryList',
        params: { page, limit: PAGE_SIZE },
      });
      const d = res?.data ?? res;
      setRows(d?.data ?? []);
      setTotal(d?.total ?? 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const fetchDetails = useCallback(async (lhKey: number) => {
    setDetailLoading(true);
    try {
      const res = await call('', 'POST', {
        service: 'layerHistoryService',
        action: 'getLayerDetailHistory',
        params: { lhKey },
      });
      const d = res?.data ?? res;
      setDetails(d?.data ?? []);
    } catch {
      setDetails([]);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const toggleExpand = useCallback(
    async (lhKey: number) => {
      if (expandedKey === lhKey) {
        setExpandedKey(null);
        setDetails([]);
        return;
      }
      setExpandedKey(lhKey);
      await fetchDetails(lhKey);
    },
    [expandedKey, fetchDetails]
  );

  const handleSyncClick = useCallback(async (d: DetailRow) => {
    if (!d.dhName) return;
    setSyncLoading(d.dhKey);
    try {
      // 대기 상태면 sync_log 미결 존재 여부 확인, 없으면 재비교
      if (d.dhResult === '대기' && d.dhShpPath) {
        const logsRes = await call('', 'POST', {
          service: 'shpUploadService',
          action: 'getSyncLogs',
          params: { tableName: d.dhName },
        });
        const ld = logsRes?.data ?? logsRes;
        const pending = (ld?.rows ?? []).filter((r: Record<string, unknown>) => !r.sl_operation);
        if (pending.length === 0) {
          const cmpRes = await call('', 'POST', {
            service: 'shpUploadService',
            action: 'compareShpWithTable',
            params: { pathOrResult: d.dhShpPath },
          });
          const cmp = cmpRes?.data ?? cmpRes;
          if (!cmp?.success) {
            alert(cmp?.error ?? '비교 실패');
            return;
          }
        }
      }
      setSyncModal({ dhKey: d.dhKey, tableName: d.dhName, shpPath: d.dhShpPath });
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncLoading(null);
    }
  }, []);

  const handleModalClose = useCallback(() => {
    setSyncModal(null);
    if (expandedKey) fetchDetails(expandedKey);
  }, [expandedKey, fetchDetails]);

  const hasSyncCounts = (d: DetailRow) => (d.dhAppendCount ?? 0) + (d.dhConflictCount ?? 0) + (d.dhRemoveCount ?? 0) > 0;
  const showSyncBtn = (d: DetailRow) => d.dhName && (d.dhResult === '대기' || hasSyncCounts(d));

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col h-full min-h-0 p-2 gap-2">
      <div className="shrink-0 flex items-center gap-2">
        {!embedded && (
          <span className="text-sm font-medium">레이어 업데이트 이력</span>
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
              <tr className="text-left text-muted-foreground">
                <th className="py-1.5 px-2 w-8" />
                <th className="py-1.5 px-2 w-28">업데이트 날짜</th>
                <th className="py-1.5 px-2 w-20">작업자</th>
                <th className="py-1.5 px-2 w-20 text-center">레이어 수</th>
                <th className="py-1.5 px-2 w-16 text-center">성공</th>
                <th className="py-1.5 px-2 w-16 text-center">실패</th>
                <th className="py-1.5 px-2">업데이트 내용</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isExpanded = expandedKey === row.lhKey;
                const layerCount = (row.lhSuccessCount ?? 0) + (row.lhFailCount ?? 0);
                return (
                  <Fragment key={row.lhKey}>
                    <tr
                      className={cn('border-t cursor-pointer hover:bg-muted/40', isExpanded && 'bg-muted/20')}
                      onClick={() => toggleExpand(row.lhKey)}
                    >
                      <td className="py-1.5 px-2">
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </td>
                      <td className="py-1.5 px-2 whitespace-nowrap">{row.lhCreateDate ?? '—'}</td>
                      <td className="py-1.5 px-2 text-muted-foreground">{row.lhCreateUser ?? '—'}</td>
                      <td className="py-1.5 px-2 text-center">{layerCount}</td>
                      <td className="py-1.5 px-2 text-center text-green-600">{row.lhSuccessCount ?? 0}</td>
                      <td className="py-1.5 px-2 text-center text-red-500">{row.lhFailCount ?? 0}</td>
                      <td className="py-1.5 px-2 truncate max-w-[20rem]" title={row.lhContents ?? ''}>{row.lhContents ?? '—'}</td>
                    </tr>
                    {isExpanded && (
                      <tr key={`detail-${row.lhKey}`}>
                        <td colSpan={7} className="p-0">
                          <div className="bg-muted/10 border-t border-b">
                            {detailLoading ? (
                              <div className="py-4 text-center text-xs text-muted-foreground">상세 이력 로딩 중…</div>
                            ) : details.length === 0 ? (
                              <div className="py-4 text-center text-xs text-muted-foreground">상세 이력이 없습니다.</div>
                            ) : (
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left text-muted-foreground bg-muted/30">
                                    <th className="py-1 px-2 w-14 text-center">결과</th>
                                    <th className="py-1 px-2 w-24">레이어 그룹</th>
                                    <th className="py-1 px-2">레이어 한글명</th>
                                    <th className="py-1 px-2">레이어 영문명</th>
                                    <th className="py-1 px-2 w-16">구분</th>
                                    <th className="py-1 px-2 w-14 text-right" title="처리 전 DB 행 수">이전</th>
                                    <th className="py-1 px-2 w-14 text-right" title="처리 후 DB 행 수">현재</th>
                                    <th className="py-1 px-2 w-14 text-right text-emerald-700 dark:text-emerald-400" title="SHP 기준 추가 행">추가</th>
                                    <th className="py-1 px-2 w-14 text-right text-orange-600" title="속성 충돌(변경 필요)">변경</th>
                                    <th className="py-1 px-2 w-14 text-right text-red-500" title="삭제 대상">삭제</th>
                                    <th className="py-1 px-2">업데이트 내용</th>
                                    <th className="py-1 px-2 w-24 text-center">액션</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {details.map((d) => (
                                    <tr
                                      key={d.dhKey}
                                      className={cn(
                                        'border-t border-muted hover:bg-muted/20',
                                        showSyncBtn(d) && 'cursor-pointer'
                                      )}
                                      onClick={() => showSyncBtn(d) && handleSyncClick(d)}
                                    >
                                      <td className="py-1 px-2 text-center">
                                        <ResultBadge result={d.dhResult} />
                                      </td>
                                      <td className="py-1 px-2 truncate max-w-[6rem]" title={d.dhGroup ?? ''}>{d.dhGroup ?? '—'}</td>
                                      <td className="py-1 px-2 truncate max-w-[8rem]" title={d.dhKorName ?? ''}>{d.dhKorName ?? '—'}</td>
                                      <td className="py-1 px-2 font-mono truncate max-w-[8rem]" title={d.dhName ?? ''}>{d.dhName ?? '—'}</td>
                                      <td className="py-1 px-2">{d.dhType ?? '—'}</td>
                                      <td className="py-1 px-2 text-right tabular-nums">{d.dhOldData ?? '—'}</td>
                                      <td className="py-1 px-2 text-right tabular-nums">{d.dhNewData ?? '—'}</td>
                                      <td className="py-1 px-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{d.dhAppendCount ?? '—'}</td>
                                      <td className="py-1 px-2 text-right tabular-nums text-orange-600">{d.dhConflictCount ?? '—'}</td>
                                      <td className="py-1 px-2 text-right tabular-nums text-red-500">{d.dhRemoveCount ?? '—'}</td>
                                      <td className="py-1 px-2 truncate max-w-[10rem]" title={d.dhContents ?? ''}>{d.dhContents ?? '—'}</td>
                                      <td className="py-1 px-2 text-center">
                                        {showSyncBtn(d) && (
                                          <button
                                            type="button"
                                            className="inline-flex items-center gap-0.5 text-[10px] text-blue-600 hover:underline font-medium"
                                            onClick={(e) => { e.stopPropagation(); handleSyncClick(d); }}
                                            disabled={syncLoading === d.dhKey}
                                          >
                                            {syncLoading === d.dhKey
                                              ? <Loader2 className="w-3 h-3 animate-spin" />
                                              : <Search className="w-3 h-3" />}
                                            정합성 검증
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {totalPages > 1 && (
        <div className="shrink-0 flex items-center justify-center gap-2 text-xs">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</Button>
          <span>{page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>다음</Button>
        </div>
      )}

      {syncModal && (
        <SyncDetailModal
          dhKey={syncModal.dhKey}
          tableName={syncModal.tableName}
          shpPath={syncModal.shpPath}
          onClose={handleModalClose}
          onRollbackDone={() => { if (expandedKey) fetchDetails(expandedKey); }}
        />
      )}
    </div>
  );
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
    default:
      return <X className="w-3.5 h-3.5 text-red-500 mx-auto" />;
  }
}
