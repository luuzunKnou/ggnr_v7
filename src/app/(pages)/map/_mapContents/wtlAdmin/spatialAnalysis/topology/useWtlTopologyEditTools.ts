'use client'

import { useEffect, useRef } from 'react'
import Feature from 'ol/Feature'
import { LineString, Point } from 'ol/geom'
import Draw from 'ol/interaction/Draw'
import Modify from 'ol/interaction/Modify'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Circle, Fill, Stroke, Style } from 'ol/style'
import { transform } from 'ol/proj'
import GeoJSON from 'ol/format/GeoJSON'
import '../../../../_mapComponents/config/projections'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import type { WtlTopoIssue } from './wtlTopologySample'

export type WtlTopoEditTool = 'idle' | 'modify' | 'draw_line' | 'draw_point'

type Props = {
  active: boolean
  tool: WtlTopoEditTool
  issue: WtlTopoIssue | null
  onDraftChange: (geojson: object | null) => void
}

function to3857(coord: [number, number]): [number, number] {
  const [x, y] = transform(coord, 'EPSG:4326', 'EPSG:3857')
  return [x, y]
}

export function useWtlTopologyEditTools({ active, tool, issue, onDraftChange }: Props) {
  const mapContext = useMapContext()
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const sourceRef = useRef<VectorSource | null>(null)
  const drawRef = useRef<Draw | null>(null)
  const modifyRef = useRef<Modify | null>(null)
  const onDraftRef = useRef(onDraftChange)
  onDraftRef.current = onDraftChange

  const emitDraft = (source: VectorSource) => {
    const features = source.getFeatures()
    if (features.length === 0) {
      onDraftRef.current(null)
      return
    }
    const format = new GeoJSON()
    const geo = format.writeFeaturesObject(features, {
      featureProjection: 'EPSG:3857',
      dataProjection: 'EPSG:4326',
    })
    // single geometry preferred
    if (geo.features?.length === 1) {
      onDraftRef.current((geo.features[0]!.geometry as object) ?? null)
    } else {
      onDraftRef.current(geo as object)
    }
  }

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady || !active) return

    const source = new VectorSource()
    const layer = new VectorLayer({
      source,
      zIndex: 950,
      style: new Style({
        stroke: new Stroke({ color: '#2563eb', width: 2 }),
        image: new Circle({
          radius: 7,
          fill: new Fill({ color: 'rgba(37,99,235,0.15)' }),
          stroke: new Stroke({ color: '#2563eb', width: 1.5 }),
        }),
      }),
    })
    layer.set('wtlTopoEdit', true)
    map.addLayer(layer)
    layerRef.current = layer
    sourceRef.current = source

    return () => {
      if (drawRef.current) {
        map.removeInteraction(drawRef.current)
        drawRef.current = null
      }
      if (modifyRef.current) {
        map.removeInteraction(modifyRef.current)
        modifyRef.current = null
      }
      map.removeLayer(layer)
      layerRef.current = null
      sourceRef.current = null
    }
  }, [active, mapContext?.mapReady, mapContext?.mapInstanceRef])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    const source = sourceRef.current
    if (!map || !source) return

    if (drawRef.current) {
      map.removeInteraction(drawRef.current)
      drawRef.current = null
    }
    if (modifyRef.current) {
      map.removeInteraction(modifyRef.current)
      modifyRef.current = null
    }
    source.clear()
    onDraftRef.current(null)

    if (!active || tool === 'idle' || !issue) return

    if (tool === 'modify') {
      if (issue.line && issue.line.length >= 2) {
        source.addFeature(new Feature({ geometry: new LineString(issue.line.map(to3857)) }))
      } else {
        source.addFeature(new Feature({ geometry: new Point(to3857(issue.point)) }))
      }
      const modify = new Modify({ source })
      modify.on('modifyend', () => emitDraft(source))
      map.addInteraction(modify)
      modifyRef.current = modify
      emitDraft(source)
      return
    }

    const type = tool === 'draw_line' ? 'LineString' : 'Point'
    const draw = new Draw({ source, type })
    draw.on('drawend', () => {
      // 한 도형만 유지
      const feats = source.getFeatures()
      if (feats.length > 1) {
        feats.slice(0, -1).forEach((f) => source.removeFeature(f))
      }
      emitDraft(source)
    })
    map.addInteraction(draw)
    drawRef.current = draw
  }, [active, tool, issue, mapContext?.mapInstanceRef])
}
