'use client'

import type { Map as OLMap } from 'ol'
import GeoJSON from 'ol/format/GeoJSON'
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../../_mapComponents/config/mapDefaults'
import {
  prepareMapForPanelAwareNavigation,
  scheduleFitMapToExtent3857,
} from '../../../_mapComponents/config/mapAutoNavigation'

function normalizeFlyGeom(geom: unknown): object | null {
  if (!geom) return null
  if (typeof geom === 'object') return geom as object
  if (typeof geom === 'string') {
    try {
      const parsed = JSON.parse(geom) as unknown
      return parsed && typeof parsed === 'object' ? (parsed as object) : null
    } catch {
      return null
    }
  }
  return null
}

function readGeomExtent3857(geom: unknown): [number, number, number, number] | null {
  const geo = normalizeFlyGeom(geom)
  if (!geo) return null
  try {
    const olGeom = new GeoJSON().readGeometry(geo, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857',
    })
    const extent = olGeom?.getExtent()
    if (!extent || extent.length !== 4 || extent.some((n) => !Number.isFinite(n))) {
      return null
    }
    return [extent[0]!, extent[1]!, extent[2]!, extent[3]!]
  } catch {
    return null
  }
}

/** GeoJSON(EPSG:4326) → extent fit (시설목록 행 선택용) */
export function flyToWtlNetworkGeom(
  map: OLMap | null | undefined,
  geom: unknown,
  applyMapViewPadding?: (() => void) | null
): boolean {
  if (!map) return false
  const extent = readGeomExtent3857(geom)
  if (!extent) return false
  scheduleFitMapToExtent3857(map, extent, {
    maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
    applyMapViewPadding: applyMapViewPadding ?? undefined,
  })
  return true
}

/** GeoJSON(EPSG:4326) → 도형 중심으로 맵 센터만 이동 (단면도 범례 등) */
export function centerMapOnWtlNetworkGeom(
  map: OLMap | null | undefined,
  geom: unknown,
  applyMapViewPadding?: (() => void) | null
): boolean {
  if (!map) return false
  const extent = readGeomExtent3857(geom)
  if (!extent) return false
  const center: [number, number] = [
    (extent[0] + extent[2]) / 2,
    (extent[1] + extent[3]) / 2,
  ]
  queueMicrotask(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        prepareMapForPanelAwareNavigation(map, applyMapViewPadding ?? undefined)
        map.getView().animate({ center, duration: 450 })
      })
    })
  })
  return true
}
