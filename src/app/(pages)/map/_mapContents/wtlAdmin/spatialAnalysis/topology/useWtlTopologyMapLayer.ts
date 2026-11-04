'use client'

import { useEffect, useRef } from 'react'
import Feature from 'ol/Feature'
import { Point } from 'ol/geom'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Circle, Fill, Stroke, Style } from 'ol/style'
import { transform } from 'ol/proj'
import '../../../../_mapComponents/config/projections'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import type { WtlTopoResult } from './wtlTopologySample'

/** 채움 없는 원 테두리만 (관로 선은 그리지 않음) */
const STROKE = 'rgba(30, 41, 59, 0.75)'
const STROKE_SELECTED = 'rgba(15, 23, 42, 1)'

function to3857(coord: [number, number]): [number, number] {
  const [x, y] = transform(coord, 'EPSG:4326', 'EPSG:3857')
  return [x, y]
}

type Props = {
  active: boolean
  result: WtlTopoResult | null
  selectedId: string | null
  visibleIds: Set<string> | null
}

export function useWtlTopologyMapLayer({ active, result, selectedId, visibleIds }: Props) {
  const mapContext = useMapContext()
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady || !active) return

    const source = new VectorSource()
    const layer = new VectorLayer({
      source,
      zIndex: 940,
      style: (feature) => {
        const selected = String(feature.get('issueId') ?? '') === selectedRef.current
        return new Style({
          image: new Circle({
            radius: selected ? 12 : 10,
            fill: new Fill({ color: 'rgba(0,0,0,0)' }),
            stroke: new Stroke({
              color: selected ? STROKE_SELECTED : STROKE,
              width: selected ? 2 : 1.5,
            }),
          }),
        })
      },
    })
    layer.set('wtlTopology', true)
    map.addLayer(layer)
    layerRef.current = layer

    return () => {
      map.removeLayer(layer)
      layerRef.current = null
    }
  }, [active, mapContext?.mapReady, mapContext?.mapInstanceRef])

  useEffect(() => {
    const source = layerRef.current?.getSource()
    if (!source) return
    source.clear()
    if (!result) return

    for (const issue of result.issues) {
      if (visibleIds && !visibleIds.has(issue.id)) continue
      const pt = new Feature({ geometry: new Point(to3857(issue.point)) })
      pt.setId(issue.id)
      pt.set('issueId', issue.id)
      source.addFeature(pt)
    }
    layerRef.current?.changed()
  }, [result, visibleIds])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !selectedId || !result) {
      layerRef.current?.changed()
      return
    }
    const issue = result.issues.find((i) => i.id === selectedId)
    if (issue) {
      map.getView().animate({
        center: to3857(issue.point),
        zoom: Math.max(map.getView().getZoom() ?? 14, 16),
        duration: 400,
      })
    }
    layerRef.current?.changed()
  }, [selectedId, result, mapContext?.mapInstanceRef])
}
