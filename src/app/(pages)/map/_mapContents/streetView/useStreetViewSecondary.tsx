'use client';

import { StreetViewMockPanel } from './StreetViewMockPanel';
import { StreetViewSplitterControls } from './StreetViewSplitterControls';
import { useStreetViewMock } from './useStreetViewMock';
import { useStreetViewSplitterPrefs } from './useStreetViewSplitterPrefs';
import { USE_KAKAO_ROADVIEW } from './streetViewConfig';

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
      useKakaoRoadview={USE_KAKAO_ROADVIEW}
      panDeg={mock.panDeg}
      tiltDeg={mock.tiltDeg}
      onTiltChange={mock.onTiltChange}
      lng={mock.lng}
      lat={mock.lat}
      onRoadviewPosition={USE_KAKAO_ROADVIEW ? mock.onRoadviewPosition : undefined}
      onRoadviewPan={USE_KAKAO_ROADVIEW ? mock.onPanChange : undefined}
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
