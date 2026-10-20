'use client'

import { useCallback, useEffect, useRef } from 'react'
import Feature from 'ol/Feature'
import type { FeatureLike } from 'ol/Feature'
import GeoJSON from 'ol/format/GeoJSON'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import type { MapBrowserEvent } from 'ol'
import { unByKey } from 'ol/Observable'
import { Fill, Stroke, Style, Text } from 'ol/style'
import { insertLayerBelowServiceLayer } from '@/lib/mapDataQueryMapHighlight'
import { useMapContext } from '../../_mapComponents/MapContext'
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation'
import { RESURVEY_PARCEL_COLOR } from './cadastralResurveyConfig'
import { type ResurveyParcel } from './cadastralResurveyMock'

const LAYER_PROP = 'cadastralResurveyParcelLayer'
/** 이 해상도(m/px) 이하에서만 지번 라벨 */
const LABEL_MAX_RESOLUTION = 1.2
const geoJsonFormat = new GeoJSON()

const parcelStyleBase = {
  fill: new Fill({ color: `${RESURVEY_PARCEL_COLOR}1f` }),
  stroke: new Stroke({ color: RESURVEY_PARCEL_COLOR, width: 1 }),
}

function createStyle(getFocusedId: () => string | null) {
  return (feature: FeatureLike, resolution: number) => {
    const focused = feature.get('parcelId') === getFocusedId()
    const label =
      resolution <= LABEL_MAX_RESOLUTION
        ? new Text({
            text: String(feature.get('label') ?? ''),
            font: '11px "Pretendard", sans-serif',
            fill: new Fill({ color: '#111827' }),
            stroke: new Stroke({ color: '#ffffff', width: 3 }),
          })
        : undefined
    if (focused) {
      return [
        new Style({ stroke: new Stroke({ color: '#ffffff', width: 6 }), zIndex: 3 }),
        new Style({
          fill: new Fill({ color: 'rgba(250, 204, 21, 0.45)' }),
          stroke: new Stroke({ color: '#ca8a04', width: 3 }),
          text: label,
          zIndex: 4,
        }),
      ]
    }
    return new Style({ ...parcelStyleBase, text: label })
  }
}

type Options = {
  parcels: ResurveyParcel[]
  focusedId: string | null
  onSelect: (id: string) => void
}

/** 지구 상세 — 지구 안 필지 표시, 필지 강조·지도 클릭 선택 */
export function useCadastralResurveyParcelLayer({ parcels, focusedId, onSelect }: Options) {
  const mapContext = useMapContext()
  const map = mapContext?.mapInstanceRef?.current ?? null
  const mapReady = mapContext?.mapReady
  const sourceRef = useRef<VectorSource | null>(null)
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const focusedIdRef = useRef<string | null>(focusedId)
  const onSelectRef = useRef(onSelect)
  const blockClickRef = useRef(false)
  const blockClick = Boolean(
    mapContext?.spatialDrawRequest ||
      mapContext?.mapMeasureTool ||
      mapContext?.mapDrawInputSuspended ||
      mapContext?.layerRowGeomEdit
  )

  useEffect(() => {
    onSelectRef.current = onSelect
    blockClickRef.current = blockClick
  }, [onSelect, blockClick])

  useEffect(() => {
    if (!mapReady || !map) return
    const source = new VectorSource()
    const layer = new VectorLayer({
      source,
      style: createStyle(() => focusedIdRef.current),
    })
    layer.set(LAYER_PROP, true)
    insertLayerBelowServiceLayer(map, layer)
    sourceRef.current = source
    layerRef.current = layer
    return () => {
      map.removeLayer(layer)
      sourceRef.current = null
      layerRef.current = null
    }
  }, [map, mapReady])

  useEffect(() => {
    const source = sourceRef.current
    if (!source) return
    source.clear()
    source.addFeatures(
      parcels
        .map((p) => {
          const geometry = geoJsonFormat.readGeometry(p.geom3857)
          if (!geometry) return null
          const f = new Feature({ geometry })
          f.set('parcelId', p.id)
          f.set('label', p.jibun)
          return f
        })
        .filter((f): f is Feature => f !== null)
    )
  }, [parcels, map, mapReady])

  useEffect(() => {
    focusedIdRef.current = focusedId
    sourceRef.current?.changed()
  }, [focusedId])

  useEffect(() => {
    if (!mapReady || !map) return
    const handleClick = (evt: MapBrowserEvent<PointerEvent>) => {
      if (blockClickRef.current) return
      const layer = layerRef.current
      if (!layer) return
      let hitId: string | null = null
      evt.map.forEachFeatureAtPixel(
        evt.pixel,
        (feature) => {
          hitId = String(feature.get('parcelId') ?? '') || null
          return true
        },
        { layerFilter: (l) => l === layer }
      )
      if (hitId) onSelectRef.current(hitId)
    }
    const key = map.on('singleclick', handleClick as never)
    return () => unByKey(key)
  }, [map, mapReady])

  const fitToParcel = useCallback(
    (parcel: ResurveyParcel) => {
      if (!map) return
      scheduleFitMapToExtent3857(map, parcel.extent3857, {
        maxZoom: 19,
        fitPadding: [160, 160, 160, 160],
        applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
      })
    },
    [map, mapContext?.applyMapViewPaddingRef]
  )

  return { fitToParcel }
}
