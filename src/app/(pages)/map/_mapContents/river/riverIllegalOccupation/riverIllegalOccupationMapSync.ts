import type Map from "ol/Map";
import { refreshServiceWmsLayer } from "../../../_mapComponents/layerFactory/serviceLayerFactory";
import { RIVER_ILLEGAL_OCCUPATION_WMS_LAYER_ID } from "./riverIllegalOccupationLayerId";

type SetVisible = (updater: (prev: Set<string>) => Set<string>) => void;

/** 불법점용 관리카드 패널 진입 — 전체 카드 점 WMS 표시 */
export function ensureRiverIllegalOccupationWmsLayer(
  setVisibleLayerNames: SetVisible | null | undefined
) {
  if (!setVisibleLayerNames) return;
  const id = RIVER_ILLEGAL_OCCUPATION_WMS_LAYER_ID.toLowerCase();
  setVisibleLayerNames((prev) => {
    if (prev.has(id)) return prev;
    const next = new Set(prev);
    next.add(id);
    return next;
  });
}

/** 패널 종료 시 WMS 끄기 */
export function clearRiverIllegalOccupationWmsLayer(
  setVisibleLayerNames: SetVisible | null | undefined
) {
  if (!setVisibleLayerNames) return;
  const id = RIVER_ILLEGAL_OCCUPATION_WMS_LAYER_ID.toLowerCase();
  setVisibleLayerNames((prev) => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev);
    next.delete(id);
    return next;
  });
}

/** 저장·삭제 후 지도 점 갱신 */
export function refreshRiverIllegalOccupationMap(map: Map | null | undefined) {
  refreshServiceWmsLayer(map);
  requestAnimationFrame(() => refreshServiceWmsLayer(map));
}
