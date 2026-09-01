'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Layers, Search, X } from 'lucide-react';
import { call } from '@/lib/api';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';
import { cn } from '@/lib/utils';
import { LayerRowAddButton, LayerRowPanelButton } from '../../../_mapComponents/layerRowEdit';
import { useMapContext } from '../../../_mapComponents/MapContext';
import {
  isRoadNetworkWmsVisible,
  toggleRoadNetworkWmsLayers,
} from '../roadNetwork/roadNetworkMapSync';
import {
  ROAD_FRONTAGE_BUILDING_NEW_ID,
  ROAD_FRONTAGE_BUILDING_ROAD_TYPES,
  formatRouteNoName,
  isNewRoadFrontageBuildingId,
  roadFrontageBuildingRoadTypeBadgeClass,
  type RoadFrontageBuildingLedger,
} from './roadFrontageBuildingMock';
import {
  initialRoadFrontageBuildingSortDir,
  sortRoadFrontageBuildingListRows,
  type RoadFrontageBuildingListSortKey,
  type RoadFrontageBuildingListSortSpec,
} from './roadFrontageBuildingListSort';
import { useRoadFrontageBuildingMapHighlight } from './useRoadFrontageBuildingMapHighlight';

type Props = {
  selectedId: string | null;
  onSelectId: (id: string) => void;
  onAdd?: () => void;
  onClose: () => void;
  refreshKey?: number;
};

const SORT_COLUMNS: { key: RoadFrontageBuildingListSortKey; label: string }[] = [
  { key: 'roadType', label: '도로의 종류' },
  { key: 'locAdr', label: '위치' },
  { key: 'routeNo', label: '노선번호' },
  { key: 'preYmd', label: '작성연월일' },
];

const HEADER_ALIGN_LEFT = new Set<RoadFrontageBuildingListSortKey>(['locAdr']);

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
  const { highlightLedger, clearHighlight } = useRoadFrontageBuildingMapHighlight();
  const [keyword, setKeyword] = useState('');
  const [roadTypeFilter, setRoadTypeFilter] = useState('');
  const [sorts, setSorts] = useState<RoadFrontageBuildingListSortSpec[]>([]);
  const [items, setItems] = useState<RoadFrontageBuildingLedger[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await call('', 'POST', {
          service: 'roadFrontageBuildingService',
          action: 'list',
          params: { keyword },
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
  }, [keyword, refreshKey]);

  const filteredItems = useMemo(() => {
    const byRoadType = roadTypeFilter
      ? items.filter((l) => l.roadType.trim() === roadTypeFilter)
      : items;
    return sortRoadFrontageBuildingListRows(byRoadType, sorts);
  }, [items, roadTypeFilter, sorts]);

  const toggleSort = (key: RoadFrontageBuildingListSortKey) => {
    const initial = initialRoadFrontageBuildingSortDir(key);
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

  const handleSelect = (ledger: RoadFrontageBuildingLedger) => {
    const key = String(ledger.ftrIdn || ledger.id || '').trim();
    if (!key) return;
    onSelectId(key);
    highlightLedger(ledger, { fit: true });
  };

  useEffect(() => {
    const key = String(selectedId ?? '').trim();
    if (!key || isNewRoadFrontageBuildingId(key)) {
      clearHighlight();
      return;
    }
    const ledger = filteredItems.find((l) => String(l.ftrIdn || l.id || '').trim() === key);
    if (ledger && hasMapPoint(ledger)) {
      highlightLedger(ledger, { fit: false });
    }
  }, [selectedId, filteredItems, highlightLedger, clearHighlight]);

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
  }, [selectedId, filteredItems]);

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
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setRoadTypeFilter('')}
            className={cn(
              'rounded border px-2 py-1 text-[11px] font-medium transition-colors',
              !roadTypeFilter
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border bg-background text-muted-foreground hover:border-border hover:text-foreground'
            )}
          >
            전체
          </button>
          {ROAD_FRONTAGE_BUILDING_ROAD_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setRoadTypeFilter(t)}
              className={cn(
                'rounded border px-2 py-1 text-[11px] font-medium transition-colors',
                roadTypeFilter === t
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-background text-muted-foreground hover:border-border hover:text-foreground'
              )}
            >
              {t}
            </button>
          ))}
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
              <col className="w-[5.75rem]" />
              <col />
              <col className="w-[4.25rem]" />
              <col className="w-[5.75rem]" />
            </colgroup>
            <thead className="standard-table-thead">
              <tr>
                {SORT_COLUMNS.map((col) => {
                  const sortIdx = sorts.findIndex((s) => s.key === col.key);
                  const active = sortIdx >= 0;
                  const sortDir = active ? sorts[sortIdx].dir : null;
                  const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
                  const initial = initialRoadFrontageBuildingSortDir(col.key);
                  const alignLeft = HEADER_ALIGN_LEFT.has(col.key);
                  return (
                    <th
                      key={col.key}
                      className={cn(
                        'standard-table-th',
                        alignLeft ? 'standard-table-th-left' : 'standard-table-th-center'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          'standard-sort-button',
                          alignLeft ? 'standard-sort-button-left' : 'standard-sort-button-center',
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
              {loading && filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={4} className="standard-table-empty">
                    불러오는 중…
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={4} className="standard-table-empty">
                    {items.length === 0
                      ? '등록된 관리대장이 없습니다.'
                      : '선택한 도로 종류에 해당하는 목록이 없습니다.'}
                  </td>
                </tr>
              ) : (
                filteredItems.map((l) => {
                  const rowKey = String(l.ftrIdn || l.id || '').trim();
                  const isSelected = rowKey === selectedId;
                  const routeTitle = formatRouteNoName(l.routeNo, l.routeNam);
                  const roadTypeLabel = l.roadType.trim();
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
                      <td className="standard-table-td-compact text-center">
                        {roadTypeLabel ? (
                          <span
                            className={cn(
                              'inline-flex min-w-[3.25rem] items-center justify-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none',
                              roadFrontageBuildingRoadTypeBadgeClass(roadTypeLabel)
                            )}
                            title={roadTypeLabel}
                          >
                            {roadTypeLabel}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="standard-table-td-text" title={l.locAdr}>
                        {formatAddressStripSidoSigungu(l.locAdr) ||
                          l.locAdr ||
                          '(위치 미입력)'}
                      </td>
                      <td
                        className="standard-table-td-date text-center"
                        title={routeTitle !== '—' ? routeTitle : undefined}
                      >
                        {l.routeNo.trim() || '—'}
                      </td>
                      <td className="standard-table-td-date text-center" title={l.preYmd}>
                        {l.preYmd || '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="standard-list-footer">
          {filteredItems.length.toLocaleString()}건
          {roadTypeFilter ? ` / 전체 ${items.length.toLocaleString()}건` : ''}
        </div>
      </div>
    </div>
  );
}
