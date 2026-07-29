'use client';

import { StreetViewPanel } from './StreetViewPanel';
import { StreetViewSplitterControls } from './StreetViewSplitterControls';
import { useStreetView } from './useStreetView';
import { useStreetViewSplitterPrefs } from './useStreetViewSplitterPrefs';

type StreetViewSecondaryProps = {
  active: boolean;
  mapSync: boolean;
  projectName?: string;
};

/** 보조 칸 + 컨트롤 슬롯 내용 (거리뷰) */
export function useStreetViewSecondary({
  active,
  mapSync,
  projectName,
}: StreetViewSecondaryProps) {
  const streetView = useStreetView({
    active,
    mapSync,
  });

  const splitterPrefs = useStreetViewSplitterPrefs(projectName);

  const panel = active ? (
    <StreetViewPanel
      panDeg={streetView.panDeg}
      lng={streetView.lng}
      lat={streetView.lat}
      onRoadviewPosition={streetView.onRoadviewPosition}
      onRoadviewPan={streetView.onPanChange}
      onRoadviewTilt={streetView.onTiltChange}
    />
  ) : null;

  const controls = active
    ? () => StreetViewSplitterControls()
    : null;

  return {
    panel,
    controls,
    controlOffsetRatio: splitterPrefs.controlOffsetRatio,
    onControlOffsetRatioChange: splitterPrefs.setControlOffsetRatio,
    controlsExpanded: splitterPrefs.controlsExpanded,
  };
}
