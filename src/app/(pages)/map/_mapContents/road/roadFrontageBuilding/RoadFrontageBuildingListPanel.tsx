'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Layers, Search, X } from 'lucide-react';
import { call } from '@/lib/api';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';
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
  ROAD_FRONTAGE_BUILDING_NEW_ID,
  isNewRoadFrontageBuildingId,
  type RoadFrontageBuildingLedger,
} from './roadFrontageBuildingMock';
import { useRoadFrontageBuildingMapHighlight } from './useRoadFrontageBuildingMapHighlight';
import {
  isRoadNetworkWmsVisible,
  toggleRoadNetworkWmsLayers,
} from '../roadNetwork/roadNetworkMapSync';
import { getRoadFrontageMarkerRoadTypeBadgeStyle } from '../roadFrontageMarker/roadFrontageMarkerFormat';

type SortKey = 'roadType' | 'locAdr' | 'preYmd';
type SortDir = 'asc' | 'desc';
type SortSpec = { key: SortKey; dir: SortDir };

const SORT_COLUMNS: { key: SortKey; label: string; align?: 'left' | 'center' }[] = [
  { key: 'roadType', label: '종류' },
  { key: 'locAdr', label: '위치' },
  { key: 'preYmd', label: '작성연월일' },
];

function initialSortDir(_key: SortKey): SortDir {
  return 'asc';
}

/** 종류 열 — 도로종류-노선번호 */
function formatRoadTypeRouteLabel(roadType: string, routeNo: string): string {
  const type = roadType.trim();
  const route = routeNo.trim();
  if (!type && !route) return '—';
  if (type && route) return `${type}-${route}`;
  return type || route;
}

type Props = {
  selectedId: string | null;
  onSelectId: (id: string) => void;
  onAdd?: () => void;
  onClose: () => void;
  refreshKey?: number;
};

function hasMapPoint(ledger: RoadFrontageBuildingLedger): boolean {
  const lon = Number(ledger.mockLonLat?.lon);
  const lat = Number(ledger.mockLonLat?.lat);
  return Number.isFinite(lon) && Number.isFinite(lat) && !(lon === 0 && lat === 0);
}

