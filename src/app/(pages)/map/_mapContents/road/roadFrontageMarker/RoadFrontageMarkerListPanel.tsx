'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Layers, Search, X } from 'lucide-react';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { LayerRowAddButton, LayerRowPanelButton } from '../../../_mapComponents/layerRowEdit';
import { useMapContext } from '../../../_mapComponents/MapContext';
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../../_mapComponents/config/mapDefaults';
import { scheduleFitMapToExtent3857 } from '../../../_mapComponents/config/mapAutoNavigation';
import {
  ensureRoadFrontageWmsLayers,
  clearRoadFrontageWmsLayers,
} from '../roadFrontage/roadFrontageMapSync';
import {
  isRoadNetworkWmsVisible,
  toggleRoadNetworkWmsLayers,
} from '../roadNetwork/roadNetworkMapSync';
import {
  ROAD_FRONTAGE_MARKER_NEW_ID,
  ROAD_FRONTAGE_MARKER_ROAD_TYPES,
  isNewRoadFrontageMarkerId,
  type RoadFrontageMarkerItem,
  type RoadFrontageMarkerLedger,
} from './roadFrontageMarkerMock';
import { getRoadFrontageMarkerRoadTypeBadgeClass } from './roadFrontageMarkerFormat';
import { fitMapToMarkerPoints, useRoadFrontageMarkerMapHighlight } from './useRoadFrontageMarkerMapHighlight';

type SortKey = 'roadType' | 'routeName';
type SortDir = 'asc' | 'desc';
type SortSpec = { key: SortKey; dir: SortDir };

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'roadType', label: '종류' },
  { key: 'routeName', label: '노선명' },
];

function initialSortDir(_key: SortKey): SortDir {
  return 'asc';
}

function markerCountOf(ledger: RoadFrontageMarkerLedger): number {
  return ledger.markers?.length ?? 0;
}

type Props = {
  selectedId: string | null;
  onSelectId: (id: string) => void;
  onAdd?: () => void;
  onClose: () => void;
  refreshKey?: number;
};

