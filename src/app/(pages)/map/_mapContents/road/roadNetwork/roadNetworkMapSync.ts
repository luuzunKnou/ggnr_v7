import type { Dispatch, SetStateAction } from "react";
import type Map from "ol/Map";
import { refreshServiceWmsLayer } from "../../../_mapComponents/layerFactory/serviceLayerFactory";
import type {
  RoadNetworkOpenStatusFilter,
  RoadNetworkTypeFilter,
} from "./roadNetworkMock";
import { ROAD_NETWORK_UNIFIED_LS, ROAD_NETWORK_UNIFIED_PS } from "./roadNetworkGrade";
import {
  ROAD_NETWORK_OWNED_WMS_LAYER_IDS,
  resolveRoadNetworkWmsLayerIds,
  roadNetworkWmsLayerIdsForMode,
  type RoadNetworkSourceMode,
} from "./roadNetworkLayerId";

type SetVisible = (updater: (prev: Set<string>) => Set<string>) => void;
type SetCqlByLayer = Dispatch<SetStateAction<Record<string, string> | null>>;

/**
 * 도로망도 WMS — 종류·개설 필터에 맞는 테이블만 켠다.
 * 패널 소유 레이어 중 불필요한 것은 끈다.
 */
export function ensureRoadNetworkWmsLayers(
  setVisibleLayerNames: SetVisible | null | undefined,
  opts: {
    typeFilter: RoadNetworkTypeFilter;
    openStatusFilter: RoadNetworkOpenStatusFilter;
    /** 통합 모드 노선번호 표지 표시 (기본 표시) */
    showSigns?: boolean;
  },
  mode: RoadNetworkSourceMode = "legacy"
): void {
  if (!setVisibleLayerNames) return;
  const want = new Set(resolveRoadNetworkWmsLayerIds(opts, mode));
  if (opts.showSigns === false) want.delete(ROAD_NETWORK_UNIFIED_PS);
  const owned = ROAD_NETWORK_OWNED_WMS_LAYER_IDS.map((id) => id.toLowerCase());
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

function patchUnifiedCql(
  setCql: SetCqlByLayer,
  lineCql: string | null,
  signCql: string | null
): void {
  setCql((prev) => {
    const cur = prev ?? {};
    if (
      (cur[ROAD_NETWORK_UNIFIED_LS] ?? null) === lineCql &&
      (cur[ROAD_NETWORK_UNIFIED_PS] ?? null) === signCql
    ) {
      return prev;
    }
    const next = { ...cur };
    if (lineCql) next[ROAD_NETWORK_UNIFIED_LS] = lineCql;
    else delete next[ROAD_NETWORK_UNIFIED_LS];
    if (signCql) next[ROAD_NETWORK_UNIFIED_PS] = signCql;
    else delete next[ROAD_NETWORK_UNIFIED_PS];
    return Object.keys(next).length === 0 ? null : next;
  });
}

/** 통합 모드 — 종류·개설 필터를 선·표지 CQL로 반영 (null이면 해당 레이어 조건 해제) */
export function syncRoadNetworkUnifiedCql(
  setCql: SetCqlByLayer | null | undefined,
  lineCql: string | null,
  signCql: string | null
): void {
  if (!setCql) return;
  patchUnifiedCql(setCql, lineCql, signCql);
}

export function clearRoadNetworkUnifiedCql(setCql: SetCqlByLayer | null | undefined): void {
  if (!setCql) return;
  patchUnifiedCql(setCql, null, null);
}

/** 도로망도 패널 종료 시 WMS 끄기 */
export function clearRoadNetworkWmsLayers(
  setVisibleLayerNames: SetVisible | null | undefined
): void {
  if (!setVisibleLayerNames) return;
  const ids = ROAD_NETWORK_OWNED_WMS_LAYER_IDS.map((id) => id.toLowerCase());
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
  setVisibleLayerNames: SetVisible | null | undefined,
  mode: RoadNetworkSourceMode = "legacy"
): void {
  if (!setVisibleLayerNames) return;
  const all = ROAD_NETWORK_OWNED_WMS_LAYER_IDS.map((id) => id.toLowerCase());
  const want = roadNetworkWmsLayerIdsForMode(mode);
  setVisibleLayerNames((prev) => {
    const next = new Set(prev);
    const anyOn = all.some((lid) => next.has(lid));
    for (const lid of all) next.delete(lid);
    if (!anyOn) {
      for (const lid of want) next.add(lid);
    }
    return next;
  });
}

export function isRoadNetworkWmsVisible(visibleLayerNames?: Set<string> | null): boolean {
  if (!visibleLayerNames) return false;
  return ROAD_NETWORK_OWNED_WMS_LAYER_IDS.some((id) =>
    visibleLayerNames.has(id.toLowerCase())
  );
}

/** 저장·삭제 후 WMS 타일 갱신 */
export function refreshRoadNetworkWmsLayer(map: Map | null | undefined): void {
  refreshServiceWmsLayer(map);
  requestAnimationFrame(() => refreshServiceWmsLayer(map));
}
