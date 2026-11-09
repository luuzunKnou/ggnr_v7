"use client";

import { call } from "@/lib/api";
import type { RiverBasicPlanTab } from "@/lib/riverBasicPlanMapAttachmentLayers";
import { useMapContext } from "../../../_mapComponents/MapContext";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../../_mapComponents/config/mapDefaults";
import { scheduleFitMapToExtent3857 } from "../../../_mapComponents/config/mapAutoNavigation";

type Extent = [number, number, number, number];

/** 하천 범위 — 색인도 범위, 없으면 기본계획 범위 */
async function fetchRiverExtent(tab: RiverBasicPlanTab, riverName: string): Promise<Extent | null> {
  for (const action of ["getRiverBasicPlanIndexExtent", "getRiverBasicPlanExtent"]) {
    try {
      const res = await call("", "POST", { service: "riverBasicPlanService", action, params: { tab, riverName } });
      const ext = (res?.data ?? res)?.extent3857;
      if (Array.isArray(ext) && ext.length === 4 && ext.every((v: unknown) => Number.isFinite(Number(v)))) {
        return ext.map(Number) as Extent;
      }
    } catch {
      // 다음 방법으로
    }
  }
  return null;
}

/** 하천 선택 후 지도 이동 공통 — 색인도 보기에서 나와 하천(들) 범위로 맞춤 */
function useFitRiverExtents(tab: RiverBasicPlanTab) {
  const mapContext = useMapContext();
  return async (riverNames: readonly string[]) => {
    mapContext?.riverBasicPlanExitIndexViewToDetailRef?.current?.();
    const exts = (await Promise.all(riverNames.map((n) => fetchRiverExtent(tab, n)))).filter(
      (e): e is Extent => e != null
    );
    const map = mapContext?.mapInstanceRef?.current;
    if (!map || exts.length === 0) return;
    const union: Extent = [
      Math.min(...exts.map((e) => e[0])),
      Math.min(...exts.map((e) => e[1])),
      Math.max(...exts.map((e) => e[2])),
      Math.max(...exts.map((e) => e[3])),
    ];
    scheduleFitMapToExtent3857(map, union, {
      maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
      pointThreshold: 1,
      applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
    });
  };
}

/** 하천 한 곳으로 지도 이동. 목록·보고서 하천 목록 공용 */
export function useRiverBasicPlanFocusRiver(tab: RiverBasicPlanTab) {
  const fit = useFitRiverExtents(tab);
  return (riverName: string) => fit([riverName]);
}

/** 보고서에 속한 하천 전체가 한 화면에 보이도록 지도 이동 */
export function useRiverBasicPlanFocusRivers(tab: RiverBasicPlanTab) {
  return useFitRiverExtents(tab);
}
