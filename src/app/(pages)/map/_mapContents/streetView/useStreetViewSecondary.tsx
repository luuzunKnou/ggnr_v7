'use client';

import { StreetViewMockPanel } from './StreetViewMockPanel';
import { StreetViewSplitterControls } from './StreetViewSplitterControls';
import { useStreetViewMock } from './useStreetViewMock';
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
  const mock = useStreetViewMock({
    active,
    mapSync,
  });

  const splitterPrefs = useStreetViewSplitterPrefs(projectName);

  const panel = active ? (
    <StreetViewMockPanel
      panDeg={mock.panDeg}
      mapScale={mock.mapScale}
      relocating={mock.relocating}
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
