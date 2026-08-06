'use client';

import { useEffect } from 'react';
import { useMapContext } from '../../_mapComponents/MapContext';

/**
 * 배경 싱크 ON이면 보조 배경 id를 주 맵(mapBackgroundMapIdRef)과 맞춤.
 * OFF일 때는 포커스 맵에만 패널 선택이 적용되도록 Host·OpenLayersMap에서 분기.
 */
export function useMapSplitBasemapSync(active: boolean, primaryBackgroundId: string | undefined) {
  const mapContext = useMapContext();
  const basemapSync = mapContext?.mapSplitBasemapSync ?? true;
  const setSecondaryBackgroundId = mapContext?.setMapSplitSecondaryBackgroundId;

  useEffect(() => {
    if (!active || !basemapSync || !primaryBackgroundId || !setSecondaryBackgroundId) return;
    setSecondaryBackgroundId(primaryBackgroundId);
  }, [active, basemapSync, primaryBackgroundId, setSecondaryBackgroundId]);
}