export function RoadFrontageBuildingListPanel({
  selectedId,
  onSelectId,
  onAdd,
  onClose,
  refreshKey = 0,
}: Props) {
  const mapContext = useMapContext();
  const mapContextRef = useRef(mapContext);
  mapContextRef.current = mapContext;
  const { highlightLedger, clearHighlight } = useRoadFrontageBuildingMapHighlight();
  const [keyword, setKeyword] = useState('');
  const [sorts, setSorts] = useState<SortSpec[]>([]);
  const [items, setItems] = useState<RoadFrontageBuildingLedger[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ensureRoadFrontageWmsLayers(mapContextRef.current?.setVisibleLayerNames, 'building');
    return () => {
      clearRoadFrontageWmsLayers(mapContextRef.current?.setVisibleLayerNames, 'building');
    };
  }, []);

  const fitMapAfterDetailLayout = useCallback(
    (extent3857: number[]) => {
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;
      ensureRoadFrontageWmsLayers(mapContext?.setVisibleLayerNames, 'building');
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
    const pickRef = mapContext?.applyRoadFrontageBuildingMapPickRef;
    if (!pickRef) return;
    pickRef.current = (pick) => {
      const ftrIdn = String(pick?.ftrIdn ?? '').trim();
      if (!ftrIdn) return;
      const opts = Array.isArray(pick?.overlapOptions) ? pick.overlapOptions : [];
      mapContext?.setRoadFrontageBuildingMapHitOptions?.(opts.length > 1 ? opts : []);
      onSelectId(ftrIdn);
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
          service: 'roadFrontageBuildingService',
          action: 'list',
          params: {
            keyword,
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
  }, [keyword, refreshKey, sorts]);

  /** 목록만 열린 상태 — 레이어 전체 범위로 지도 이동 */
  useEffect(() => {
    if (loading) return;
    const key = String(selectedId ?? '').trim();
    if (key && !isNewRoadFrontageBuildingId(key)) return;
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;
    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'roadFrontageBuildingService',
          action: 'getListExtent3857',
          params: { keyword },
        });
        const data = res?.data ?? res;
        const ext = data?.extent3857 as unknown;
        if (Array.isArray(ext) && ext.length === 4) {
          fitMapAfterDetailLayout(ext.map(Number));
        }
      } catch {
        /* 위치 없으면 이동 생략 */
      }
    })();
  }, [loading, keyword, refreshKey, selectedId, mapContext, fitMapAfterDetailLayout]);

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

  const handleClose = useCallback(() => {
    clearHighlight();
    onClose();
  }, [clearHighlight, onClose]);

  const handleSelect = async (ledger: RoadFrontageBuildingLedger) => {
    const key = String(ledger.ftrIdn || ledger.id || '').trim();
    if (!key) return;
    mapContext?.setRoadFrontageBuildingMapHitOptions?.([]);
    onSelectId(key);
    highlightLedger(ledger, { fit: false });
    try {
      const res = await call('', 'POST', {
        service: 'roadFrontageBuildingService',
        action: 'getExtent3857ByKey',
        params: { ftrIdn: key },
      });
      const data = res?.data ?? res;
      const ext = data?.extent3857 as unknown;
      if (Array.isArray(ext) && ext.length === 4) {
        fitMapAfterDetailLayout(ext.map(Number));
      }
    } catch {
      /* 도형 없으면 지도 이동 생략 */
    }
  };

  useEffect(() => {
    const key = String(selectedId ?? '').trim();
    if (!key || isNewRoadFrontageBuildingId(key)) {
      clearHighlight();
      return;
    }
    const ledger = items.find((l) => String(l.ftrIdn || l.id || '').trim() === key);
    if (ledger && hasMapPoint(ledger)) {
      highlightLedger(ledger, { fit: false });
    }
  }, [selectedId, items, highlightLedger, clearHighlight]);

  useEffect(() => {
    const key = String(selectedId ?? '').trim();
    if (!key || isNewRoadFrontageBuildingId(key)) return;
    const scroller = listScrollRef.current;
    if (!scroller) return;
    const el = scroller.querySelector(`[data-road-frontage-building-row="${CSS.escape(key)}"]`);
    if (!(el instanceof HTMLElement)) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const delta =
      elRect.top + elRect.height / 2 - (scrollerRect.top + scrollerRect.height / 2);
    if (Math.abs(delta) < 4) return;
    scroller.scrollBy({ top: delta, behavior: 'smooth' });
  }, [selectedId, items]);

  const roadNetworkLayerOn = isRoadNetworkWmsVisible(mapContext?.visibleLayerNames);

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title">접도구역 건축물</span>
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
              else onSelectId(ROAD_FRONTAGE_BUILDING_NEW_ID);
            }}
            disabled={selectedId === ROAD_FRONTAGE_BUILDING_NEW_ID}
          />
          <button
            type="button"
            onClick={handleClose}
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
            placeholder="검색 (도로종류, 위치, 노선번호 등)"
            className="standard-search-input"
          />
        </div>
      </div>

      <div className="standard-list-body">
        {error ? (
          <div className="shrink-0 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}
        <div ref={listScrollRef} className="standard-list-scroll">
          <table className="standard-list-table min-w-[360px] w-full table-fixed">
            <colgroup>
              <col className="w-[88px]" />
              <col />
              <col className="w-[88px]" />
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
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={3} className="standard-table-empty">
                    불러오는 중…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={3} className="standard-table-empty">
                    등록된 관리대장이 없습니다.
                  </td>
                </tr>
              ) : (
                items.map((l) => {
                  const rowKey = String(l.ftrIdn || l.id || '').trim();
                  const isSelected = rowKey === selectedId;
                  const roadTypeRouteLabel = formatRoadTypeRouteLabel(l.roadType, l.routeNo);
                  const locDisplay =
                    formatAddressStripSidoSigungu(l.locAdr) || l.locAdr || '(위치 미입력)';
                  return (
                    <tr
                      key={rowKey || l.id}
                      data-road-frontage-building-row={rowKey}
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
                        {roadTypeRouteLabel !== '—' ? (
                          <span
                            className="standard-road-rank-badge inline-block max-w-full truncate"
                            style={getRoadFrontageMarkerRoadTypeBadgeStyle(l.roadType)}
                            title={roadTypeRouteLabel}
                          >
                            {roadTypeRouteLabel}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="standard-table-td-text" title={l.locAdr}>
                        {locDisplay}
                      </td>
                      <td className="standard-table-td-date" title={l.preYmd}>
                        {l.preYmd || '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="standard-list-footer">{items.length.toLocaleString()}건</div>
      </div>
    </div>
  );
}
