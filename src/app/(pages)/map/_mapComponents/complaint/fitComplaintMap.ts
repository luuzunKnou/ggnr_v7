import type Map from 'ol/Map';
import { scheduleFitMapToExtent3857 } from '../config/mapAutoNavigation';
import { MAP_AUTO_NAV_MAX_ZOOM } from '../config/mapDefaults';

/** 민원 위치 extent(EPSG:3857)로 지도 이동 (점이면 pointZoom) */
export function fitMapToComplaintExtent3857(
  map: Map | null | undefined,
  extent: unknown,
  applyMapViewPadding?: () => void
): void {
  if (
    !map ||
    !Array.isArray(extent) ||
    extent.length !== 4 ||
    !extent.every((v) => Number.isFinite(Number(v)))
  ) {
    return;
  }
  scheduleFitMapToExtent3857(map, extent.map(Number) as [number, number, number, number], {
    maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
    pointZoom: 17,
    applyMapViewPadding,
  });
}
