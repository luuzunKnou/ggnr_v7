'use client';

import { useEffect, useRef, useState } from 'react';
import { Layers, Search, X } from 'lucide-react';
import { call } from '@/lib/api';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';
import { cn } from '@/lib/utils';
import { LayerRowAddButton, LayerRowPanelButton } from '../../../_mapComponents/layerRowEdit';
import { useMapContext } from '../../../_mapComponents/MapContext';
import { scheduleFitMapToExtent3857 } from '../../../_mapComponents/config/mapAutoNavigation';
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../../_mapComponents/config/mapDefaults';
import {
  isRoadNetworkWmsVisible,
  toggleRoadNetworkWmsLayers,
} from '../roadNetwork/roadNetworkMapSync';
import {
  ROAD_FRONTAGE_BUILDING_NEW_ID,
  formatRouteNoName,
  isNewRoadFrontageBuildingId,
  ledgerExtent3857,
  type RoadFrontageBuildingLedger,
} from './roadFrontageBuildingMock';

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
  const [keyword, setKeyword] = useState('');
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

  const handleSelect = (ledger: RoadFrontageBuildingLedger) => {
    onSelectId(ledger.id);
    const map = mapContext?.mapInstanceRef?.current;
    if (!map || !hasMapPoint(ledger)) return;
    scheduleFitMapToExtent3857(map, ledgerExtent3857(ledger), {
      maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
      applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
    });
  };

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
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-sm font-semibold text-foreground">접도구역 건축물</span>
        <div className="flex items-center gap-1">
          <LayerRowPanelButton
            type="button"
            title={roadNetworkLayerOn ? '도로망도 레이어 끄기' : '도로망도 레이어 켜기'}
            aria-label={roadNetworkLayerOn ? '도로망도 레이어 끄기' : '도로망도 레이어 켜기'}
            aria-pressed={roadNetworkLayerOn}
            onClick={() => toggleRoadNetworkWmsLayers(mapContext?.setVisibleLayerNames)}
            className={roadNetworkLayerOn ? 'border-primary bg-primary/15 text-foreground hover:opacity-90' : undefined}
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
            onClick={onClose}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="검색 (도로종류, 위치, 노선번호 등)"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground ring-offset-2 focus:border-primary focus:ring-2 focus:ring-primary/25"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error ? (
          <div className="shrink-0 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}
        <div ref={listScrollRef} className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          <table className="w-full min-w-[360px] table-fixed border-collapse text-left text-xs">
            <colgroup>
              <col className="w-[100px]" />
              <col />
              <col className="w-[72px]" />
              <col className="w-[88px]" />
            </colgroup>
            <thead className="sticky top-0 z-[1] bg-muted shadow-[inset_0_-1px_0_0_var(--border)]">
              <tr>
                <th className="whitespace-nowrap border-b-0 px-2 py-2 font-semibold text-foreground/90">
                  도로의 종류
                </th>
                <th className="whitespace-nowrap border-b-0 px-2 py-2 font-semibold text-foreground/90">
                  위치
                </th>
                <th className="whitespace-nowrap border-b-0 px-2 py-2 font-semibold text-foreground/90">
                  노선번호
                </th>
                <th className="whitespace-nowrap border-b-0 px-2 py-2 font-semibold text-foreground/90">
                  작성연월일
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                    불러오는 중…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                    등록된 관리대장이 없습니다.
                  </td>
                </tr>
              ) : (
                items.map((l) => {
                  const isSelected = l.id === selectedId;
                  const routeTitle = formatRouteNoName(l.routeNo, l.routeName);
                  return (
                    <tr
                      key={l.id}
                      data-road-frontage-building-row={l.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelect(l)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelect(l);
                        }
                      }}
                      className={cn(
                        'cursor-pointer border-b border-border transition-colors',
                        isSelected
                          ? 'bg-primary/10 dark:bg-primary/25'
                          : 'hover:bg-muted/50'
                      )}
                    >
                      <td className="max-w-0 truncate px-2 py-1.5 text-foreground" title={l.roadType}>
                        {l.roadType || '—'}
                      </td>
                      <td
                        className="max-w-0 truncate px-2 py-1.5 text-foreground"
                        title={l.locationAddress}
                      >
                        {formatAddressStripSidoSigungu(l.locationAddress) ||
                          l.locationAddress ||
                          '(위치 미입력)'}
                      </td>
                      <td
                        className="max-w-0 truncate px-2 py-1.5 tabular-nums text-foreground"
                        title={routeTitle !== '—' ? routeTitle : undefined}
                      >
                        {l.routeNo.trim() || '—'}
                      </td>
                      <td
                        className="max-w-0 truncate px-2 py-1.5 tabular-nums text-foreground"
                        title={l.preparedDate}
                      >
                        {l.preparedDate || '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          {items.length.toLocaleString()}건
        </div>
      </div>
    </div>
  );
}
