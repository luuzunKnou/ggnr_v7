"use client";

import { useEffect } from "react";
import { useRoadFrontageBuildingMapHighlight } from "../../road/roadFrontageBuilding/useRoadFrontageBuildingMapHighlight";

type Location = { key: string; lon: string; lat: string } | null;

/** 선택 카드 위치 — 접도구역 건축물과 같은 점 레이더 + 지도 이동. 위치가 바뀔 때만 이동한다 */
export function useRiverIllegalOccupationMapLocation(location: Location, enabled = true) {
  const { highlightAt, clearHighlight } = useRoadFrontageBuildingMapHighlight();
  const key = location?.key ?? "";
  const lonRaw = location?.lon.trim() ?? "";
  const latRaw = location?.lat.trim() ?? "";

  useEffect(() => {
    const lon = Number(lonRaw);
    const lat = Number(latRaw);
    if (!enabled || !key || !lonRaw || !latRaw || !Number.isFinite(lon) || !Number.isFinite(lat)) {
      clearHighlight();
      return;
    }
    highlightAt(lon, lat, key, { fit: true });
  }, [enabled, key, lonRaw, latRaw, highlightAt, clearHighlight]);

  useEffect(() => () => clearHighlight(), [clearHighlight]);
}
