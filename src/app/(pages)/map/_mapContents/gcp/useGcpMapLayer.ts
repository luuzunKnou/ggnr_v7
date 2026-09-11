'use client'

import { useEffect, useRef, useState } from 'react'
import type { MapBrowserEvent } from 'ol'
import Feature from 'ol/Feature'
import { boundingExtent } from 'ol/extent'
import Point from 'ol/geom/Point'
import VectorLayer from 'ol/layer/Vector'
import { transform } from 'ol/proj'
import VectorSource from 'ol/source/Vector'
import { Circle, Fill, Stroke, Style } from 'ol/style'
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
  insertLayerBelowServiceLayer,
} from '@/lib/mapDataQueryMapHighlight'
import '../../_mapComponents/config/projections'
import { useMapContext } from '../../_mapComponents/MapContext'
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation'
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../_mapComponents/config/mapDefaults'
import { mapColorOf, type GcpPoint } from './gcpDummyData'

const GCP_DRAFT_ID = '__gcp_draft__'
const GCP_DRAFT_FILL = '#0D9488'

type Props = {
  open: boolean
  points: GcpPoint[]
  selectedId: string | null
  onSelectId: (id: string) => void
  placeMode?: boolean
  placeCoord?: [number, number] | null
  onPlace?: (coord: [number, number]) => void
}

function gcpTo3857(point: GcpPoint): [number, number] {
  const [x, y] = transform(point.geom5181, 'EPSG:5181', 'EPSG:3857')
  return [x, y]
}

function coord5181To3857(coord: [number, number]): [number, number] {
  const [x, y] = transform(coord, 'EPSG:5181', 'EPSG:3857')
  return [x, y]
}

