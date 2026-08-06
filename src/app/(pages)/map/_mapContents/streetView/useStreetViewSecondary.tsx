'use client';

import type { MapSplitControlItem } from '../../_mapComponents/mapSplit/MapSplitterGutter';
import type { MapSplitOrientation } from '../../_mapComponents/mapSplit/mapSplitTypes';
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
  const splitterPrefs = useStreetViewSplitterPrefs(projectName);

  const panel = active ? (
    <StreetViewSecondaryHost active={active} mapSync={mapSync} />
  ) : null;

  const controls: ((orientation: MapSplitOrientation) => MapSplitControlItem[]) | undefined =
    active ? (_orientation: MapSplitOrientation) => StreetViewSplitterControls() : undefined;

  return {
    panel,
    controls,
    controlOffsetRatio: splitterPrefs.controlOffsetRatio,
    onControlOffsetRatioChange: splitterPrefs.setControlOffsetRatio,
    controlsExpanded: splitterPrefs.controlsExpanded,
  };
}
