'use client';

import { StreetViewPanel } from './StreetViewPanel';
import { useStreetView } from './useStreetView';

type StreetViewSecondaryHostProps = {
  active: boolean;
  mapSync: boolean;
};

/**
 * 거리뷰 hook·패널을 Wrapper 밖에서 소유해 pan/tilt setState가
 * OpenLayers 래퍼 트리를 다시 그리지 않게 격리.
 */
export function StreetViewSecondaryHost({ active, mapSync }: StreetViewSecondaryHostProps) {
  const streetView = useStreetView({ active, mapSync });

  if (!active) return null;

  return (
    <div className="h-full w-full bg-[#888888]">
      <StreetViewPanel
        panDeg={streetView.panDeg}
        lng={streetView.lng}
        lat={streetView.lat}
        getPanoSearchRadiusM={streetView.getPanoSearchRadiusM}
        onRoadviewPosition={streetView.onRoadviewPosition}
        onRoadviewPan={streetView.onPanFromRoadview}
        onRoadviewPanCommit={streetView.onPanChange}
        onRoadviewTilt={streetView.onTiltChange}
        walkerIconMode={streetView.walkerIconMode}
        onWalkerIconModeChange={streetView.onWalkerIconModeChange}
      />
    </div>
  );
}
