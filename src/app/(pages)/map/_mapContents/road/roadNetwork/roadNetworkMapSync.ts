import type Map from "ol/Map";
import { refreshServiceWmsLayer } from "../../../_mapComponents/layerFactory/serviceLayerFactory";
import type {
  RoadNetworkOpenStatusFilter,
  RoadNetworkTypeFilter,
} from "./roadNetworkMock";
import {
  ROAD_NETWORK_WMS_LAYER_IDS,
  resolveRoadNetworkWmsLayerIds,
} from "./roadNetworkLayerId";

type SetVisible = (updater: (prev: Set<string>) => Set<string>) => void;

/**
 * 도로망도 WMS — 종류·개설 필터에 맞는 테이블만 켠다.
 * 패널 소유 레이어 중 불필요한 것은 끈다.
 */
export function ensureRoadNetworkWmsLayers(
  setVisibleLayerNames: SetVisible | null | undefined,
  opts: {
    typeFilter: RoadNetworkTypeFilter;
    openStatusFilter: RoadNetworkOpenStatusFilter;
  }
): void {
  if (!setVisibleLayerNames) return;
  const want = new Set(resolveRoadNetworkWmsLayerIds(opts));
  const owned = ROAD_NETWORK_WMS_LAYER_IDS.map((id) => id.toLowerCase());
  setVisibleLayerNames((prev) => {
    const next = new Set(prev);
    let changed = false;
    for (const lid of owned) {
      if (want.has(lid)) {
        if (!next.has(lid)) {
          next.add(lid);
          changed = true;
        }
      } else if (next.delete(lid)) {
        changed = true;
      }
    }
    return changed ? next : prev;
  });
}

/** 도로망도 패널 종료 시 WMS 끄기 */
export function clearRoadNetworkWmsLayers(
  setVisibleLayerNames: SetVisible | null | undefined
): void {
  if (!setVisibleLayerNames) return;
  const ids = ROAD_NETWORK_WMS_LAYER_IDS.map((id) => id.toLowerCase());
  setVisibleLayerNames((prev) => {
    let changed = false;
    const next = new Set(prev);
    for (const lid of ids) {
      if (next.delete(lid)) changed = true;
    }
    return changed ? next : prev;
  });
}

/** 접도구역 건축물 목록 등 — 도로망도 WMS 전체 on/off */
export function toggleRoadNetworkWmsLayers(
  setVisibleLayerNames: SetVisible | null | undefined
): void {
  if (!setVisibleLayerNames) return;
  const ids = ROAD_NETWORK_WMS_LAYER_IDS.map((id) => id.toLowerCase());
  setVisibleLayerNames((prev) => {
    const next = new Set(prev);
    const anyOn = ids.some((lid) => next.has(lid));
    if (anyOn) {
      for (const lid of ids) next.delete(lid);
    } else {
      for (const lid of ids) next.add(lid);
    }
    return next;
  });
}

export function isRoadNetworkWmsVisible(visibleLayerNames?: Set<string> | null): boolean {
  if (!visibleLayerNames) return false;
  return ROAD_NETWORK_WMS_LAYER_IDS.some((id) =>
    visibleLayerNames.has(id.toLowerCase())
  );
}

/** 저장·삭제 후 WMS 타일 갱신 */
export function refreshRoadNetworkWmsLayer(map: Map | null | undefined): void {
  refreshServiceWmsLayer(map);
  requestAnimationFrame(() => refreshServiceWmsLayer(map));
}
