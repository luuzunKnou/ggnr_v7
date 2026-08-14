'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layers, Search, X } from 'lucide-react';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  OCCUPATION_PERIOD_STATE_ENDED,
  OCCUPATION_PERIOD_STATE_IN_PROGRESS,
  deriveOccupationPeriodState,
} from '@/lib/occupationLedgerPeriodState';
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
        if (data?.error) {
          window.alert(String(data.error));
          return;
        }
        const ext = data?.extent3857 as unknown;
        if (!Array.isArray(ext) || ext.length !== 4) {
          window.alert('위치 정보를 찾을 수 없습니다.');
          return;
        }
        fitMapAfterDetailLayout(ext.map(Number));
      } catch {
        window.alert('지도 이동에 실패했습니다.');
      }
    },
    [onSelectDetailId, serEng, fitMapAfterDetailLayout, mapContext]
  );

  useEffect(() => {
    const pickRef = mapContext?.applyOccupationLedgerMapPickRef;
    if (!pickRef) return;
    pickRef.current = (pick) => {
      const rowKey = String(pick?.rowKey ?? '').trim();
      if (!rowKey) return;
      const opts = Array.isArray(pick?.overlapOptions) ? pick.overlapOptions : [];
      mapContext?.setOccupationLedgerMapHitOptions?.(opts.length > 1 ? opts : []);
      onSelectDetailId(rowKey);
      if (
        Array.isArray(pick?.extent3857) &&
        pick.extent3857.length === 4 &&
        pick.extent3857.every((v) => Number.isFinite(Number(v)))
      ) {
        fitMapAfterDetailLayout(pick.extent3857.map(Number));
      }
    };
    return () => {
      pickRef.current = null;
    };
  }, [mapContext, onSelectDetailId, fitMapAfterDetailLayout]);

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
    if (!statusFilter) return items;
    return items.filter((row) => row.status === statusFilter);
  }, [items, statusFilter]);

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
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
        <span className="text-sm font-semibold text-slate-800">{title}</span>
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
            className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="shrink-0 space-y-2 border-b border-slate-100 px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="검색 (점용명, 장소, 기간 등)"
            className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm outline-none ring-offset-2 focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
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
                    ? 'border-primary bg-primary/10 text-slate-800'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700'
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
          <div className="shrink-0 border-b border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
        <div ref={listScrollRef} className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          {loading ? (
            <div className="px-3 py-6 text-center text-xs text-slate-500">불러오는 중…</div>
          ) : filteredItems.length === 0 && !error ? (
            <div className="px-3 py-6 text-center text-xs text-slate-500">
              {items.length === 0
                ? '목록이 비어 있습니다. 데이터 적재 후 새로고침하세요.'
                : '선택한 상태에 해당하는 목록이 없습니다.'}
            </div>
          ) : (
            <table className="w-full min-w-[608px] table-fixed border-collapse text-left text-xs">
              <colgroup>
                <col className="w-[60px]" />
                <col className="w-[180px]" />
                <col className="w-[192px]" />
                <col className="w-[88px]" />
                <col className="w-[88px]" />
              </colgroup>
              <thead className="sticky top-0 z-[1] bg-slate-50 shadow-[0_1px_0_0_rgb(226_232_240)]">
                <tr>
                  <th className="whitespace-nowrap border-b border-slate-200 px-1.5 py-2 font-semibold text-slate-700">
                    상태
                  </th>
                  <th className="whitespace-nowrap border-b border-slate-200 px-2 py-2 font-semibold text-slate-700">
                    점용명
                  </th>
                  <th className="whitespace-nowrap border-b border-slate-200 px-2 py-2 font-semibold text-slate-700">
                    점용장소
                  </th>
                  <th className="whitespace-nowrap border-b border-slate-200 px-2 py-2 font-semibold text-slate-700">
                    점용시작일
                  </th>
                  <th className="whitespace-nowrap border-b border-slate-200 px-2 py-2 font-semibold text-slate-700">
                    점용종료일
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((row) => {
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
                        'cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50/80',
                        isSelected && 'bg-primary/10'
                      )}
                    >
                      <td className="px-1.5 py-1.5">
                        <span
                          className={cn(
                            'inline-block rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                            row.status === OCCUPATION_PERIOD_STATE_ENDED
                              ? 'bg-red-50 text-red-700'
                              : 'bg-emerald-50 text-emerald-700'
                          )}
                        >
                          {row.status || OCCUPATION_PERIOD_STATE_IN_PROGRESS}
                        </span>
                      </td>
                      <td className="max-w-0 truncate px-2 py-1.5 text-slate-800" title={row.name}>
                        {row.name || row.rowKey}
                      </td>
                      <td className="max-w-0 truncate px-2 py-1.5 text-slate-700" title={row.place}>
                        {row.place || '-'}
                      </td>
                      <td
                        className="max-w-0 truncate px-2 py-1.5 tabular-nums text-slate-700"
                        title={row.startDate}
                      >
                        {row.startDate || '-'}
                      </td>
                      <td
                        className="max-w-0 truncate px-2 py-1.5 tabular-nums text-slate-700"
                        title={row.endDate}
                      >
                        {row.endDate || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="shrink-0 border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
          {filteredItems.length.toLocaleString()}건
          {statusFilter ? ` / 전체 ${items.length.toLocaleString()}건` : ''}
        </div>
      </div>
    </div>
  );
}

export { LAYER_ROW_NEW_ID as OCCUPATION_LEDGER_NEW_ID };
