'use client'

import { useEffect, useRef } from 'react'
import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Icon, Style } from 'ol/style'
import type { StyleFunction } from 'ol/style/Style'
import { fromLonLat } from 'ol/proj'
import {
  DATA_QUERY_SELECTION_PULSE_STEP,
  insertLayerBelowServiceLayer,
} from '@/lib/mapDataQueryMapHighlight'
import { useMapContext } from '../../_mapComponents/MapContext'
import { scheduleAnimateMapToCenter3857 } from '../../_mapComponents/config/mapAutoNavigation'

export type OdorMapRadarColor = 'red' | 'blue'

const RADAR_CANVAS_SIZE = 120
const RADAR_RADIUS = 52

const RGB: Record<OdorMapRadarColor, readonly [number, number, number]> = {
  red: [220, 38, 38],
  blue: [37, 99, 235],
}

function createRadarStyle(
  getPulsePhase: () => number,
  color: OdorMapRadarColor
): StyleFunction {
  const [r, g, b] = RGB[color]
  return () => {
    const phase = getPulsePhase()
    const pulse = 0.7 + 0.4 * Math.sin(phase)
    const canvas = document.createElement('canvas')
    canvas.width = RADAR_CANVAS_SIZE
    canvas.height = RADAR_CANVAS_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return new Style({})
    const cx = RADAR_CANVAS_SIZE / 2
    const cy = RADAR_CANVAS_SIZE / 2
    const radius = RADAR_RADIUS * pulse
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.5 + 0.3 * Math.sin(phase)})`)
    gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.2)`)
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`)
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.lineWidth = 2
    ctx.stroke()
    return new Style({
      image: new Icon({
        img: canvas,
        width: RADAR_CANVAS_SIZE,
        height: RADAR_CANVAS_SIZE,
        anchor: [0.5, 0.5],
      }),
    })
  }
}

type Options = {
  enabled: boolean
  lon: number | null | undefined
  lat: number | null | undefined
  color: OdorMapRadarColor
  layerName: string
  /** 좌표가 바뀌면 지도 이동 (기본 false) */
  flyTo?: boolean
}

/** 악취 지도 — lon/lat 1점에 빨강/파랑 레이더 펄스 하이라이트 */
export function useOdorMapPointRadarHighlight({
  enabled,
  lon,
  lat,
  color,
  layerName,
  flyTo = false,
}: Options) {
  const mapContext = useMapContext()
  const map = mapContext?.mapInstanceRef?.current ?? null
  const mapReady = mapContext?.mapReady
  const sourceRef = useRef<VectorSource | null>(null)
  const pulsePhaseRef = useRef(0)
  const lastFlownKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !mapReady || !map) return

    const source = new VectorSource()
    sourceRef.current = source
    const layer = new VectorLayer({
      source,
      style: createRadarStyle(() => pulsePhaseRef.current, color),
      zIndex: 26,
    })
    layer.set('name', layerName)
    insertLayerBelowServiceLayer(map, layer)

    return () => {
      map.removeLayer(layer)
      sourceRef.current = null
    }
  }, [enabled, map, mapReady, color, layerName])

  useEffect(() => {
    const source = sourceRef.current
    if (!enabled || !source || !map) return

    source.clear()
    const ok =
      lon != null &&
      lat != null &&
      Number.isFinite(lon) &&
      Number.isFinite(lat)
    if (!ok) {
      lastFlownKeyRef.current = null
      return
    }

    const center3857 = fromLonLat([lon, lat]) as [number, number]
    source.addFeature(
      new Feature({
        geometry: new Point(center3857),
      })
    )

    let pulseRaf = 0
    const loop = () => {
      pulsePhaseRef.current += DATA_QUERY_SELECTION_PULSE_STEP
      source.changed()
      pulseRaf = requestAnimationFrame(loop)
    }
    pulseRaf = requestAnimationFrame(loop)

    const flyKey = `${color}:${lon},${lat}`
    if (flyTo && lastFlownKeyRef.current !== flyKey) {
      lastFlownKeyRef.current = flyKey
      const zoom = Math.max(map.getView().getZoom() ?? 14, 15)
      scheduleAnimateMapToCenter3857(map, center3857, zoom, {
        applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
      })
    }

    return () => cancelAnimationFrame(pulseRaf)
  }, [enabled, lon, lat, color, flyTo, map, mapContext])
}
