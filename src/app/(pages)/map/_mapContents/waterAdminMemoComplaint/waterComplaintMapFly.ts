'use client'

import type { Map as OLMap } from 'ol'
import GeoJSON from 'ol/format/GeoJSON'
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../_mapComponents/config/mapDefaults'
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation'
import {
  animateComplaintToCenter3857,
  center3857FromExtent,
} from '../../_mapComponents/complaint/useComplaintMapClick'

export type WaterPlaceFocus = {
  detailKey: number
  extent3857: [number, number, number, number] | null
  geomGeoJson4326: Record<string, unknown> | null
}

export function flyToExtent3857(
  map: OLMap,
  extent: [number, number, number, number],
  applyMapViewPadding?: (() => void) | null
) {
  const [xmin, ymin, xmax, ymax] = extent
  const pointLike = Math.abs(xmax - xmin) < 1 && Math.abs(ymax - ymin) < 1
  if (pointLike) {
    const center = center3857FromExtent(extent)
    if (center) animateComplaintToCenter3857(map, center, applyMapViewPadding)
    return
  }
  scheduleFitMapToExtent3857(map, extent, {
    maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
    applyMapViewPadding: applyMapViewPadding ?? undefined,
  })
}

export function focusFromIdentifyGeom(geom: unknown): Omit<WaterPlaceFocus, 'detailKey'> | null {
  let geometry = geom
  if (typeof geometry === 'string') {
    try {
      geometry = JSON.parse(geometry) as unknown
    } catch {
      return null
    }
  }
  if (!geometry || typeof geometry !== 'object') return null
  try {
    const format = new GeoJSON()
    const feature = format.readFeature(
      { type: 'Feature', geometry, properties: {} },
      { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }
    )
    const extent = feature.getGeometry()?.getExtent()
    if (!extent || extent.length !== 4 || extent.some((n) => !Number.isFinite(n))) return null
    return {
      extent3857: [extent[0]!, extent[1]!, extent[2]!, extent[3]!],
      geomGeoJson4326: geometry as Record<string, unknown>,
    }
  } catch {
    return null
  }
}
