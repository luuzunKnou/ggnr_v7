import type Map from "ol/Map";
import { call } from "@/lib/api";
import { refreshServiceWmsLayer } from "../../../_mapComponents/layerFactory/serviceLayerFactory";
import { scheduleFitMapToExtent3857 } from "../../../_mapComponents/config/mapAutoNavigation";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../../_mapComponents/config/mapDefaults";
import { clearUseFeeWmsLayer } from "../../useFee/useFeeMapSync";
import {
  USAGE_DATA_AS_MGJ_WMS_LAYER_ID,
  USAGE_DATA_AS_PANEL_WMS_LAYER_IDS,
  USAGE_DATA_AS_SISUL_WMS_LAYER_ID,
  USAGE_DATA_AS_SOLO_WMS_LAYER_ID,
  USAGE_DATA_AS_WMS_LAYER_ID,
} from "./usageDataAsLayerId";

/**
 * 하천점용 WMS — 기본은 본표와 필지를 함께 켜고 물건지는 끔.
 * includeMgj=true 일 때만 물건지도 켠다.
 */
export function ensureUsageDataAsWmsLayersVisible(
  setVisibleLayerNames?: (updater: (prev: Set<string>) => Set<string>) => void,
  opts?: {
    includeMgj?: boolean;
    /** true면 본표·필지 WMS를 끔 (도형 편집 중 저장된 도형 숨김) */
    omitMain?: boolean;
  }
): void {
  if (!setVisibleLayerNames) return;
  /** 부서업무 진입부터 본표와 필지를 함께 표시 */
  const mainIds = [USAGE_DATA_AS_WMS_LAYER_ID, USAGE_DATA_AS_SOLO_WMS_LAYER_ID].map((id) =>
    id.toLowerCase()
  );
  const mgjId = USAGE_DATA_AS_MGJ_WMS_LAYER_ID.toLowerCase();
  const includeMgj = opts?.includeMgj === true;
  const omitMain = opts?.omitMain === true;
  setVisibleLayerNames((prev) => {
    const next = new Set(prev);
    let changed = false;
    for (const lid of mainIds) {
      if (omitMain) {
        if (next.delete(lid)) changed = true;
      } else if (!next.has(lid)) {
        next.add(lid);
        changed = true;
      }
    }
    if (includeMgj) {
      if (!next.has(mgjId)) {
        next.add(mgjId);
        changed = true;
      }
    } else if (next.delete(mgjId)) {
      changed = true;
    }
    return changed ? next : prev;
  });
}

/** 하천점용 패널 종료·시스템 이탈 시 — 점용·시설물·점사용료 WMS 끄기 */
export function clearUsageDataAsWmsLayers(
  setVisibleLayerNames?: (updater: (prev: Set<string>) => Set<string>) => void
): void {
  if (!setVisibleLayerNames) return;
  const ids = USAGE_DATA_AS_PANEL_WMS_LAYER_IDS.map((id) => id.toLowerCase());
  setVisibleLayerNames((prev) => {
    let changed = false;
    const next = new Set(prev);
    for (const lid of ids) {
      if (next.delete(lid)) changed = true;
    }
    return changed ? next : prev;
  });
  clearUseFeeWmsLayer(setVisibleLayerNames);
}

/** 점용시설물 WMS on/off (울진 하천점용 목록) */
export function toggleUsageDataAsSisulWmsLayer(
  setVisibleLayerNames?: (updater: (prev: Set<string>) => Set<string>) => void
): void {
  if (!setVisibleLayerNames) return;
  const lid = USAGE_DATA_AS_SISUL_WMS_LAYER_ID.toLowerCase();
  setVisibleLayerNames((prev) => {
    const next = new Set(prev);
    if (next.has(lid)) next.delete(lid);
    else next.add(lid);
    return next;
  });
}

export function isUsageDataAsSisulWmsVisible(
  visibleLayerNames?: Set<string> | null
): boolean {
  if (!visibleLayerNames) return false;
  return visibleLayerNames.has(USAGE_DATA_AS_SISUL_WMS_LAYER_ID.toLowerCase());
}

/** 저장·상세 갱신 후 WMS·뷰 동기화 */
export async function refreshUsageDataAsMapView(opts: {
  map: Map | null | undefined;
  detailId: string;
  setVisibleLayerNames?: (updater: (prev: Set<string>) => Set<string>) => void;
  applyMapViewPadding?: (() => void) | null;
}): Promise<void> {
  const key = String(opts.detailId ?? "").trim();
  if (!key) return;

  ensureUsageDataAsWmsLayersVisible(opts.setVisibleLayerNames);
  refreshServiceWmsLayer(opts.map);
  requestAnimationFrame(() => refreshServiceWmsLayer(opts.map));

  try {
    const res = await call("", "POST", {
      service: "usageDataAsService",
      action: "getUsageDataAsExtent3857ByKey",
      params: { key },
    });
    const data = res?.data ?? res;
    const ext = data?.extent3857 as unknown;
    if (
      opts.map &&
      Array.isArray(ext) &&
      ext.length === 4 &&
      ext.every((v) => Number.isFinite(Number(v)))
    ) {
      scheduleFitMapToExtent3857(opts.map, ext as number[], {
        maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
        applyMapViewPadding: () => opts.applyMapViewPadding?.(),
      });
    }
  } catch {
    /* extent 없으면 WMS 갱신만 */
  }
}
