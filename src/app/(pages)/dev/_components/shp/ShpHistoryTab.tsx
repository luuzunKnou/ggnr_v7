'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { RefreshCw, ChevronDown, ChevronRight, Check, X, RotateCcw, Search, Loader2 } from 'lucide-react';
import { SyncDetailModal } from './SyncDetailModal';
import { registerShpHistoryRefresh } from '../layerManager/layerManagerUploadBridge';

type HistoryRow = {
  lhKey: number;
  lhContents: string | null;
  lhSuccessCount: number | null;
  lhFailCount: number | null;
  lhCreateUser: string | null;
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

export function ShpHistoryTab({
  embedded = false,
  active = true,
}: { embedded?: boolean; active?: boolean } = {}) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expandedKey, setExpandedKey] = useState<number | null>(null);
  const [details, setDetails] = useState<DetailRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [syncModal, setSyncModal] = useState<{ dhKey: number; tableName: string; shpPath?: string | null } | null>(null);

  /** 연속 fetch(완료 refresh + 탭 진입) 시 이전 응답이 덮어쓰지 않도록 */
  const fetchGenRef = useRef(0);

  const PAGE_SIZE = 20;

  const fetchList = useCallback(async () => {
    const gen = ++fetchGenRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await call('', 'POST', {
        service: 'layerHistoryService',
        action: 'getLayerHistoryList',
        params: { page, limit: PAGE_SIZE },
      });
      if (gen !== fetchGenRef.current) return;
      const d = res?.data ?? res;
      setRows(d?.data ?? []);
      setTotal(d?.total ?? 0);
    } catch (e: unknown) {
      if (gen !== fetchGenRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (gen === fetchGenRef.current) setLoading(false);
    }
  }, [page]);

  // 탭이 보일 때·페이지 변경 시 목록 조회 (숨김 탭은 스킵 → 진입 시 새 행 반영)
  useEffect(() => {
    if (!active) return;
    void fetchList();
  }, [active, fetchList]);

  useEffect(() => {
    return registerShpHistoryRefresh(() => {
      setPage(1);
      void fetchList();
    });
  }, [fetchList]);

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

  const handleSyncClick = useCallback((d: DetailRow) => {
    if (!d.dhName) return;
    setSyncModal({ dhKey: d.dhKey, tableName: d.dhName, shpPath: d.dhShpPath });
  }, []);

  const handleModalClose = useCallback(() => {
    setSyncModal(null);
    if (expandedKey) fetchDetails(expandedKey);
  }, [expandedKey, fetchDetails]);

  const showSyncBtn = (d: DetailRow) => {
    if (!d.dhName) return false;
    // 내용이 명시적으로 «변경 없음»이거나, 추가·변경·삭제가 모두 0으로 확정된 경우만 숨김
    // (null 건수 = 미기록 → 버튼 유지)
    if ((d.dhContents ?? '').trim() === '변경 없음') return false;
    if (
      d.dhAppendCount === 0
      && d.dhConflictCount === 0
      && d.dhRemoveCount === 0
    ) {
      return false;
    }
    return true;
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col h-full min-h-0 px-2 pt-2 pb-0 gap-2">
      <div className="shrink-0 flex items-center gap-2">
        {!embedded && (
          <span className="text-sm font-medium">레이어 업데이트 이력</span>
        )}
        <span className="text-xs text-muted-foreground flex-1">총 {total}건</span>
        <Button variant="outline" size="sm" onClick={fetchList} className="gap-1">
          <RefreshCw className="w-3.5 h-3.5" /> 새로고침
        </Button>
      </div>

      <section className="flex-1 min-h-[36rem] overflow-auto border rounded">
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
                <th className="py-1 px-1 text-xs font-medium border-r bg-muted w-8" />
                <th className="py-1 px-1 text-xs font-medium border-r bg-muted w-28 text-center whitespace-nowrap">업데이트 날짜</th>
                <th className="py-1 px-1 text-xs font-medium border-r bg-muted w-36 text-center whitespace-nowrap">작업자</th>
                <th className="py-1 px-1 text-xs font-medium border-r bg-muted w-24 text-center whitespace-nowrap">레이어 수</th>
                <th className="py-1 px-1 text-xs font-medium border-r bg-muted w-20 text-center whitespace-nowrap">성공</th>
                <th className="py-1 px-1 text-xs font-medium border-r bg-muted w-20 text-center whitespace-nowrap">실패</th>
                <th className="py-1 px-2 text-xs font-medium bg-muted">업데이트 내용</th>
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
                      <td className="h-[28px] px-2 align-middle">
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </td>
                      <td className="h-[28px] px-2 align-middle text-center whitespace-nowrap">{row.lhCreateDate ?? '—'}</td>
                      <td className="h-[28px] px-2 align-middle text-center text-muted-foreground truncate max-w-[9rem]" title={row.lhCreateUser ?? ''}>{row.lhCreateUser ?? '—'}</td>
                      <td className="h-[28px] px-2 align-middle text-right">{layerCount}</td>
                      <td className="h-[28px] px-2 align-middle text-right text-green-600">{row.lhSuccessCount ?? 0}</td>
                      <td className="h-[28px] px-2 align-middle text-right text-red-500">{row.lhFailCount ?? 0}</td>
                      <td className="h-[28px] px-4 align-middle truncate max-w-[20rem]" title={row.lhContents ?? ''}>{row.lhContents ?? '—'}</td>
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
                              <div className="overflow-x-auto">
                              <table className="w-full table-fixed text-xs">
                                <thead>
                                  <tr className="text-left">
                                    <th className="py-1 px-1 text-xs font-medium border-r bg-muted w-14 text-center">결과</th>
                                    <th className="py-1 px-1 text-xs font-medium border-r bg-muted w-30">레이어 그룹</th>
                                    <th className="py-1 px-1 text-xs font-medium border-r bg-muted w-46">레이어 한글명</th>
                                    <th className="py-1 px-1 text-xs font-medium border-r bg-muted w-46">레이어 영문명</th>
                                    <th className="py-1 px-1 text-xs font-medium border-r bg-muted w-22 text-center whitespace-nowrap">구분</th>
                                    <th className="py-1 px-1 text-xs font-medium border-r bg-muted w-20 text-right" title="처리 전 DB 행 수">이전</th>
                                    <th className="py-1 px-1 text-xs font-medium border-r bg-muted w-20 text-right" title="처리 후 DB 행 수">현재</th>
                                    <th className="py-1 px-1 text-xs font-medium border-r bg-muted w-20 text-right text-emerald-700 dark:text-emerald-400" title="SHP 기준 추가 행">추가</th>
                                    <th className="py-1 px-1 text-xs font-medium border-r bg-muted w-20 text-right text-orange-600" title="속성 충돌(변경 필요)">변경</th>
                                    <th className="py-1 px-1 text-xs font-medium border-r bg-muted w-20 text-right text-red-500" title="삭제 대상">삭제</th>
                                    <th className="py-1 px-1 text-xs font-medium border-r bg-muted px-4">업데이트 내용</th>
                                    <th className="py-1 px-1 text-xs font-medium bg-muted w-24 text-center">액션</th>
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
                                      <td className="py-1 px-2 truncate" title={d.dhGroup ?? ''}>{d.dhGroup ?? '—'}</td>
                                      <td className="py-1 px-2 truncate" title={d.dhKorName ?? ''}>{d.dhKorName ?? '—'}</td>
                                      <td className="py-1 px-2 font-mono truncate" title={d.dhName ?? ''}>{d.dhName ?? '—'}</td>
                                      <td className="py-1 px-2 text-center truncate" title={d.dhType ?? ''}>{d.dhType ?? '—'}</td>
                                      <td className="py-1 px-2 text-right tabular-nums">{formatCount(d.dhOldData)}</td>
                                      <td className="py-1 px-2 text-right tabular-nums">{formatCount(d.dhNewData)}</td>
                                      <td className="py-1 px-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{formatCount(d.dhAppendCount)}</td>
                                      <td className="py-1 px-2 text-right tabular-nums text-orange-600">{formatCount(d.dhConflictCount)}</td>
                                      <td className="py-1 px-2 text-right tabular-nums text-red-500">{formatCount(d.dhRemoveCount)}</td>
                                      <td className="py-1 px-4 truncate" title={d.dhContents ?? ''}>
                                        {d.dhContents ?? '—'}
                                      </td>
                                      <td className="py-1 px-2 text-center">
                                        {showSyncBtn(d) && (
                                          <button
                                            type="button"
                                            className="inline-flex items-center gap-0.5 text-[10px] text-blue-600 hover:underline font-medium"
                                            onClick={(e) => { e.stopPropagation(); handleSyncClick(d); }}
                                          >
                                            <Search className="w-3 h-3" />
                                            이력 조회
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              </div>
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

      <div className="shrink-0 flex items-center justify-center gap-2 text-xs">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</Button>
        <span>{page} / {totalPages}</span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>다음</Button>
      </div>

      {syncModal && (
        <SyncDetailModal
          dhKey={syncModal.dhKey}
          tableName={syncModal.tableName}
          shpPath={syncModal.shpPath}
          readOnly
          onClose={handleModalClose}
        />
      )}
    </div>
  );
}

function formatCount(n: number | null | undefined): string {
  return n != null ? n.toLocaleString('ko-KR') : '—';
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
