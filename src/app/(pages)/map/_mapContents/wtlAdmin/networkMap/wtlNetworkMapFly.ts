'use client'

import type { Map as OLMap } from 'ol'
import GeoJSON from 'ol/format/GeoJSON'
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../../_mapComponents/config/mapDefaults'
import { scheduleFitMapToExtent3857 } from '../../../_mapComponents/config/mapAutoNavigation'

/** GeoJSON(EPSG:4326) → 지도 이동 (시설목록 행 선택용) */
export function flyToWtlNetworkGeom(
  map: OLMap | null | undefined,
  geom: unknown,
  applyMapViewPadding?: (() => void) | null
): boolean {
  if (!map || !geom || typeof geom !== 'object') return false
  try {
    const olGeom = new GeoJSON().readGeometry(geom, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857',
    })
    const extent = olGeom?.getExtent()
    if (!extent || extent.length !== 4 || extent.some((n) => !Number.isFinite(n))) {
      return false
    }
    scheduleFitMapToExtent3857(map, [extent[0]!, extent[1]!, extent[2]!, extent[3]!], {
      maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
      applyMapViewPadding: applyMapViewPadding ?? undefined,
    })
    return true
  } catch {
    return false
  }
}
