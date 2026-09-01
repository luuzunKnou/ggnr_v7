'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Layers, Search, X } from 'lucide-react';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { LayerRowAddButton, LayerRowPanelButton } from '../../../_mapComponents/layerRowEdit';
import { useMapContext } from '../../../_mapComponents/MapContext';
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
import { fitMapToMarkerPoints, useRoadFrontageMarkerMapHighlight } from './useRoadFrontageMarkerMapHighlight';

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
  const [keyword, setKeyword] = useState('');
  const [roadTypeFilter, setRoadTypeFilter] = useState('');
  const [items, setItems] = useState<RoadFrontageMarkerLedger[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await call('', 'POST', {
          service: 'roadFrontageMarkerService',
          action: 'list',
          params: { keyword, roadType: roadTypeFilter || undefined },
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
  }, [keyword, roadTypeFilter, refreshKey]);

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

  /** 상세가 열려 있으면 상세가 레이어를 갱신. 목록만 있을 때 전체 점 표시 */
  useRoadFrontageMarkerMapHighlight(map, listMarkers, null, {
    removeOnUnmount: true,
    enabled: !detailOpen,
  });

  useEffect(() => {
    if (loading || detailOpen || !map || listMarkers.length === 0) return;
    fitMapToMarkerPoints(map, listMarkers);
  }, [loading, detailOpen, map, listMarkers]);

  const handleSelect = (ledger: RoadFrontageMarkerLedger) => {
    onSelectId(ledger.id);
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
            </colgroup>
            <thead className="standard-table-thead">
              <tr>
                <th className="standard-table-th standard-table-th-left">도로의 종류</th>
                <th className="standard-table-th standard-table-th-left">노선명</th>
              </tr>
            </thead>
            <tbody>
              {loading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={2} className="standard-table-empty">
                    불러오는 중…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={2} className="standard-table-empty">
                    {items.length === 0 ? '등록된 관리대장이 없습니다.' : '검색 결과가 없습니다.'}
                  </td>
                </tr>
              ) : (
                filtered.map((l) => {
                  const isSelected = l.id === selectedId;
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
                        <span className="standard-status-badge standard-status-badge-muted">
                          {l.roadType || '—'}
                        </span>
                      </td>
                      <td className="standard-table-td-text" title={l.routeName || undefined}>
                        {l.routeName || '(노선명 미입력)'}
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
