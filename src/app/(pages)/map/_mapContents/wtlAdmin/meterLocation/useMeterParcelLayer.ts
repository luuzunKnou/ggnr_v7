'use client'

import { useEffect, useRef } from 'react'
import type Map from 'ol/Map'
import GeoJSON from 'ol/format/GeoJSON'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Circle, Fill, Stroke, Style, Text } from 'ol/style'
import { createEmpty, extend as extendExtent, isEmpty } from 'ol/extent'
import {
  prepareMapForPanelAwareNavigation,
  scheduleFitMapToExtent3857,
} from '../../../_mapComponents/config/mapAutoNavigation'
import { SCALE_BAR_PX } from '../../../_mapComponents/hooks/mapScale'
import { useMapContext } from '../../../_mapComponents/MapContext'
import type { MeterLocateResult } from './locateMeterAddresses'

/** 구역 이동 시 목표 축척막대(m) — 80~100 중간 */
const ZONE_TARGET_SCALE_M = 90
const ZONE_MIN_SCALE_M = 80
const ZONE_MAX_SCALE_M = 100

function labelText(label: string, offsetY: number): Text {
  return new Text({
    text: label,
    font: '12px sans-serif',
    fill: new Fill({ color: '#0f172a' }),
    stroke: new Stroke({ color: '#ffffff', width: 3 }),
    overflow: true,
    offsetY,
  })
}

function parcelStyle(label: string): Style {
  return new Style({
    fill: new Fill({ color: 'rgba(50, 118, 195, 0.35)' }),
    stroke: new Stroke({ color: '#1d4ed8', width: 2 }),
    text: labelText(label, 0),
  })
}

function pointStyle(label: string): Style {
  return new Style({
    image: new Circle({
      radius: 7,
      fill: new Fill({ color: 'rgba(50, 118, 195, 0.9)' }),
      stroke: new Stroke({ color: '#ffffff', width: 2 }),
    }),
    text: labelText(label, -16),
  })
}

/**
 * 구역 extent로 이동한 뒤 축척막대를 80~100m 밴드로 맞춘다.
 * extent가 크면 fit 우선(축소 허용), 작으면 목표 90m로 확대.
 */
function fitZoneExtentWithScaleBand(
  map: Map,
  extent: number[],
  applyMapViewPadding?: (() => void) | null
): void {
  prepareMapForPanelAwareNavigation(map, applyMapViewPadding)
  const view = map.getView()
  const size = map.getSize()
  if (!size || size[0] <= 0 || size[1] <= 0) return

  const fitPadding: [number, number, number, number] = [80, 80, 80, 80]
  const availW = Math.max(1, size[0] - fitPadding[1] - fitPadding[3])
  const availH = Math.max(1, size[1] - fitPadding[0] - fitPadding[2])
  let resolution = view.getResolutionForExtent(extent as [number, number, number, number], [
    availW,
    availH,
  ])
  if (!Number.isFinite(resolution) || resolution <= 0) return

  const scaleAtFit = resolution * SCALE_BAR_PX
  const maxRes = ZONE_MAX_SCALE_M / SCALE_BAR_PX
  const minRes = ZONE_MIN_SCALE_M / SCALE_BAR_PX
  const targetRes = ZONE_TARGET_SCALE_M / SCALE_BAR_PX

  if (scaleAtFit > ZONE_MAX_SCALE_M) {
    // 구역이 커서 100m보다 더 축소해야 함 — fit 유지
  } else if (scaleAtFit < ZONE_MIN_SCALE_M) {
    resolution = targetRes
  } else {
    resolution = Math.min(maxRes, Math.max(minRes, resolution))
  }

  const cx = (extent[0]! + extent[2]!) / 2
  const cy = (extent[1]! + extent[3]!) / 2
  view.animate({
    center: [cx, cy],
    resolution,
    duration: 500,
  })
}

export function useMeterParcelLayer(
  rows: MeterLocateResult[],
  focusId: string | null,
  zoneFocusKey: string | null,
  zoneRowIds: string[] | null
) {
  const mapContext = useMapContext()
  const sourceRef = useRef<VectorSource | null>(null)

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map) return

    const source = new VectorSource()
    sourceRef.current = source
    const layer = new VectorLayer({ source, declutter: true, zIndex: 860 })
    layer.set('wtlMeterParcels', true)
    map.addLayer(layer)

    const drawn = rows.filter(
      (row) =>
        (row.status === 'shown' && row.geometry4326) ||
        (row.status === 'point' && row.point4326)
    )
    if (drawn.length > 0) {
      try {
        const features = new GeoJSON().readFeatures(
          {
            type: 'FeatureCollection',
            features: drawn.map((row) => ({
              type: 'Feature',
              geometry:
                row.geometry4326 ??
                (row.point4326
                  ? { type: 'Point', coordinates: row.point4326 }
                  : null),
              properties: { label: row.input, rowId: row.id, kind: row.status },
            })),
          },
          { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }
        )
        for (const feature of features) {
          const rowId = String(feature.get('rowId') ?? '')
          const label = String(feature.get('label') ?? '')
          feature.setId(rowId)
          feature.setStyle(
            feature.get('kind') === 'point' ? pointStyle(label) : parcelStyle(label)
          )
        }
        source.addFeatures(features)
        const extent = source.getExtent()
        if (extent.every((value) => Number.isFinite(value))) {
          scheduleFitMapToExtent3857(map, extent, {
            maxZoom: 18,
            applyMapViewPadding: mapContext?.applyMapViewPaddingRef?.current,
          })
        }
      } catch {
        source.clear()
      }
    }

    return () => {
      sourceRef.current = null
      map.removeLayer(layer)
    }
  }, [mapContext?.applyMapViewPaddingRef, mapContext?.mapInstanceRef, mapContext?.mapReady, rows])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    const source = sourceRef.current
    if (!map || !source || !focusId) return
    const extent = source.getFeatureById(focusId)?.getGeometry()?.getExtent()
    if (!extent || !extent.every((value) => Number.isFinite(value))) return
    scheduleFitMapToExtent3857(map, extent, {
      maxZoom: 19,
      applyMapViewPadding: mapContext?.applyMapViewPaddingRef?.current,
    })
  }, [focusId, mapContext?.applyMapViewPaddingRef, mapContext?.mapInstanceRef])

  useEffect(() => {
    if (!zoneFocusKey || !zoneRowIds || zoneRowIds.length === 0) return
    const map = mapContext?.mapInstanceRef?.current
    const source = sourceRef.current
    if (!map || !source) return

    const extent = createEmpty()
    for (const id of zoneRowIds) {
      const geom = source.getFeatureById(id)?.getGeometry()
      if (!geom) continue
      extendExtent(extent, geom.getExtent())
    }
    if (isEmpty(extent) || !extent.every((v) => Number.isFinite(v))) return

    const run = () => {
      fitZoneExtentWithScaleBand(map, extent, mapContext?.applyMapViewPaddingRef?.current)
    }
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(run)
      })
    })
  }, [
    zoneFocusKey,
    zoneRowIds,
    mapContext?.applyMapViewPaddingRef,
    mapContext?.mapInstanceRef,
  ])
}
