'use client'

import { useEffect, useRef } from 'react'
import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from 'ol/style'
import { fromLonLat } from 'ol/proj'
import type { OdorGradeStatus } from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
  insertLayerBelowServiceLayer,
} from '@/lib/mapDataQueryMapHighlight'
import { useMapContext } from '../../_mapComponents/MapContext'
import { scheduleAnimateMapToCenter3857 } from '../../_mapComponents/config/mapAutoNavigation'
import { ODOR_GRADE_POINT_FILL } from './odorDashboard2Config'
import type { OdorStationRow } from './odorDashboard2StationRows'

const LAYER_NAME = 'odorDashboard2GradePoints'
const HIGHLIGHT_NAME = 'odorDashboard2GradeHighlight'

function pointStyle(status: OdorGradeStatus, label: string) {
  return new Style({
    image: new CircleStyle({
      radius: 6,
      fill: new Fill({ color: ODOR_GRADE_POINT_FILL[status] }),
      stroke: new Stroke({ color: '#fff', width: 1.5 }),
    }),
    text: label
      ? new Text({
          text: label,
          font: '11px sans-serif',
          offsetY: -14,
          fill: new Fill({ color: '#fff' }),
          stroke: new Stroke({ color: 'rgba(0,0,0,0.75)', width: 3 }),
        })
      : undefined,
  })
}

type Options = {
  enabled: boolean
  rows: OdorStationRow[]
  selectedId: string | null
  /** 선택 시 지도 이동 */
  flyToSelected?: boolean
}

/** 대시보드2 — 본 지도에 등급 포인트(녹/주황/적) 등록 */
export function useOdorDashboard2GradeLayer({
  enabled,
  rows,
  selectedId,
  flyToSelected = true,
}: Options) {
  const mapContext = useMapContext()
  const map = mapContext?.mapInstanceRef?.current ?? null
  const mapReady = mapContext?.mapReady
  const sourceRef = useRef<VectorSource | null>(null)
  const highlightSourceRef = useRef<VectorSource | null>(null)
  const pulsePhaseRef = useRef(0)
  const lastFlownRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !mapReady || !map) return

    const source = new VectorSource()
    sourceRef.current = source
    const layer = new VectorLayer({
      source,
      style: (feature) => {
        const status = (feature.get('odorStatus') as OdorGradeStatus) || 'normal'
        const label = String(feature.get('label') ?? '')
        return pointStyle(status, label)
      },
      zIndex: 25,
    })
    layer.set('name', LAYER_NAME)
    insertLayerBelowServiceLayer(map, layer)

    const highlightSource = new VectorSource()
    highlightSourceRef.current = highlightSource
    let pulseRaf = 0
    const selectionStyle = createDataQuerySelectionRowHighlightStyle(
      () => pulsePhaseRef.current
    )
    const highlightLayer = new VectorLayer({
      source: highlightSource,
      style: selectionStyle,
      zIndex: 24,
    })
    highlightLayer.set('name', HIGHLIGHT_NAME)
    insertLayerBelowServiceLayer(map, highlightLayer)

    const startPulse = () => {
      if (pulseRaf) return
      const loop = () => {
        pulsePhaseRef.current += DATA_QUERY_SELECTION_PULSE_STEP
        highlightSource.changed()
        pulseRaf = requestAnimationFrame(loop)
      }
      pulseRaf = requestAnimationFrame(loop)
    }
    const stopPulse = () => {
      if (pulseRaf) {
        cancelAnimationFrame(pulseRaf)
        pulseRaf = 0
      }
    }

    return () => {
      stopPulse()
      map.removeLayer(layer)
      map.removeLayer(highlightLayer)
      sourceRef.current = null
      highlightSourceRef.current = null
    }
  }, [enabled, map, mapReady])

  useEffect(() => {
    const source = sourceRef.current
    if (!enabled || !source) return
    source.clear()
    for (const row of rows) {
      const f = new Feature({
        geometry: new Point(fromLonLat([row.lon, row.lat])),
        odorStatus: row.status,
        label: row.sensorKorNm,
        sensorKey: row.id,
      })
      f.setId(row.id)
      source.addFeature(f)
    }
  }, [enabled, rows])

  useEffect(() => {
    const highlightSource = highlightSourceRef.current
    const source = sourceRef.current
    if (!enabled || !highlightSource || !source || !map) return

    highlightSource.clear()
    if (!selectedId) {
      lastFlownRef.current = null
      return
    }
    const found = source.getFeatureById(selectedId)
    const geom = found?.getGeometry()
    if (!geom) return

    const hl = new Feature({
      geometry: geom.clone(),
      isRadarPoint: true,
    })
    highlightSource.addFeature(hl)

    let pulseRaf = 0
    const loop = () => {
      pulsePhaseRef.current += DATA_QUERY_SELECTION_PULSE_STEP
      highlightSource.changed()
      pulseRaf = requestAnimationFrame(loop)
    }
    pulseRaf = requestAnimationFrame(loop)

    if (flyToSelected && lastFlownRef.current !== selectedId) {
      lastFlownRef.current = selectedId
      const extent = geom.getExtent()
      const center: [number, number] = [
        (extent[0] + extent[2]) / 2,
        (extent[1] + extent[3]) / 2,
      ]
      const zoom = Math.max(map.getView().getZoom() ?? 14, 15)
      scheduleAnimateMapToCenter3857(map, center, zoom, {
        applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
      })
    }

    return () => cancelAnimationFrame(pulseRaf)
  }, [enabled, selectedId, flyToSelected, map, mapContext, rows])
}
