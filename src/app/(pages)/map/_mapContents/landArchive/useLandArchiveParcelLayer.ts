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
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation'
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../_mapComponents/config/mapDefaults'
import { useMapContext } from '../../_mapComponents/MapContext'
import {
  LAND_ARCHIVE_PARCEL_COLOR,
  landArchiveParcelKey,
  type LandArchiveParcelGeom,
} from './landArchiveConfig'

const LAYER_PROP = 'landArchiveParcelLayer'
const LABEL_MAX_RESOLUTION = 1.2
const geoJsonFormat = new GeoJSON()

const parcelStyleBase = {
  fill: new Fill({ color: `${LAND_ARCHIVE_PARCEL_COLOR}1f` }),
  stroke: new Stroke({ color: LAND_ARCHIVE_PARCEL_COLOR, width: 1.5 }),
}

function createStyle(getFocusedKey: () => string | null) {
  return (feature: FeatureLike, resolution: number) => {
    const focused = feature.get('parcelKey') === getFocusedKey()
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
          fill: new Fill({ color: 'rgba(14, 165, 233, 0.42)' }),
          stroke: new Stroke({ color: '#0369a1', width: 3 }),
          text: label,
          zIndex: 4,
        }),
      ]
    }
    return new Style({ ...parcelStyleBase, text: label })
  }
}

type Options = {
  parcels: LandArchiveParcelGeom[]
  focusedKey: string | null
  onSelect: (key: string) => void
}

/** 지적기록물 상세 — 묶인 필지 도형 */
export function useLandArchiveParcelLayer({ parcels, focusedKey, onSelect }: Options) {
  const mapContext = useMapContext()
  const map = mapContext?.mapInstanceRef?.current ?? null
  const mapReady = mapContext?.mapReady
  const sourceRef = useRef<VectorSource | null>(null)
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const focusedKeyRef = useRef<string | null>(focusedKey)
  const onSelectRef = useRef(onSelect)
  const blockClickRef = useRef(false)
  const fittedSigRef = useRef<string | null>(null)
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
      style: createStyle(() => focusedKeyRef.current),
    })
    layer.set(LAYER_PROP, true)
    insertLayerBelowServiceLayer(map, layer)
    sourceRef.current = source
    layerRef.current = layer
    return () => {
      map.removeLayer(layer)
      sourceRef.current = null
      layerRef.current = null
      fittedSigRef.current = null
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
          f.set('parcelKey', landArchiveParcelKey(p))
          f.set('label', p.jibun)
          return f
        })
        .filter((f): f is Feature => f !== null)
    )
    if (parcels.length === 0 || !map) return
    const sig = parcels.map((p) => landArchiveParcelKey(p)).join('|')
    if (fittedSigRef.current === sig) return
    const extent = source.getExtent()
    if (!extent || !extent.every((n) => Number.isFinite(n))) return
    fittedSigRef.current = sig
    scheduleFitMapToExtent3857(map, extent as [number, number, number, number], {
      maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
      fitPadding: [80, 80, 80, 80],
      applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
    })
  }, [parcels, map, mapReady, mapContext?.applyMapViewPaddingRef])

  useEffect(() => {
    focusedKeyRef.current = focusedKey
    sourceRef.current?.changed()
  }, [focusedKey])

  useEffect(() => {
    if (!mapReady || !map) return
    const handleClick = (evt: MapBrowserEvent<PointerEvent>) => {
      if (blockClickRef.current) return
      const layer = layerRef.current
      if (!layer) return
      let hitKey: string | null = null
      evt.map.forEachFeatureAtPixel(
        evt.pixel,
        (feature) => {
          hitKey = String(feature.get('parcelKey') ?? '') || null
          return true
        },
        { layerFilter: (l) => l === layer }
      )
      if (hitKey) onSelectRef.current(hitKey)
    }
    const key = map.on('singleclick', handleClick as never)
    return () => unByKey(key)
  }, [map, mapReady])

  const fitToParcel = useCallback(
    (parcel: LandArchiveParcelGeom) => {
      if (!map) return
      scheduleFitMapToExtent3857(map, parcel.extent, {
        maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
        applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
      })
    },
    [map, mapContext?.applyMapViewPaddingRef]
  )

  return { fitToParcel }
}
