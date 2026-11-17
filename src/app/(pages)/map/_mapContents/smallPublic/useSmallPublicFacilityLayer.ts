'use client'

import { useEffect, useRef } from 'react'
import '../../_mapComponents/config/projections'
import Feature from 'ol/Feature'
import LineString from 'ol/geom/LineString'
import Point from 'ol/geom/Point'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style'
import { transform, transformExtent } from 'ol/proj'
import { boundingExtent } from 'ol/extent'
import type { MapBrowserEvent } from 'ol'
import { unByKey } from 'ol/Observable'
import { useMapContext } from '../../_mapComponents/MapContext'
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
} from '@/lib/mapDataQueryMapHighlight'
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../_mapComponents/config/mapDefaults'
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation'
import { SMALL_PUBLIC_DATA_PROJECTION } from './smallPublicConfig'
import { isSmallPublicLine, type SmallPublicFacility } from './smallPublicMock'

const LAYER_NAME = 'smallPublicFacilityOverlay'
const SELECTION_LAYER_NAME = 'smallPublicFacilitySelection'
const ID_PROP = 'smallPublicFacilityId'
const COLOR_PROP = 'smallPublicColor'

function styleFor(feature: Feature): Style[] {
  const color = String(feature.get(COLOR_PROP) ?? '#64748b')
  if (feature.getGeometry()?.getType() === 'Point') {
    return [
      new Style({
        image: new CircleStyle({
          radius: 6,
          fill: new Fill({ color }),
          stroke: new Stroke({ color: '#ffffff', width: 2 }),
        }),
      }),
    ]
  }
  return [
    new Style({ stroke: new Stroke({ color: '#ffffff', width: 5 }) }),
    new Style({ stroke: new Stroke({ color, width: 3 }) }),
  ]
}

/**
 * 후보지·안전점검 패널이 열려 있는 동안 시설을 지도에 그린다.
 * 지도에서 시설을 누르면 onSelect, 고른 시설은 다른 업무와 같은 선택 강조(빨간 펄스, 점은 레이더).
 */
export function useSmallPublicFacilityLayer(params: {
  facilities: SmallPublicFacility[]
  colorOf: (f: SmallPublicFacility) => string
  selectedId: string | null
  onSelect: (id: string) => void
  /** false 면 지도 클릭으로 시설을 고르지 않음(새 시설 위치 찍는 중 등) */
  pickEnabled?: boolean
}) {
  const { facilities, colorOf, selectedId, onSelect, pickEnabled = true } = params
  const mapContext = useMapContext()
  const mapInstanceRef = mapContext?.mapInstanceRef
  const mapReady = mapContext?.mapReady ?? false
  const sourceRef = useRef<VectorSource | null>(null)
  const selectionSourceRef = useRef<VectorSource | null>(null)
  const pulsePhaseRef = useRef(0)
  /** 고른 시설이 지도에 있을 때만 펄스 */
  const pulsing = Boolean(selectedId) && facilities.some((f) => f.id === selectedId && f.coords)
  const onSelectRef = useRef(onSelect)
  const skipPickRef = useRef(false)
  const skipPick =
    !pickEnabled || Boolean(mapContext?.spatialDrawRequest) || Boolean(mapContext?.layerRowGeomEdit)

  useEffect(() => {
    onSelectRef.current = onSelect
    skipPickRef.current = skipPick
  }, [onSelect, skipPick])

  useEffect(() => {
    const map = mapInstanceRef?.current
    if (!mapReady || !map) return
    const source = new VectorSource()
    sourceRef.current = source
    const layer = new VectorLayer({
      source,
      style: (f) => styleFor(f as Feature),
      zIndex: 1080,
    })
    layer.set('name', LAYER_NAME)
    map.getLayers().push(layer)

    const selectionSource = new VectorSource()
    selectionSourceRef.current = selectionSource
    const selectionLayer = new VectorLayer({
      source: selectionSource,
      style: createDataQuerySelectionRowHighlightStyle(() => pulsePhaseRef.current),
      zIndex: 1090,
    })
    selectionLayer.set('name', SELECTION_LAYER_NAME)
    map.getLayers().push(selectionLayer)

    const onClick = (evt: MapBrowserEvent<PointerEvent>) => {
      if (skipPickRef.current) return
      const hit = map.forEachFeatureAtPixel(
        evt.pixel,
        (f) => {
          const id = f.get(ID_PROP)
          return typeof id === 'string' && id ? id : undefined
        },
        { hitTolerance: 6, layerFilter: (l) => l === layer }
      )
      if (hit) {
        evt.stopPropagation()
        onSelectRef.current(hit)
      }
    }
    const key = map.on('singleclick', onClick as never)
    return () => {
      unByKey(key)
      map.removeLayer(selectionLayer)
      map.removeLayer(layer)
      sourceRef.current = null
      selectionSourceRef.current = null
    }
  }, [mapReady, mapInstanceRef])

  useEffect(() => {
    if (!pulsing) return
    let rafId = 0
    const loop = () => {
      pulsePhaseRef.current += DATA_QUERY_SELECTION_PULSE_STEP
      selectionSourceRef.current?.changed()
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [pulsing])

  useEffect(() => {
    const source = sourceRef.current
    const selectionSource = selectionSourceRef.current
    const map = mapInstanceRef?.current
    if (!source || !selectionSource || !map) return
    const viewProj = map.getView().getProjection().getCode()
    source.clear()
    selectionSource.clear()
    const toView = (c: [number, number]) => transform(c, SMALL_PUBLIC_DATA_PROJECTION, viewProj)
    const features = facilities.flatMap((f) => {
      if (!f.coords) return []
      const geom = isSmallPublicLine(f.coords)
        ? new LineString(f.coords.map(toView))
        : new Point(toView(f.coords as [number, number]))
      const feature = new Feature({ geometry: geom })
      feature.set(ID_PROP, f.id)
      feature.set(COLOR_PROP, colorOf(f))
      if (f.id === selectedId) {
        const highlight = new Feature({ geometry: geom.clone() })
        if (geom.getType() === 'Point') highlight.set('isRadarPoint', true)
        selectionSource.addFeature(highlight)
      }
      return [feature]
    })
    source.addFeatures(features)
  }, [facilities, colorOf, selectedId, mapInstanceRef, mapReady])

  /** 시설 위치로 이동(패널 폭 고려) */
  const fitTo = (list: SmallPublicFacility[]) => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || list.length === 0) return
    const coords = list.flatMap((f) =>
      !f.coords ? [] : isSmallPublicLine(f.coords) ? f.coords : [f.coords as [number, number]]
    )
    if (coords.length === 0) return
    const extData = boundingExtent(coords)
    const ext3857 = transformExtent(extData, SMALL_PUBLIC_DATA_PROJECTION, 'EPSG:3857')
    const pad = 120
    const padded = [ext3857[0] - pad, ext3857[1] - pad, ext3857[2] + pad, ext3857[3] + pad]
    scheduleFitMapToExtent3857(map, padded, {
      maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
      applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
    })
  }

  return { fitTo }
}
