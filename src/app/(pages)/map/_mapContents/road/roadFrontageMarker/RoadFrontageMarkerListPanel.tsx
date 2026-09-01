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

  const savedLedgers = useMemo(
    () => ledgers.filter((l) => !isNewRoadFrontageMarkerId(l.id)),
    [ledgers]
  );

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return savedLedgers.filter((l) => {
      if (roadTypeFilter && l.roadType !== roadTypeFilter) return false;
      if (!kw) return true;
      const markerText = l.markers
        .map((m) => [m.ownerName, m.ownerAddress, m.county, m.myeon, m.ri, m.lotNo].join(' '))
        .join(' ');
      return [l.roadType, l.routeName, markerText].join(' ').toLowerCase().includes(kw);
    });
  }, [savedLedgers, keyword, roadTypeFilter]);

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
        <div className="standard-list-scroll">
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
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={2} className="standard-table-empty">
                    {savedLedgers.length === 0
                      ? '등록된 관리대장이 없습니다.'
                      : '검색 결과가 없습니다.'}
                  </td>
                </tr>
              ) : (
                filtered.map((l) => {
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
            ? ` / 전체 ${savedLedgers.length.toLocaleString()}건`
            : ''}
        </div>
      </div>
    </div>
  );
}
