'use client'

import { useEffect, useRef, useState } from 'react'
import type { Map as OLMap } from 'ol'
import GeoJSON from 'ol/format/GeoJSON'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
  insertLayerBelowServiceLayer,
} from '@/lib/mapDataQueryMapHighlight'
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder'
import '../../../_mapComponents/config/projections'
import { useMapContext } from '../../../_mapComponents/MapContext'
import type { WtlFacilityListRow } from './WtlFacilityListView'

function normalizeGeom(geom: unknown): Record<string, unknown> | null {
  let g: unknown = geom
  if (typeof g === 'string') {
    try {
      g = JSON.parse(g)
    } catch {
      return null
    }
  }
  if (!g || typeof g !== 'object' || !('type' in g) || !('coordinates' in g)) {
    return null
  }
  return g as Record<string, unknown>
}

function selectionFeatures(map: OLMap, geom: unknown) {
  const normalized = normalizeGeom(geom)
  if (!normalized) return []
  const viewProj = map.getView().getProjection()?.getCode() || 'EPSG:3857'
  const features = new GeoJSON().readFeatures(
    {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: normalized, properties: {} }],
    },
    { dataProjection: 'EPSG:4326', featureProjection: viewProj }
  )
  if (features.length === 0) return []
  const geomType = features[0].getGeometry()?.getType()
  if (geomType === 'Point' || geomType === 'MultiPoint') {
    features[0].set('isRadarPoint', true)
  }
  return features
}

/** 시설 목록 선택 — 지도 이동 + 선택 오버레이(펄스) */
export function useWtlFacilityMapHighlight(selected: WtlFacilityListRow | null) {
  const mapContext = useMapContext()
  const sourceRef = useRef<VectorSource | null>(null)
  const pulsePhaseRef = useRef(0)
  const [radarActive, setRadarActive] = useState(false)

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return
    const source = new VectorSource()
    sourceRef.current = source
    const layer = new VectorLayer({
      source,
      renderOrder: compareFeaturesByGeometryStackOrder,
      style: createDataQuerySelectionRowHighlightStyle(() => pulsePhaseRef.current),
    })
    layer.set('wtlFacilityHighlight', true)
    insertLayerBelowServiceLayer(map, layer)
    return () => {
      map.removeLayer(layer)
      sourceRef.current = null
      setRadarActive(false)
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady])

  useEffect(() => {
    if (!radarActive) return
    let rafId = 0
    const loop = () => {
      pulsePhaseRef.current += DATA_QUERY_SELECTION_PULSE_STEP
      sourceRef.current?.changed()
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [radarActive])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    const source = sourceRef.current
    if (!map || !source) return
    source.clear()
    setRadarActive(false)
    const geom = selected?.geom ?? null
    const features = selectionFeatures(map, geom)
    if (features.length === 0) return
    source.addFeatures(features)
    setRadarActive(true)
  }, [selected, mapContext?.mapInstanceRef, mapContext?.mapReady])
}
