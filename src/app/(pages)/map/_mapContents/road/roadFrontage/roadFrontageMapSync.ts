import type Map from 'ol/Map';
import { call } from '@/lib/api';
import { refreshServiceWmsLayer } from '../../../_mapComponents/layerFactory/serviceLayerFactory';
import { scheduleFitMapToExtent3857 } from '../../../_mapComponents/config/mapAutoNavigation';
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../../_mapComponents/config/mapDefaults';
import {
  ROAD_FRONTAGE_BUILDING_WMS_LAYER_ID,
  ROAD_FRONTAGE_MARKER_ITEM_WMS_LAYER_ID,
} from './roadFrontageLayerId';

type SetVisible = (updater: (prev: Set<string>) => Set<string>) => void;

export type RoadFrontageWmsTarget = 'building' | 'marker' | 'both';

function layerIdsFor(target: RoadFrontageWmsTarget): string[] {
  if (target === 'building') return [ROAD_FRONTAGE_BUILDING_WMS_LAYER_ID];
  if (target === 'marker') return [ROAD_FRONTAGE_MARKER_ITEM_WMS_LAYER_ID];
  return [ROAD_FRONTAGE_BUILDING_WMS_LAYER_ID, ROAD_FRONTAGE_MARKER_ITEM_WMS_LAYER_ID];
}

export function ensureRoadFrontageWmsLayers(
  setVisibleLayerNames: SetVisible | null | undefined,
  target: RoadFrontageWmsTarget
) {
  if (!setVisibleLayerNames) return;
  const ids = layerIdsFor(target).map((id) => id.toLowerCase());
  setVisibleLayerNames((prev) => {
    let changed = false;
    const next = new Set(prev);
    for (const id of ids) {
      if (!next.has(id)) {
        next.add(id);
        changed = true;
      }
    }
    return changed ? next : prev;
  });
}

export function clearRoadFrontageWmsLayers(
  setVisibleLayerNames: SetVisible | null | undefined,
  target: RoadFrontageWmsTarget
) {
  if (!setVisibleLayerNames) return;
  const ids = new Set(layerIdsFor(target).map((id) => id.toLowerCase()));
  setVisibleLayerNames((prev) => {
    let changed = false;
    const next = new Set(prev);
    for (const id of ids) {
      if (next.delete(id)) changed = true;
    }
    return changed ? next : prev;
  });
}

export async function refreshRoadFrontageBuildingMapView(opts: {
  map: Map | null | undefined;
  ftrIdn: string;
  setVisibleLayerNames?: SetVisible | null;
  applyMapViewPadding?: (() => void) | null;
}) {
  const key = String(opts.ftrIdn ?? '').trim();
  if (!key) return;
  ensureRoadFrontageWmsLayers(opts.setVisibleLayerNames, 'building');
  refreshServiceWmsLayer(opts.map);
  requestAnimationFrame(() => refreshServiceWmsLayer(opts.map));
  try {
    const res = await call('', 'POST', {
      service: 'roadFrontageBuildingService',
      action: 'getExtent3857ByKey',
      params: { ftrIdn: key },
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

export async function refreshRoadFrontageMarkerMapView(opts: {
  map: Map | null | undefined;
  ledgerId: string;
  setVisibleLayerNames?: SetVisible | null;
  applyMapViewPadding?: (() => void) | null;
}) {
  const id = String(opts.ledgerId ?? '').trim();
  if (!id) return;
  ensureRoadFrontageWmsLayers(opts.setVisibleLayerNames, 'marker');
  refreshServiceWmsLayer(opts.map);
  requestAnimationFrame(() => refreshServiceWmsLayer(opts.map));
  try {
    const res = await call('', 'POST', {
      service: 'roadFrontageMarkerService',
      action: 'getExtent3857ByLedgerId',
      params: { id },
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