export function useGcpMapLayer({
  open,
  points,
  selectedId,
  onSelectId,
  placeMode = false,
  placeCoord = null,
  onPlace,
}: Props) {
  const mapContext = useMapContext()
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const highlightLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const highlightSourceRef = useRef<VectorSource | null>(null)
  const onSelectRef = useRef(onSelectId)
  onSelectRef.current = onSelectId
  const onPlaceRef = useRef(onPlace)
  onPlaceRef.current = onPlace
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const placeModeRef = useRef(placeMode)
  placeModeRef.current = placeMode
  const fittedOpenRef = useRef(false)
  const pulsePhaseRef = useRef(0)
  const [pulseOn, setPulseOn] = useState(false)

  useEffect(() => {
    if (!pulseOn) return
    let rafId = 0
    const loop = () => {
      pulsePhaseRef.current += DATA_QUERY_SELECTION_PULSE_STEP
      highlightSourceRef.current?.changed()
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [pulseOn])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!open || !map || !mapContext?.mapReady) {
      if (layerRef.current) {
        map?.removeLayer(layerRef.current)
        layerRef.current = null
      }
      if (highlightLayerRef.current) {
        map?.removeLayer(highlightLayerRef.current)
        highlightLayerRef.current = null
      }
      fittedOpenRef.current = false
      highlightSourceRef.current = null
      setPulseOn(false)
      return
    }

    const source = new VectorSource()
    const layer = new VectorLayer({
      source,
      zIndex: 80,
      style: (feature) => {
        if (feature.get('gcpDraft')) {
          return new Style({
            image: new Circle({
              radius: 7,
              fill: new Fill({ color: GCP_DRAFT_FILL }),
              stroke: new Stroke({ color: '#ffffff', width: 2 }),
            }),
          })
        }
        const point = feature.get('gcp') as GcpPoint | undefined
        if (!point) return
        const id = String(feature.get('gcpId') ?? '')
        const selected = id === selectedIdRef.current
        const fill = mapColorOf(point)
        return new Style({
          image: new Circle({
            radius: 6,
            fill: new Fill({ color: fill }),
            stroke: new Stroke({ color: '#ffffff', width: selected ? 2 : 1.5 }),
          }),
        })
      },
    })
    layer.set('ggnrGcpProto', true)
    map.addLayer(layer)
    layerRef.current = layer

    const highlightSource = new VectorSource()
    highlightSourceRef.current = highlightSource
    const highlightLayer = new VectorLayer({
      source: highlightSource,
      style: createDataQuerySelectionRowHighlightStyle(() => pulsePhaseRef.current),
    })
    highlightLayer.set('ggnrGcpProtoHighlight', true)
    insertLayerBelowServiceLayer(map, highlightLayer)
    highlightLayerRef.current = highlightLayer

    const onClick = (evt: MapBrowserEvent<UIEvent>) => {
      if (placeModeRef.current) {
        const coord = evt.coordinate
        if (!coord || coord.length < 2) return
        const viewProj = map.getView().getProjection()
        const [x, y] = transform(coord, viewProj, 'EPSG:5181')
        onPlaceRef.current?.([x, y])
        return
      }
      const hit = map.forEachFeatureAtPixel(
        evt.pixel,
        (feature, lyr) => (lyr === layer ? feature : undefined),
        { hitTolerance: 8 }
      )
      const id = hit ? String(hit.get('gcpId') ?? '') : ''
      if (id && id !== GCP_DRAFT_ID) onSelectRef.current(id)
    }
    map.on('singleclick', onClick as never)

    return () => {
      map.un('singleclick', onClick as never)
      map.removeLayer(layer)
      map.removeLayer(highlightLayer)
      layerRef.current = null
      highlightLayerRef.current = null
      highlightSourceRef.current = null
      setPulseOn(false)
      const el = map.getTargetElement()
      if (el) el.style.cursor = ''
    }
  }, [open, mapContext?.mapReady, mapContext?.mapInstanceRef])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    const el = map?.getTargetElement()
    if (!el) return
    el.style.cursor = open && placeMode ? 'crosshair' : ''
    return () => {
      if (el) el.style.cursor = ''
    }
  }, [open, placeMode, mapContext?.mapInstanceRef])

  useEffect(() => {
    const source = layerRef.current?.getSource()
    if (!source) return
    source.clear()
    for (const point of points) {
      const feature = new Feature({
        geometry: new Point(gcpTo3857(point)),
      })
      feature.set('gcpId', point.id)
      feature.set('gcp', point)
      source.addFeature(feature)
    }
    if (placeCoord) {
      const feature = new Feature({
        geometry: new Point(coord5181To3857(placeCoord)),
      })
      feature.set('gcpId', GCP_DRAFT_ID)
      feature.set('gcpDraft', true)
      source.addFeature(feature)
    }
    layerRef.current?.changed()
  }, [points, open, selectedId, placeCoord])

  useEffect(() => {
    const source = highlightSourceRef.current
    if (!source) return
    source.clear()
    setPulseOn(false)
    if (!open) return
    if (placeCoord) {
      const feature = new Feature({
        geometry: new Point(coord5181To3857(placeCoord)),
      })
      feature.set('isRadarPoint', true)
      source.addFeature(feature)
      setPulseOn(true)
      return
    }
    if (!selectedId) return
    const point = points.find((p) => p.id === selectedId)
    if (!point) return
    const feature = new Feature({
      geometry: new Point(gcpTo3857(point)),
    })
    feature.set('isRadarPoint', true)
    source.addFeature(feature)
    setPulseOn(true)
  }, [open, selectedId, points, placeCoord])

  useEffect(() => {
    if (!open || selectedId || placeCoord || !points.length || fittedOpenRef.current) return
    const map = mapContext?.mapInstanceRef?.current
    if (!map) return
    const coords = points.map((p) => gcpTo3857(p))
    const extent = boundingExtent(coords)
    fittedOpenRef.current = true
    scheduleFitMapToExtent3857(map, extent, {
      maxZoom: Math.min(MAP_AUTO_NAV_MAX_ZOOM, 16),
      fitPadding: [80, 80, 80, 80],
    })
  }, [open, selectedId, points, placeCoord, mapContext?.mapInstanceRef])
}
