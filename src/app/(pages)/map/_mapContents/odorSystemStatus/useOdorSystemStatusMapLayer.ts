'use client'

import '@/app/(pages)/map/_mapComponents/config/projections'
import { useEffect, useRef } from 'react'
import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from 'ol/style'
import { fromLonLat, transform } from 'ol/proj'
import { insertLayerBelowServiceLayer } from '@/lib/mapDataQueryMapHighlight'
import { MOCK_ODOR_SENSORS_FROM_DB } from '@/service/odorSensorMock'
import { useMapContext } from '../../_mapComponents/MapContext'
import {
  ODOR_SYSTEM_STATUS_INFRA_SITE_5181,
  ODOR_SYSTEM_STATUS_INFRA_MARKERS,
} from './odorSystemStatusConfig'

const LAYER_NAME = 'odorSystemStatusMapPoints'

function infraStyle(label: string) {
  return new Style({
    image: new CircleStyle({
      radius: 8,
      fill: new Fill({ color: 'rgba(37, 99, 235, 0.95)' }),
      stroke: new Stroke({ color: '#fff', width: 2 }),
    }),
    text: new Text({
      text: label,
      font: '600 11px sans-serif',
      offsetY: -16,
      fill: new Fill({ color: '#1e3a8a' }),
      stroke: new Stroke({ color: 'rgba(255,255,255,0.92)', width: 3 }),
    }),
  })
}

function sensorStyle(label: string) {
  return new Style({
    image: new CircleStyle({
      radius: 5,
      fill: new Fill({ color: 'rgba(16, 185, 129, 0.9)' }),
      stroke: new Stroke({ color: '#fff', width: 1.5 }),
    }),
    text: label
      ? new Text({
          text: label,
          font: '10px sans-serif',
          offsetY: -12,
          fill: new Fill({ color: '#064e3b' }),
          stroke: new Stroke({ color: 'rgba(255,255,255,0.9)', width: 3 }),
        })
      : undefined,
  })
}

type Options = {
  enabled: boolean
  /** 하이라이트할 노드 id (센서·인프라) */
  highlightId?: string | null
}

/** 시스템 상태•통신 — 죽도 인프라 + 센서 포인트 */
export function useOdorSystemStatusMapLayer({ enabled, highlightId = null }: Options) {
  const mapContext = useMapContext()
  const map = mapContext?.mapInstanceRef?.current ?? null
  const mapReady = mapContext?.mapReady
  const sourceRef = useRef<VectorSource | null>(null)

  useEffect(() => {
    if (!enabled || !mapReady || !map) return

    const source = new VectorSource()
    sourceRef.current = source
    const layer = new VectorLayer({
      source,
      style: (feature) => {
        const kind = String(feature.get('pointKind') ?? 'sensor')
        const label = String(feature.get('label') ?? '')
        const selected = Boolean(feature.get('selected'))
        const base = kind === 'infra' ? infraStyle(label) : sensorStyle(label)
        if (!selected) return base
        const image = base.getImage()
        if (image instanceof CircleStyle) {
          return new Style({
            image: new CircleStyle({
              radius: (image.getRadius() ?? 6) + 2,
              fill: image.getFill() ?? undefined,
              stroke: new Stroke({ color: '#f59e0b', width: 3 }),
            }),
            text: base.getText() ?? undefined,
          })
        }
        return base
      },
      zIndex: 26,
    })
    layer.set('name', LAYER_NAME)
    insertLayerBelowServiceLayer(map, layer)

    return () => {
      map.removeLayer(layer)
      sourceRef.current = null
    }
  }, [enabled, map, mapReady])

  useEffect(() => {
    const source = sourceRef.current
    if (!enabled || !source) return
    source.clear()

    for (const m of ODOR_SYSTEM_STATUS_INFRA_MARKERS) {
      const [x, y] = transform(
        [
          ODOR_SYSTEM_STATUS_INFRA_SITE_5181[0] + m.offsetX,
          ODOR_SYSTEM_STATUS_INFRA_SITE_5181[1] + m.offsetY,
        ],
        'EPSG:5181',
        'EPSG:3857'
      )
      const f = new Feature({
        geometry: new Point([x, y]),
        pointKind: 'infra',
        label: m.label,
        nodeId: m.nodeId,
        selected: highlightId === m.nodeId,
      })
      f.setId(m.nodeId)
      source.addFeature(f)
    }

    for (const s of MOCK_ODOR_SENSORS_FROM_DB) {
      const id = `comm-sensor-${s.sensorKey}`
      const f = new Feature({
        geometry: new Point(fromLonLat([s.lon, s.lat])),
        pointKind: 'sensor',
        label: s.sensorKorNm,
        nodeId: id,
        sensorKey: s.sensorKey,
        selected: highlightId === id,
      })
      f.setId(id)
      source.addFeature(f)
    }
  }, [enabled, highlightId])
}
