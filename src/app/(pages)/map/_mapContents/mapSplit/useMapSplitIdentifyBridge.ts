'use client';

import { useEffect, useRef } from 'react';
import type Map from 'ol/Map';
import { useMapContext } from '../../_mapComponents/MapContext';
import {
  armMapSplitSelectionViewMirror,
  syncSecondaryViewFromPrimary,
} from './useMapSplitViewSync';

/**
 * 식별·객체 클릭은 useMapSplitPointerBridge가 좌측으로 전달.
 * 식별 목록이 갱신되면 이동 싱크와 무관하게 좌측 view(중심·확대)를 우측에 맞춘다.
 */
export function useMapSplitIdentifyBridge(
  primary: Map | null,
  secondary: Map | null,
  active: boolean
) {
  const mapContext = useMapContext();
  const lastCoordKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active) {
      lastCoordKeyRef.current = null;
      return;
    }
    const list = mapContext?.identifyResultList;
    if (!list?.coordinate) return;
    const key = `${list.coordinate[0]},${list.coordinate[1]}`;
    if (lastCoordKeyRef.current === key) return;
    lastCoordKeyRef.current = key;
    armMapSplitSelectionViewMirror();
    syncSecondaryViewFromPrimary(primary, secondary);
  }, [active, mapContext?.identifyResultList, primary, secondary]);
}
