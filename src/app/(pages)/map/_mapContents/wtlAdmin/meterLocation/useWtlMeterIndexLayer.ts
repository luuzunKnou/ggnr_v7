'use client'

import { useEffect, useMemo, useRef } from 'react'
import Feature from 'ol/Feature'
import type { FeatureLike } from 'ol/Feature'
import Point from 'ol/geom/Point'
import VectorLayer from 'ol/layer/Vector'
import { fromLonLat } from 'ol/proj'
import VectorSource from 'ol/source/Vector'
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from 'ol/style'
import '../../../_mapComponents/config/projections'
import { useMapContext } from '../../../_mapComponents/MapContext'
import type { MeterZone } from './clusterMeterZones'
import type { MeterLocateResult } from './locateMeterAddresses'

/** 인쇄 캡처와 동일 — 표 번호 원 마커 */
function meterIndexStyle(feature: FeatureLike): Style {
  const idx = String(feature.get('index') ?? '')
  return new Style({
    image: new CircleStyle({
      radius: 12,
      fill: new Fill({ color: '#2563eb' }),
      stroke: new Stroke({ color: '#ffffff', width: 2.5 }),
    }),
    text: new Text({
      text: idx,
      font: 'bold 12px "Malgun Gothic","Apple SD Gothic Neo",sans-serif',
      fill: new Fill({ color: '#ffffff' }),
      textAlign: 'center',
      textBaseline: 'middle',
    }),
    zIndex: 30,
  })
}

type IndexPoint = {
  id: string
  index: number
  point4326: [number, number]
}

/**
 * 계량기위치 지도 — 인쇄와 같이 구역 내 번호 벡터만 표시 (WMS·계량기번호 라벨 없음).
 */
export function useWtlMeterIndexLayer(
  rows: MeterLocateResult[],
  selectedZoneId: string | null,
  zones: MeterZone[]
) {
  const mapContext = useMapContext()
  const sourceRef = useRef<VectorSource | null>(null)

  const rowById = useMemo(() => {
    const map = new Map<string, MeterLocateResult>()
    for (const row of rows) map.set(row.id, row)
    return map
  }, [rows])

  const points = useMemo((): IndexPoint[] => {
    const targetZones = selectedZoneId
      ? zones.filter((z) => z.zoneId === selectedZoneId && z.navigable)
      : zones.filter((z) => z.navigable)
    const out: IndexPoint[] = []
    for (const zone of targetZones) {
      zone.rowIds.forEach((rowId, idx) => {
        const row = rowById.get(rowId)
        if (!row || row.status === 'miss' || !row.point4326) return
        const lon = Number(row.point4326[0])
        const lat = Number(row.point4326[1])
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return
        out.push({
          id: row.id,
          index: idx + 1,
          point4326: [lon, lat],
        })
      })
    }
    return out
  }, [rowById, selectedZoneId, zones])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map) return

    const source = new VectorSource()
    sourceRef.current = source
    const layer = new VectorLayer({
      source,
      style: meterIndexStyle,
      zIndex: 920,
    })
    layer.set('wtlMeterIndex', true)
    map.addLayer(layer)

    return () => {
      sourceRef.current = null
      map.removeLayer(layer)
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady])

  useEffect(() => {
    const source = sourceRef.current
    if (!source) return
    source.clear()
    for (const p of points) {
      const feature = new Feature({
        geometry: new Point(fromLonLat(p.point4326)),
        index: p.index,
      })
      feature.setId(p.id)
      source.addFeature(feature)
    }
  }, [points])
}
