'use client';

import { useCallback, useEffect } from 'react';
import type { MapSplitControlItem } from '../../_mapComponents/mapSplit/MapSplitterGutter';
import type { MapSplitOrientation } from '../../_mapComponents/mapSplit/mapSplitTypes';
import { useMapContext } from '../../_mapComponents/MapContext';
import { MapSplitSecondaryHost } from './MapSplitSecondaryHost';
import { MapSplitSplitterControls } from './MapSplitSplitterControls';
import { useMapSplitSplitterPrefs } from './useMapSplitSplitterPrefs';

type MapSplitSecondaryProps = {
  active: boolean;
  projectName?: string;
};

/** 보조 칸 + 거터 컨트롤 슬롯 (지도분할) */
export function useMapSplitSecondary({ active, projectName }: MapSplitSecondaryProps) {
  const mapContext = useMapContext();
  const mapSync = mapContext?.mapSplitMapSync ?? true;
  const setMapSync = mapContext?.setMapSplitMapSync;
  const basemapSync = mapContext?.mapSplitBasemapSync ?? true;
  const setBasemapSync = mapContext?.setMapSplitBasemapSync;
  const setKind = mapContext?.setMapSplitSecondaryKind;
  const splitterPrefs = useMapSplitSplitterPrefs(projectName);
  const setControlsExpanded = splitterPrefs.setControlsExpanded;

  // 지도분할 ON: 거터 펼침 + 이동·배경 싱크 기본 ON (위치 offset은 localStorage 유지)
  useEffect(() => {
    if (!active) return;
    setControlsExpanded(true);
    setMapSync?.(true);
    setBasemapSync?.(true);
  }, [active, setControlsExpanded, setMapSync, setBasemapSync]);

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
    controlsExpanded: splitterPrefs.controlsExpanded,
    onControlsExpandedChange: setControlsExpanded,
  };
}
