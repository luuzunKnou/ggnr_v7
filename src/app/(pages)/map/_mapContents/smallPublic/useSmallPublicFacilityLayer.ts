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
import { SPF_FAC_LINE_TYPES, SPF_FAC_POINT_TYPES } from '@/lib/geoserverStyles/spfFacStyle'
import { SMALL_PUBLIC_DATA_PROJECTION } from './smallPublicConfig'
import { isSmallPublicLine, type SmallPublicFacility } from './smallPublicMock'

const LAYER_NAME = 'smallPublicFacilityOverlay'
const SELECTION_LAYER_NAME = 'smallPublicFacilitySelection'
const ID_PROP = 'smallPublicFacilityId'
const COLOR_PROP = 'smallPublicColor'
const TYPE_PROP = 'smallPublicFacType'

function styleFor(feature: Feature): Style[] {
  const color = String(feature.get(COLOR_PROP) ?? '#64748b')
  const facType = String(feature.get(TYPE_PROP) ?? '')
  const geomType = feature.getGeometry()?.getType()
  const preferPoint =
    geomType === 'Point' || (SPF_FAC_POINT_TYPES as readonly string[]).includes(facType)
  if (preferPoint && geomType === 'Point') {
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
  /** 선(세천·농로·마을진입로 등) — 흰 테두리 + 본선 */
  const lineW = (SPF_FAC_LINE_TYPES as readonly string[]).includes(facType) ? 3 : 2.5
  return [
    new Style({ stroke: new Stroke({ color: '#ffffff', width: lineW + 2 }) }),
    new Style({ stroke: new Stroke({ color, width: lineW, lineCap: 'round', lineJoin: 'round' }) }),
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
  /** 상세와 별도로 지도만 강조(부속시설물 위치 보기 등). 있으면 selectedId 대신 펄스 */
  highlightId?: string | null
  onSelect: (id: string) => void
  /** false 면 지도 클릭으로 시설을 고르지 않음(새 시설 위치 찍는 중 등) */
  pickEnabled?: boolean
}) {
  const { facilities, colorOf, selectedId, highlightId = null, onSelect, pickEnabled = true } = params
  const mapContext = useMapContext()
  const mapInstanceRef = mapContext?.mapInstanceRef
  const mapReady = mapContext?.mapReady ?? false
  const sourceRef = useRef<VectorSource | null>(null)
  const selectionSourceRef = useRef<VectorSource | null>(null)
  const pulsePhaseRef = useRef(0)
  const focusId = highlightId || selectedId
  /** 고른 시설이 지도에 있을 때만 펄스 */
  const pulsing = Boolean(focusId) && facilities.some((f) => f.id === focusId && f.coords)
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
    const makeFeature = (f: SmallPublicFacility): Feature | null => {
      if (!f.coords) return null
      const geom = isSmallPublicLine(f.coords)
        ? new LineString(f.coords.map(toView))
        : new Point(toView(f.coords as [number, number]))
      const feature = new Feature({ geometry: geom })
      feature.set(ID_PROP, f.id)
      feature.set(COLOR_PROP, colorOf(f))
      feature.set(TYPE_PROP, f.type)
      if (f.id === focusId) {
        const highlight = new Feature({ geometry: geom.clone() })
        if (geom.getType() === 'Point') highlight.set('isRadarPoint', true)
        selectionSource.addFeature(highlight)
        // 선(세천·농로 등)은 선 펄스에 더해, 중간 지점에 점과 같은 레이더를 띄운다
        if (geom instanceof LineString && geom.getLength() > 0) {
          const radar = new Feature({ geometry: new Point(geom.getCoordinateAt(0.5)) })
          radar.set('isRadarPoint', true)
          selectionSource.addFeature(radar)
        }
      }
      return feature
    }

    /** 수천 건을 한 프레임에 만들면 멈춘다 — 청크로 나눠 그림 */
    const CHUNK = 400
    let cancelled = false
    let i = 0
    const pump = () => {
      if (cancelled) return
      const batch: Feature[] = []
      const end = Math.min(i + CHUNK, facilities.length)
      for (; i < end; i++) {
        const feat = makeFeature(facilities[i]!)
        if (feat) batch.push(feat)
      }
      if (batch.length) source.addFeatures(batch)
      if (i < facilities.length) {
        requestAnimationFrame(pump)
      }
    }
    pump()
    return () => {
      cancelled = true
    }
  }, [facilities, colorOf, focusId, mapInstanceRef, mapReady])

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
