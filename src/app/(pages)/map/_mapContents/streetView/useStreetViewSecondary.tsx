'use client';

import { useCallback, useEffect } from 'react';
import type { MapSplitControlItem } from '../../_mapComponents/mapSplit/MapSplitterGutter';
import type { MapSplitOrientation } from '../../_mapComponents/mapSplit/mapSplitTypes';
import { useMapContext } from '../../_mapComponents/MapContext';
import { StreetViewSecondaryHost } from './StreetViewSecondaryHost';
import { StreetViewSplitterControls } from './StreetViewSplitterControls';
import { useStreetViewSplitterPrefs } from './useStreetViewSplitterPrefs';

type StreetViewSecondaryProps = {
  active: boolean;
  mapSync: boolean;
  projectName?: string;
};

/** 보조 칸 + 컨트롤 슬롯 (거리뷰) — pan/tilt state는 Host 내부 */
export function useStreetViewSecondary({
  active,
  mapSync,
  projectName,
}: StreetViewSecondaryProps) {
  const mapContext = useMapContext();
  const setKind = mapContext?.setMapSplitSecondaryKind;
  const splitterPrefs = useStreetViewSplitterPrefs(projectName);
  const setControlsExpanded = splitterPrefs.setControlsExpanded;

  const onExit = useCallback(() => {
    setKind?.(null);
  }, [setKind]);

  // 지도분할↔거리뷰 전환·재진입 시 거터는 항상 펼침
  useEffect(() => {
    if (active) setControlsExpanded(true);
  }, [active, setControlsExpanded]);

  const panel = active ? (
    <StreetViewSecondaryHost active={active} mapSync={mapSync} />
  ) : null;

  const controls: ((orientation: MapSplitOrientation) => MapSplitControlItem[]) | undefined =
    active
      ? (_orientation: MapSplitOrientation) => StreetViewSplitterControls({ onExit })
      : undefined;

  return {
    panel,
    controls,
    controlsExpanded: splitterPrefs.controlsExpanded,
    onControlsExpandedChange: setControlsExpanded,
  };
}
