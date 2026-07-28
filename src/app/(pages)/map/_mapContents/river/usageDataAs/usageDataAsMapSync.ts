import type Map from "ol/Map";
import { call } from "@/lib/api";
import { refreshServiceWmsLayer } from "../../../_mapComponents/layerFactory/serviceLayerFactory";
import { scheduleFitMapToExtent3857 } from "../../../_mapComponents/config/mapAutoNavigation";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../../_mapComponents/config/mapDefaults";
import { USAGE_DATA_AS_WMS_LAYER_IDS } from "./usageDataAsLayerId";

export function ensureUsageDataAsWmsLayersVisible(
  setVisibleLayerNames?: (updater: (prev: Set<string>) => Set<string>) => void
): void {
  if (!setVisibleLayerNames) return;
  setVisibleLayerNames((prev) => {
    const next = new Set(prev);
    let changed = false;
    for (const id of USAGE_DATA_AS_WMS_LAYER_IDS) {
      const lid = id.toLowerCase();
      if (!next.has(lid)) {
        next.add(lid);
        changed = true;
      }
    }
    return changed ? next : prev;
  });
}

/** 하천점용 패널 종료·시스템 이탈 시 — 점용 WMS 끄기 */
export function clearUsageDataAsWmsLayers(
  setVisibleLayerNames?: (updater: (prev: Set<string>) => Set<string>) => void
): void {
  if (!setVisibleLayerNames) return;
  const ids = USAGE_DATA_AS_WMS_LAYER_IDS.map((id) => id.toLowerCase());
  setVisibleLayerNames((prev) => {
    let changed = false;
    const next = new Set(prev);
    for (const lid of ids) {
      if (next.delete(lid)) changed = true;
    }
    return changed ? next : prev;
  });
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
