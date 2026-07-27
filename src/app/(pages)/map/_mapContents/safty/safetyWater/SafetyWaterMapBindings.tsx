'use client';

import { useMemo } from 'react';
import { useSafetyWater } from './safetyWaterContext';
import { buildDummyWaterStatusById } from './safetyWaterStatus';
import { useSafetyWaterMapLayer } from './useSafetyWaterMapLayer';
import { useSafetyWaterMapZoom } from './useSafetyWaterMapZoom';
import { useSafetyWaterNearbyCctvLayer } from './useSafetyWaterNearbyCctvLayer';
import { useSafetyWaterRiskLayer } from './useSafetyWaterRiskLayer';

/** 지도 레이어·초기 줌 — 패널 UI와 분리 */
export function SafetyWaterMapBindings() {
  const {
    mapReady,
    map,
    stations,
    selectedStationId,
    focusStation,
    setListOpen,
    cctvLayerItems,
    cctvListItems,
    selectedCctvKey,
    setSelectedCctvKey,
    cctvOpen,
    riskAreas,
  } = useSafetyWater();

  const waterStatusById = useMemo(() => buildDummyWaterStatusById(stations), [stations]);

  useSafetyWaterMapZoom(true, mapReady, stations);
  useSafetyWaterMapLayer(
    mapReady,
    map,
    true,
    stations,
    selectedStationId,
    waterStatusById,
    (id) => {
      focusStation(id);
      setListOpen(false);
    }
  );
  useSafetyWaterRiskLayer(mapReady, map, true, riskAreas);
  /** 전체=전부 파랑, 특정=목록만 파랑·나머지 흐림, 선택=빨강(패널 open 시) */
  useSafetyWaterNearbyCctvLayer(
    mapReady,
    map,
    true,
    cctvLayerItems,
    cctvListItems,
    cctvOpen ? selectedCctvKey : null,
    (key) => {
      if (!cctvOpen) return;
      setSelectedCctvKey(key);
    }
  );

  return null;
}
