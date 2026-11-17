import type Map from "ol/Map";
import { call } from "@/lib/api";
import type { ConsLedgerKind } from "@/lib/consLedgerVariant";
import { refreshServiceWmsLayer } from "../../../_mapComponents/layerFactory/serviceLayerFactory";
import { scheduleFitMapToExtent3857 } from "../../../_mapComponents/config/mapAutoNavigation";
import { MAP_AUTO_NAV_MAX_ZOOM } from "../../../_mapComponents/config/mapDefaults";
import { consLedgerWmsLayerIds } from "./consDataAsLayerId";

/**
 * 공사대장 WMS — 기본은 본표만 켜고 필지(solo)는 끔 (하천점용과 동일).
 * includeChildren=true 일 때만 필지 레이어를 함께 켠다.
 */
export function ensureConsDataAsWmsLayersVisible(
  setVisibleLayerNames?: (updater: (prev: Set<string>) => Set<string>) => void,
  opts?: { includeChildren?: boolean; kind?: ConsLedgerKind }
): void {
  if (!setVisibleLayerNames) return;
  const ids = consLedgerWmsLayerIds(opts?.kind);
  const mainId = ids.main.toLowerCase();
  const childIds = [ids.solo.toLowerCase()];
  const includeChildren = opts?.includeChildren === true;
  setVisibleLayerNames((prev) => {
    const next = new Set(prev);
    let changed = false;
    if (!next.has(mainId)) {
      next.add(mainId);
      changed = true;
    }
    if (includeChildren) {
      for (const lid of childIds) {
        if (!next.has(lid)) {
          next.add(lid);
          changed = true;
        }
      }
    } else {
      for (const lid of childIds) {
        if (next.delete(lid)) changed = true;
      }
    }
    return changed ? next : prev;
  });
}

/** 공사대장 패널 종료 시 WMS 끄기 */
export function clearConsDataAsWmsLayers(
  setVisibleLayerNames?: (updater: (prev: Set<string>) => Set<string>) => void,
  kind?: ConsLedgerKind
): void {
  if (!setVisibleLayerNames) return;
  const ids = consLedgerWmsLayerIds(kind);
  const lower = [ids.main, ids.solo].map((id) => id.toLowerCase());
  setVisibleLayerNames((prev) => {
    let changed = false;
    const next = new Set(prev);
    for (const lid of lower) {
      if (next.delete(lid)) changed = true;
    }
    return changed ? next : prev;
  });
}

/** 저장·상세 갱신 후 WMS·뷰 동기화 (하천점용과 동일) */
export async function refreshConsDataAsMapView(opts: {
  map: Map | null | undefined;
  consCode: string;
  kind?: ConsLedgerKind;
  setVisibleLayerNames?: (updater: (prev: Set<string>) => Set<string>) => void;
  applyMapViewPadding?: (() => void) | null;
}): Promise<void> {
  const key = String(opts.consCode ?? "").trim();
  if (!key) return;

  ensureConsDataAsWmsLayersVisible(opts.setVisibleLayerNames, { kind: opts.kind });
  refreshServiceWmsLayer(opts.map);
  requestAnimationFrame(() => refreshServiceWmsLayer(opts.map));

  try {
    const res = await call("", "POST", {
      service: "consDataAsService",
      action: "getExtent3857ByConsCode",
      params: { kind: opts.kind, consCode: key },
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
