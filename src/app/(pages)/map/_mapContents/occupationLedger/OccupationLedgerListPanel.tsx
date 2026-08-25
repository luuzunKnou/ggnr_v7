'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Layers, Search, X } from 'lucide-react';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  OCCUPATION_PERIOD_STATE_ENDED,
  OCCUPATION_PERIOD_STATE_IN_PROGRESS,
  deriveOccupationPeriodState,
} from '@/lib/occupationLedgerPeriodState';
import {
  initialOccupationLedgerSortDir,
  sortOccupationLedgerListRows,
  type OccupationLedgerListSortKey,
  type OccupationLedgerListSortSpec,
} from '@/lib/occupationLedgerListSort';
import { getOccupationLedgerBinding } from './occupationLedgerBinding';
import { useMapContext } from '../../_mapComponents/MapContext';
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../_mapComponents/config/mapDefaults';
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation';
import { LAYER_ROW_NEW_ID, LayerRowAddButton, LayerRowPanelButton } from '../../_mapComponents/layerRowEdit';
import {
  clearOccupationLedgerWmsLayers,
  ensureOccupationLedgerWmsLayers,
} from './occupationLedgerMapSync';
import { isUseFeeWmsVisible, toggleUseFeeWmsLayer } from '../useFee/useFeeMapSync';
import { occupationLayerToggleActiveStyle } from '@/lib/occupationLayerStyle';

type ListRow = {
  rowKey: string;
  name: string;
  place: string;
  startDate: string;
  endDate: string;
  status: string;
};

const STATUS_FILTER_OPTIONS = [
  { value: '', label: '전체' },
  { value: OCCUPATION_PERIOD_STATE_IN_PROGRESS, label: OCCUPATION_PERIOD_STATE_IN_PROGRESS },
  { value: OCCUPATION_PERIOD_STATE_ENDED, label: OCCUPATION_PERIOD_STATE_ENDED },
] as const;

type SortKey = OccupationLedgerListSortKey;
type SortSpec = OccupationLedgerListSortSpec;

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'status', label: '상태' },
  { key: 'name', label: '점용명' },
  { key: 'place', label: '점용장소' },
  { key: 'startDate', label: '점용시작일' },
  { key: 'endDate', label: '점용종료일' },
];

const HEADER_ALIGN_LEFT = new Set<SortKey>(['name', 'place']);

type Props = {
  serEng: string;
  onClose: () => void;
  selectedDetailId: string | null;
  onSelectDetailId: (id: string) => void;
  refreshKey?: number;
  onAdd?: () => void;
};

