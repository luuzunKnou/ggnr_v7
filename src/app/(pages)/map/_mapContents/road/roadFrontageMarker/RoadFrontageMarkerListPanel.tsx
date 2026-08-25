'use client';

import { useMemo, useState } from 'react';
import { Layers, Search, X } from 'lucide-react';
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
  ROAD_FRONTAGE_MARKER_NEW_ID,
  ROAD_FRONTAGE_MARKER_ROAD_TYPES,
  isNewRoadFrontageMarkerId,
  markersExtent3857,
  type RoadFrontageMarkerLedger,
} from './roadFrontageMarkerMock';

type Props = {
  ledgers: RoadFrontageMarkerLedger[];
  selectedId: string | null;
  onSelectId: (id: string) => void;
  onAdd?: () => void;
  onClose: () => void;
};

export function RoadFrontageMarkerListPanel({
  ledgers,
  selectedId,
  onSelectId,
  onAdd,
  onClose,
}: Props) {
  const mapContext = useMapContext();
  const [keyword, setKeyword] = useState('');
  const [roadTypeFilter, setRoadTypeFilter] = useState('');

  const filtered = useMemo(() => {
    const saved = ledgers.filter((l) => !isNewRoadFrontageMarkerId(l.id));
    const kw = keyword.trim().toLowerCase();
    return saved.filter((l) => {
      if (roadTypeFilter && l.roadType !== roadTypeFilter) return false;
      if (!kw) return true;
      const markerText = l.markers
        .map((m) => [m.ownerName, m.ownerAddress, m.county, m.myeon, m.ri, m.lotNo].join(' '))
        .join(' ');
      return [l.roadType, l.routeName, markerText].join(' ').toLowerCase().includes(kw);
    });
  }, [ledgers, keyword, roadTypeFilter]);

  const handleSelect = (ledger: RoadFrontageMarkerLedger) => {
    onSelectId(ledger.id);
    const map = mapContext?.mapInstanceRef?.current;
    const extent = markersExtent3857(ledger.markers);
    if (!map || !extent) return;
    scheduleFitMapToExtent3857(map, extent, {
      maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
      applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
    });
  };

  const roadNetworkLayerOn = isRoadNetworkWmsVisible(mapContext?.visibleLayerNames);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-sm font-semibold text-foreground">접도구역 표주</span>
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
              else onSelectId(ROAD_FRONTAGE_MARKER_NEW_ID);
            }}
            disabled={selectedId === ROAD_FRONTAGE_MARKER_NEW_ID}
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

      <div className="shrink-0 space-y-2 border-b border-border px-2.5 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="노선명·소유자·지번"
            className="h-8 w-full rounded border border-border bg-background pl-7 pr-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/25"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {[{ value: '', label: '전체' }, ...ROAD_FRONTAGE_MARKER_ROAD_TYPES.map((t) => ({ value: t, label: t }))].map(
            (opt) => {
              const active = roadTypeFilter === opt.value;
              return (
                <button
                  key={opt.value || '__all__'}
                  type="button"
                  onClick={() => setRoadTypeFilter(opt.value)}
                  className={cn(
                    'rounded border px-2 py-1 text-[11px] font-medium transition-colors',
                    active
                      ? 'border-primary bg-primary/10 text-foreground dark:bg-primary/25'
                      : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground'
                  )}
                >
                  {opt.label}
                </button>
              );
            }
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {ledgers.length === 0 ? '등록된 관리대장이 없습니다.' : '검색 결과가 없습니다.'}
          </p>
        ) : (
          <table className="w-full table-fixed border-collapse text-left text-xs">
            <colgroup>
              <col className="w-[88px]" />
              <col />
            </colgroup>
            <thead className="sticky top-0 z-[1] bg-muted shadow-[inset_0_-1px_0_0_var(--border)]">
              <tr>
                <th className="whitespace-nowrap border-b-0 px-2 py-2 font-semibold text-foreground/90">
                  도로의 종류
                </th>
                <th className="whitespace-nowrap border-b-0 px-2 py-2 font-semibold text-foreground/90">
                  노선명
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                const isSelected = l.id === selectedId;
                return (
                  <tr
                    key={l.id}
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
                    <td className="px-2 py-1.5">
                      <span className="inline-block max-w-full truncate rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-foreground">
                        {l.roadType || '—'}
                      </span>
                    </td>
                    <td className="truncate px-2 py-1.5 text-foreground" title={l.routeName || undefined}>
                      {l.routeName || '(노선명 미입력)'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        목록 {filtered.length.toLocaleString()}건
        {roadTypeFilter ? ` / 전체 ${ledgers.length.toLocaleString()}건` : ''}
      </div>
    </div>
  );
}