export function RoadFrontageMarkerListPanel({
  selectedId,
  onSelectId,
  onAdd,
  onClose,
  refreshKey = 0,
}: Props) {
  const mapContext = useMapContext();
  const mapContextRef = useRef(mapContext);
  mapContextRef.current = mapContext;
  const [keyword, setKeyword] = useState('');
  const [roadTypeFilter, setRoadTypeFilter] = useState('');
  const [sorts, setSorts] = useState<SortSpec[]>([]);
  const [items, setItems] = useState<RoadFrontageMarkerLedger[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ensureRoadFrontageWmsLayers(mapContextRef.current?.setVisibleLayerNames, 'marker');
    return () => {
      clearRoadFrontageWmsLayers(mapContextRef.current?.setVisibleLayerNames, 'marker');
    };
  }, []);

  const fitMapAfterDetailLayout = useCallback(
    (extent3857: number[]) => {
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;
      ensureRoadFrontageWmsLayers(mapContext?.setVisibleLayerNames, 'marker');
      window.setTimeout(() => {
        scheduleFitMapToExtent3857(map, extent3857, {
          maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
          applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
        });
      }, 80);
    },
    [mapContext]
  );

  useEffect(() => {
    const pickRef = mapContext?.applyRoadFrontageMarkerMapPickRef;
    if (!pickRef) return;
    pickRef.current = (pick) => {
      const ledgerId = String(pick?.ledgerId ?? '').trim();
      const markerItemId = String(pick?.markerItemId ?? '').trim();
      if (!ledgerId || !markerItemId) return;
      const opts = Array.isArray(pick?.overlapOptions) ? pick.overlapOptions : [];
      mapContext?.setRoadFrontageMarkerMapHitOptions?.(opts.length > 1 ? opts : []);
      mapContext?.setRoadFrontageMarkerPendingItemPick?.({ ledgerId, markerItemId });
      onSelectId(ledgerId);
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
  }, [mapContext, onSelectId, fitMapAfterDetailLayout]);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await call('', 'POST', {
          service: 'roadFrontageMarkerService',
          action: 'list',
          params: {
            keyword,
            roadType: roadTypeFilter || undefined,
            sorts: sorts.length > 0 ? sorts : undefined,
          },
        });
        if (res?.success === false) {
          setItems([]);
          setError(String(res.error ?? '목록을 불러오지 못했습니다.'));
          return;
        }
        const data = res?.data ?? res;
        setItems(Array.isArray(data) ? data : []);
      } catch (e: unknown) {
        setItems([]);
        const msg =
          e instanceof Error && e.message.trim()
            ? e.message
            : typeof e === 'object' && e && 'error' in e && typeof (e as { error?: unknown }).error === 'string'
              ? String((e as { error: string }).error)
              : '목록을 불러오지 못했습니다.';
        setError(msg);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [keyword, roadTypeFilter, refreshKey, sorts]);

  const filtered = useMemo(() => items.filter((l) => !isNewRoadFrontageMarkerId(l.id)), [items]);

  /** 목록에 보이는 노선의 표주 점 전부 */
  const listMarkers = useMemo((): RoadFrontageMarkerItem[] => {
    const out: RoadFrontageMarkerItem[] = [];
    for (const ledger of filtered) {
      for (const m of ledger.markers ?? []) out.push(m);
    }
    return out;
  }, [filtered]);

  const mapReady = mapContext?.mapReady ?? false;
  const map = mapReady ? (mapContext?.mapInstanceRef?.current ?? null) : null;
  const detailOpen = Boolean(selectedId) && !isNewRoadFrontageMarkerId(String(selectedId ?? ''));

  /** 목록·상세 모두 WMS로 표시 — 벡터 오버레이는 상세 패널이 담당 */
  useRoadFrontageMarkerMapHighlight(map, listMarkers, null, {
    removeOnUnmount: true,
    enabled: false,
  });

  useEffect(() => {
    if (loading || detailOpen || !map || listMarkers.length === 0) return;
    fitMapToMarkerPoints(map, listMarkers);
  }, [loading, detailOpen, map, listMarkers]);

  const toggleSort = (key: SortKey) => {
    const initial = initialSortDir(key);
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

  const handleSelect = async (ledger: RoadFrontageMarkerLedger) => {
    mapContext?.setRoadFrontageMarkerMapHitOptions?.([]);
    onSelectId(ledger.id);
    try {
      const res = await call('', 'POST', {
        service: 'roadFrontageMarkerService',
        action: 'getExtent3857ByLedgerId',
        params: { id: ledger.id },
      });
      const data = res?.data ?? res;
      const ext = data?.extent3857 as unknown;
      if (Array.isArray(ext) && ext.length === 4) {
        fitMapAfterDetailLayout(ext.map(Number));
        return;
      }
    } catch {
      /* fallback */
    }
    const olMap = mapContext?.mapReady
      ? (mapContext.mapInstanceRef?.current ?? null)
      : null;
    fitMapToMarkerPoints(olMap, ledger.markers);
  };

  useEffect(() => {
    const key = String(selectedId ?? '').trim();
    if (!key || isNewRoadFrontageMarkerId(key)) return;
    const scroller = listScrollRef.current;
    if (!scroller) return;
    const el = scroller.querySelector(`[data-road-frontage-marker-row="${CSS.escape(key)}"]`);
    if (!(el instanceof HTMLElement)) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const delta =
      elRect.top + elRect.height / 2 - (scrollerRect.top + scrollerRect.height / 2);
    if (Math.abs(delta) < 4) return;
    scroller.scrollBy({ top: delta, behavior: 'smooth' });
  }, [selectedId, filtered]);

  const roadNetworkLayerOn = isRoadNetworkWmsVisible(mapContext?.visibleLayerNames);

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title">접도구역 표주</span>
        <div className="flex items-center gap-1">
          <LayerRowPanelButton
            type="button"
            title={roadNetworkLayerOn ? '도로망도 레이어 끄기' : '도로망도 레이어 켜기'}
            aria-label={roadNetworkLayerOn ? '도로망도 레이어 끄기' : '도로망도 레이어 켜기'}
            aria-pressed={roadNetworkLayerOn}
            onClick={() => toggleRoadNetworkWmsLayers(mapContext?.setVisibleLayerNames)}
            className={cn(
              'standard-layer-toggle-chip',
              roadNetworkLayerOn
                ? 'standard-layer-toggle-chip-active'
                : 'standard-layer-toggle-chip-inactive'
            )}
          >
            <Layers className="h-3 w-3 shrink-0" aria-hidden />
            도로망도
          </LayerRowPanelButton>
          <LayerRowAddButton
            onClick={() => {
              if (onAdd) onAdd();
              else onSelectId(ROAD_FRONTAGE_MARKER_NEW_ID);
            }}
            disabled={selectedId === ROAD_FRONTAGE_MARKER_NEW_ID}
          />
          <button
            type="button"
            onClick={onClose}
            className="standard-panel-close"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="standard-filter-section">
        <div className="standard-search-wrap">
          <Search className="standard-search-icon" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="노선명·소유자·지번"
            className="standard-search-input"
          />
        </div>
        <div className="standard-filter-chips">
          {[{ value: '', label: '전체' }, ...ROAD_FRONTAGE_MARKER_ROAD_TYPES.map((t) => ({ value: t, label: t }))].map(
            (opt) => {
              const active = roadTypeFilter === opt.value;
              return (
                <button
                  key={opt.value || '__all__'}
                  type="button"
                  onClick={() => setRoadTypeFilter(opt.value)}
                  className={cn('standard-filter-chip', active && 'standard-filter-chip-active')}
                >
                  {opt.label}
                </button>
              );
            }
          )}
        </div>
      </div>

      <div className="standard-list-body">
        {error ? (
          <div className="shrink-0 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}
        <div ref={listScrollRef} className="standard-list-scroll">
          <table className="standard-list-table min-w-0 w-full table-fixed">
            <colgroup>
              <col className="w-[88px]" />
              <col />
              <col className="w-[72px]" />
            </colgroup>
            <thead className="standard-table-thead">
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
                  const initial = initialSortDir(col.key);
                  return (
                    <th key={col.key} className="standard-table-th standard-table-th-left">
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          'standard-sort-button standard-sort-button-left',
                          active && 'standard-sort-button-active'
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
                <th className="standard-table-th standard-table-th-center" aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {loading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={3} className="standard-table-empty">
                    불러오는 중…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={3} className="standard-table-empty">
                    {items.length === 0 ? '등록된 관리대장이 없습니다.' : '검색 결과가 없습니다.'}
                  </td>
                </tr>
              ) : (
                filtered.map((l) => {
                  const isSelected = l.id === selectedId;
                  const roadTypeLabel = l.roadType?.trim() || '—';
                  const markerCount = markerCountOf(l);
                  return (
                    <tr
                      key={l.id}
                      data-road-frontage-marker-row={l.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelect(l)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelect(l);
                        }
                      }}
                      className={cn('standard-list-row', isSelected && 'standard-list-row-selected')}
                    >
                      <td className="standard-table-td-compact">
                        {l.roadType?.trim() ? (
                          <span className={getRoadFrontageMarkerRoadTypeBadgeClass(l.roadType)}>
                            {roadTypeLabel}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="standard-table-td-text" title={l.routeName || undefined}>
                        {l.routeName || '(노선명 미입력)'}
                      </td>
                      <td className="standard-table-td-date text-right">
                        {markerCount.toLocaleString()}건
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="standard-list-footer">
          {filtered.length.toLocaleString()}건
          {roadTypeFilter || keyword.trim()
            ? ` / 전체 ${items.length.toLocaleString()}건`
            : ''}
        </div>
      </div>
    </div>
  );
}