export function OccupationLedgerListPanel({
  serEng,
  onClose,
  selectedDetailId,
  onSelectDetailId,
  refreshKey = 0,
  onAdd,
}: Props) {
  const mapContext = useMapContext();
  const mapContextRef = useRef(mapContext);
  mapContextRef.current = mapContext;
  const listScrollRef = useRef<HTMLDivElement | null>(null);

  const binding = getOccupationLedgerBinding({ serEng });
  const title = binding?.title ?? '점용대장';

  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sorts, setSorts] = useState<SortSpec[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ListRow[]>([]);

  useEffect(() => {
    ensureOccupationLedgerWmsLayers(mapContextRef.current?.setVisibleLayerNames, { serEng });
    return () => {
      clearOccupationLedgerWmsLayers(mapContextRef.current?.setVisibleLayerNames, { serEng });
    };
  }, [serEng]);

  const fitMapAfterDetailLayout = useCallback(
    (extent3857: number[]) => {
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;
      ensureOccupationLedgerWmsLayers(mapContext?.setVisibleLayerNames, { serEng });
      window.setTimeout(() => {
        scheduleFitMapToExtent3857(map, extent3857, {
          maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
          applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
        });
      }, 80);
    },
    [mapContext, serEng]
  );

  const handleRowClick = useCallback(
    async (rowKey: string) => {
      if (!rowKey) return;
      mapContext?.setOccupationLedgerMapHitOptions?.([]);
      onSelectDetailId(rowKey);
      if (rowKey === LAYER_ROW_NEW_ID) return;
      try {
        const res = await call('', 'POST', {
          service: 'occupationLedgerService',
          action: 'getOccupationLedgerExtent3857ByKey',
          params: { key: rowKey, serEng },
        });
        const data = res?.data ?? res;
        if (data?.error) return;
        const ext = data?.extent3857 as unknown;
        if (!Array.isArray(ext) || ext.length !== 4) return;
        fitMapAfterDetailLayout(ext.map(Number));
      } catch {
        /* 도형 없음·조회 실패 시 지도 이동만 생략 (상세는 이미 열림) */
      }
    },
    [onSelectDetailId, serEng, fitMapAfterDetailLayout, mapContext]
  );

  useEffect(() => {
    const pickRef = mapContext?.applyOccupationLedgerMapPickRef;
    if (!pickRef) return;
    pickRef.current = (pick) => {
      const rawKey = String(pick?.rowKey ?? '').trim();
      if (!rawKey) return;
      const opts = Array.isArray(pick?.overlapOptions) ? pick.overlapOptions : [];
      mapContext?.setOccupationLedgerMapHitOptions?.(opts.length > 1 ? opts : []);
      void (async () => {
        let rowKey = rawKey;
        try {
          const res = await call('', 'POST', {
            service: 'occupationLedgerService',
            action: 'resolveOccupationLedgerRowKey',
            params: { key: rawKey, serEng },
          });
          const data = res?.data ?? res;
          const resolved = String(data?.key ?? '').trim();
          if (resolved) rowKey = resolved;
        } catch {
          /* 해석 실패 시 원본 키로 상세 오픈 */
        }
        onSelectDetailId(rowKey);
        if (
          Array.isArray(pick?.extent3857) &&
          pick.extent3857.length === 4 &&
          pick.extent3857.every((v) => Number.isFinite(Number(v)))
        ) {
          fitMapAfterDetailLayout(pick.extent3857.map(Number));
        }
      })();
    };
    return () => {
      pickRef.current = null;
    };
  }, [mapContext, onSelectDetailId, fitMapAfterDetailLayout, serEng]);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await call('', 'POST', {
          service: 'occupationLedgerService',
          action: 'getOccupationLedgerList',
          params: { keyword: keyword.trim() || undefined, serEng },
        });
        const data = res?.data ?? res;
        if (data?.error) {
          setError(String(data.error));
          setItems([]);
          return;
        }
        const rows = Array.isArray(data?.rows) ? data.rows : [];
        setItems(
          rows.map((r: ListRow) => ({
            ...r,
            status:
              r.status ||
              deriveOccupationPeriodState(String(r.endDate ?? '')),
          }))
        );
      } catch {
        setError('목록을 불러오지 못했습니다.');
        setItems([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [keyword, refreshKey, serEng]);

  const filteredItems = useMemo(() => {
    const byStatus = statusFilter ? items.filter((row) => row.status === statusFilter) : items;
    return sortOccupationLedgerListRows(byStatus, sorts);
  }, [items, statusFilter, sorts]);

  const toggleSort = (key: SortKey) => {
    const initial = initialOccupationLedgerSortDir(key);
    setSorts((prev) => {
      const idx = prev.findIndex((s) => s.key === key);
      if (idx < 0) return [...prev, { key, dir: initial }];
      const cur = prev[idx];
      if (cur.dir === initial) {
        const next = [...prev];
        next[idx] = { key, dir: initial === 'asc' ? 'desc' : 'asc' };
        return next;
      }
      return prev.filter((_, i) => i !== idx);
    });
  };

  useEffect(() => {
    if (!selectedDetailId || selectedDetailId === LAYER_ROW_NEW_ID) return;
    const scroller = listScrollRef.current;
    if (!scroller) return;
    const el = scroller.querySelector(
      `[data-occupation-ledger-row="${CSS.escape(selectedDetailId)}"]`
    );
    if (!(el instanceof HTMLElement)) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const delta =
      elRect.top + elRect.height / 2 - (scrollerRect.top + scrollerRect.height / 2);
    if (Math.abs(delta) < 4) return;
    scroller.scrollBy({ top: delta, behavior: 'smooth' });
  }, [selectedDetailId, filteredItems]);

  const useFeeSystem =
    serEng === 'roadOccupationLedger'
      ? 'road'
      : serEng === 'publicOccupationLedger'
        ? 'build'
        : 'river';
  const useFeeLayerOn = isUseFeeWmsVisible(mapContext?.visibleLayerNames, useFeeSystem);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <div className="flex items-center gap-1">
          <LayerRowPanelButton
            type="button"
            title={useFeeLayerOn ? '점사용료 레이어 끄기' : '점사용료 레이어 켜기'}
            aria-label={useFeeLayerOn ? '점사용료 레이어 끄기' : '점사용료 레이어 켜기'}
            aria-pressed={useFeeLayerOn}
            onClick={() =>
              toggleUseFeeWmsLayer(mapContext?.setVisibleLayerNames, useFeeSystem)
            }
            style={useFeeLayerOn ? occupationLayerToggleActiveStyle('useFee') : undefined}
            className={useFeeLayerOn ? 'hover:opacity-90' : undefined}
          >
            <Layers className="h-3 w-3 shrink-0" aria-hidden />
            점사용료
          </LayerRowPanelButton>
          <LayerRowAddButton
            onClick={() => {
              if (onAdd) onAdd();
              else onSelectDetailId(LAYER_ROW_NEW_ID);
            }}
            disabled={selectedDetailId === LAYER_ROW_NEW_ID}
          />
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="shrink-0 space-y-2 border-b border-border px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="검색 (점용명, 장소, 기간 등)"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none ring-offset-2 focus:border-border focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTER_OPTIONS.map((opt) => {
            const active = statusFilter === opt.value;
            return (
              <button
                key={opt.value || '__all__'}
                type="button"
                onClick={() => setStatusFilter(opt.value)}
                className={cn(
                  'rounded border px-2 py-1 text-[11px] font-medium transition-colors',
                  active
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border bg-background text-muted-foreground hover:border-border hover:text-foreground'
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error && (
          <div className="shrink-0 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <div ref={listScrollRef} className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          <table className="w-full min-w-[596px] table-fixed border-collapse text-left text-xs">
            <colgroup>
              <col className="w-[60px]" />
              <col className="w-[180px]" />
              <col className="w-[180px]" />
              <col className="w-[88px]" />
              <col className="w-[88px]" />
            </colgroup>
            <thead className="sticky top-0 z-[1] bg-muted shadow-[0_1px_0_0_var(--border)]">
              <tr>
                {SORT_COLUMNS.map((col) => {
                  const sortIdx = sorts.findIndex((s) => s.key === col.key);
                  const active = sortIdx >= 0;
                  const sortDir = active ? sorts[sortIdx].dir : null;
                  const Icon = !active
                    ? ArrowUpDown
                    : sortDir === 'asc'
                      ? ArrowUp
                      : ArrowDown;
                  const initial = initialOccupationLedgerSortDir(col.key);
                  const alignLeft = HEADER_ALIGN_LEFT.has(col.key);
                  return (
                    <th
                      key={col.key}
                      className={cn(
                        'whitespace-nowrap border-b border-border px-1.5 py-1.5 font-semibold text-foreground/90',
                        alignLeft ? 'text-left' : 'text-center'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          'inline-flex max-w-full items-center gap-0.5 rounded px-0.5 py-0.5 transition-colors hover:bg-muted',
                          alignLeft ? 'justify-start' : 'justify-center',
                          active ? 'text-primary' : 'text-foreground/90'
                        )}
                        title={
                          !active
                            ? `${col.label} 정렬 추가`
                            : sortDir === initial
                              ? `${col.label} 방향 바꾸기`
                              : `${col.label} 정렬 해제`
                        }
                      >
                        <span className="truncate">{col.label}</span>
                        <Icon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={SORT_COLUMNS.length}
                    className="px-3 py-6 text-center text-xs text-muted-foreground"
                  >
                    불러오는 중…
                  </td>
                </tr>
              ) : filteredItems.length === 0 && !error ? (
                <tr>
                  <td
                    colSpan={SORT_COLUMNS.length}
                    className="px-3 py-6 text-center text-xs text-muted-foreground"
                  >
                    {items.length === 0
                      ? '목록이 비어 있습니다. 데이터 적재 후 새로고침하세요.'
                      : '선택한 상태에 해당하는 목록이 없습니다.'}
                  </td>
                </tr>
              ) : (
                filteredItems.map((row) => {
                  const isSelected = selectedDetailId === row.rowKey;
                  return (
                    <tr
                      key={row.rowKey}
                      data-occupation-ledger-row={row.rowKey}
                      role="button"
                      tabIndex={0}
                      onClick={() => void handleRowClick(row.rowKey)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          void handleRowClick(row.rowKey);
                        }
                      }}
                      className={cn(
                        'cursor-pointer border-b border-border transition-colors hover:bg-muted/50',
                        isSelected && 'bg-primary/10'
                      )}
                    >
                      <td className="px-1.5 py-1.5">
                        <span
                          className={cn(
                            'inline-block rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                            row.status === OCCUPATION_PERIOD_STATE_ENDED
                              ? 'bg-destructive/10 text-destructive'
                              : 'bg-primary/10 text-primary'
                          )}
                        >
                          {row.status || OCCUPATION_PERIOD_STATE_IN_PROGRESS}
                        </span>
                      </td>
                      <td className="max-w-0 truncate px-2 py-1.5 text-foreground" title={row.name}>
                        {row.name || '-'}
                      </td>
                      <td className="max-w-0 truncate px-2 py-1.5 text-foreground/90" title={row.place}>
                        {row.place || '-'}
                      </td>
                      <td
                        className="max-w-0 truncate px-2 py-1.5 tabular-nums text-foreground/90"
                        title={row.startDate}
                      >
                        {row.startDate || '-'}
                      </td>
                      <td
                        className="max-w-0 truncate px-2 py-1.5 tabular-nums text-foreground/90"
                        title={row.endDate}
                      >
                        {row.endDate || '-'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          {filteredItems.length.toLocaleString()}건
          {statusFilter ? ` / 전체 ${items.length.toLocaleString()}건` : ''}
        </div>
      </div>
    </div>
  );
}

export { LAYER_ROW_NEW_ID as OCCUPATION_LEDGER_NEW_ID };
