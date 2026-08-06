'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MapSplitControlItem } from '../../_mapComponents/mapSplit/MapSplitterGutter';
import type { MapSplitOrientation } from '../../_mapComponents/mapSplit/mapSplitTypes';
import { useMapContext } from '../../_mapComponents/MapContext';
import { MapSplitSecondaryHost } from './MapSplitSecondaryHost';
import { MapSplitSplitterControls } from './MapSplitSplitterControls';

type MapSplitSecondaryProps = {
  active: boolean;
};

/** 보조 칸 + 거터 컨트롤 슬롯 (지도분할) */
export function useMapSplitSecondary({ active }: MapSplitSecondaryProps) {
  const mapContext = useMapContext();
  const mapSync = mapContext?.mapSplitMapSync ?? true;
  const setMapSync = mapContext?.setMapSplitMapSync;
  const basemapSync = mapContext?.mapSplitBasemapSync ?? true;
  const setBasemapSync = mapContext?.setMapSplitBasemapSync;
  const setKind = mapContext?.setMapSplitSecondaryKind;
  const [controlsExpanded, setControlsExpanded] = useState(true);

  // 거리뷰↔지도분할 전환·재진입 시 거터는 항상 펼침
  useEffect(() => {
    if (active) setControlsExpanded(true);
  }, [active]);

  const onExit = useCallback(() => {
    setKind?.(null);
  }, [setKind]);

  const panel = active ? <MapSplitSecondaryHost active={active} /> : null;

  const controls:
    | ((orientation: MapSplitOrientation) => MapSplitControlItem[])
    | undefined = active
    ? () =>
        MapSplitSplitterControls({
          mapSync,
          onMapSyncChange: (next) => setMapSync?.(next),
          basemapSync,
          onBasemapSyncChange: (next) => setBasemapSync?.(next),
          onExit,
        })
    : undefined;

  return {
    panel,
    controls,
    controlsExpanded,
    onControlsExpandedChange: setControlsExpanded,
  };
}
