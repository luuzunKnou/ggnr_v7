'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MapSplitControlItem } from '../../_mapComponents/mapSplit/MapSplitterGutter';
import {
  MAP_SPLIT_CONTROL_OFFSET_MAX,
  MAP_SPLIT_CONTROL_OFFSET_MIN,
  type MapSplitOrientation,
} from '../../_mapComponents/mapSplit/mapSplitTypes';
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
  const [controlOffsetRatio, setControlOffsetRatio] = useState(0.5);

  const clampControlOffset = useCallback((ratio: number) => {
    return Math.min(
      MAP_SPLIT_CONTROL_OFFSET_MAX,
      Math.max(MAP_SPLIT_CONTROL_OFFSET_MIN, ratio)
    );
  }, []);

  // 지도분할 ON: 거터 펼침 + 이동·배경 싱크 기본 ON
  useEffect(() => {
    if (!active) return;
    setControlsExpanded(true);
    setMapSync?.(true);
    setBasemapSync?.(true);
  }, [active, setMapSync, setBasemapSync]);

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
    controlOffsetRatio,
    onControlOffsetRatioChange: (ratio: number) =>
      setControlOffsetRatio(clampControlOffset(ratio)),
    controlsExpanded,
    onControlsExpandedChange: setControlsExpanded,
  };
}
