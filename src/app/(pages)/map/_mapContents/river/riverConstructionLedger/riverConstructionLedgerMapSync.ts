import type Map from "ol/Map";
import { call } from "@/lib/api";
import { refreshServiceWmsLayer } from "../../../_mapComponents/layerFactory/serviceLayerFactory";
import { scheduleFitMapToExtent3857 } from "../../../_mapComponents/config/mapAutoNavigation";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../../_mapComponents/config/mapDefaults";
import { CONS_DATA_AS_WMS_LAYER_IDS } from "./consDataAsLayerId";

/** 공사대장 WMS — 본표·필지 레이어 켜기 */
export function ensureConsDataAsWmsLayersVisible(
  setVisibleLayerNames?: (updater: (prev: Set<string>) => Set<string>) => void
): void {
  if (!setVisibleLayerNames) return;
  const layerIds = CONS_DATA_AS_WMS_LAYER_IDS.map((id) => id.toLowerCase());
  setVisibleLayerNames((prev) => {
    const next = new Set(prev);
    let changed = false;
    for (const lid of layerIds) {
      if (!next.has(lid)) {
        next.add(lid);
        changed = true;
      }
    }
    return changed ? next : prev;
  });
}

/** 저장·상세 갱신 후 WMS·뷰 동기화 (하천점용과 동일) */
export async function refreshConsDataAsMapView(opts: {
  map: Map | null | undefined;
  consCode: string;
  setVisibleLayerNames?: (updater: (prev: Set<string>) => Set<string>) => void;
  applyMapViewPadding?: (() => void) | null;
}): Promise<void> {
  const key = String(opts.consCode ?? "").trim();
  if (!key) return;

  ensureConsDataAsWmsLayersVisible(opts.setVisibleLayerNames);
  refreshServiceWmsLayer(opts.map);
  requestAnimationFrame(() => refreshServiceWmsLayer(opts.map));

  try {
    const res = await call("", "POST", {
      service: "consDataAsService",
      action: "getExtent3857ByConsCode",
      params: { consCode: key },
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
