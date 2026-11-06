'use client'

import { useEffect, useRef } from 'react'
import WKT from 'ol/format/WKT'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Fill, Stroke, Style } from 'ol/style'
import '../../../_mapComponents/config/projections'
import { scheduleFitMapToExtent3857 } from '../../../_mapComponents/config/mapAutoNavigation'
import { useMapContext } from '../../../_mapComponents/MapContext'
import type { WtlConsWork } from './wtlConsSample'

const FILL = 'rgba(37, 99, 235, 0.28)'
const STROKE = '#1d4ed8'

function zoneStyle(): Style {
  return new Style({
    fill: new Fill({ color: FILL }),
    stroke: new Stroke({ color: STROKE, width: 2.5 }),
  })
}

/** 선택 공사 구역(5181 WKT)을 지도에 표시한다. */
export function useWtlConsMapLayer(work: WtlConsWork | null) {
  const mapContext = useMapContext()
  const sourceRef = useRef<VectorSource | null>(null)

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return

    const source = new VectorSource()
    sourceRef.current = source
    const layer = new VectorLayer({
      source,
      style: zoneStyle,
      zIndex: 890,
    })
    layer.set('wtlConsZone', true)
    map.addLayer(layer)

    return () => {
      sourceRef.current = null
      map.removeLayer(layer)
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    const source = sourceRef.current
    if (!map || !source) return
    source.clear()
    const wkt = work?.geomWkt5181?.trim()
    if (!wkt) return
    try {
      const feature = new WKT().readFeature(wkt, {
        dataProjection: 'EPSG:5181',
        featureProjection: 'EPSG:3857',
      })
      if (!feature) return
      feature.setId(work?.id ?? 'zone')
      source.addFeature(feature)
      const extent = source.getExtent()
      if (extent.every((v) => Number.isFinite(v))) {
        scheduleFitMapToExtent3857(map, extent, {
          maxZoom: 18,
          applyMapViewPadding: mapContext?.applyMapViewPaddingRef?.current,
        })
      }
    } catch {
      source.clear()
    }
  }, [work, mapContext?.applyMapViewPaddingRef, mapContext?.mapInstanceRef])
}
