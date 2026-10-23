'use client'

import { useEffect, useRef } from 'react'
import type { MapBrowserEvent } from 'ol'
import GeoJSON from 'ol/format/GeoJSON'
import { unByKey } from 'ol/Observable'
import Feature from 'ol/Feature'
import type { Geometry } from 'ol/geom'
import ImageLayer from 'ol/layer/Image'
import VectorLayer from 'ol/layer/Vector'
import ImageWMS from 'ol/source/ImageWMS'
import VectorSource from 'ol/source/Vector'
import { Fill, Stroke, Style, Circle as CircleStyle } from 'ol/style'
import { getGeoServerBase } from '@/lib/geoserverUrl'
import { call } from '@/lib/api'
import '../../../_mapComponents/config/projections'
import { useMapContext } from '../../../_mapComponents/MapContext'
import { resolveWtlNetWmsLayers } from './wtlNetworkLayerCatalog'
import {
  WTL_NET_MAP_SOURCES,
  type WtlNetMapSourceId,
} from './wtlNetworkMapSources'
import type { WtlNetworkRow } from './wtlNetworkTypes'

const WORKSPACE = 'water_uiseong'
const HIGHLIGHT = '#1e3a8a'

function highlightStyle(): Style {
  return new Style({
    stroke: new Stroke({ color: HIGHLIGHT, width: 5 }),
    fill: new Fill({ color: 'rgba(37,99,235,0.28)' }),
    image: new CircleStyle({
      radius: 8,
      fill: new Fill({ color: HIGHLIGHT }),
      stroke: new Stroke({ color: '#ffffff', width: 2 }),
    }),
  })
}

type Props = {
  enabledLayerKeys: ReadonlySet<string>
  mapSources: ReadonlySet<WtlNetMapSourceId>
  selected: WtlNetworkRow | null
  onSelect: (row: WtlNetworkRow) => void
  onExtentChange: (bbox3857: [number, number, number, number] | null) => void
}

export function useWtlNetworkMapLayer({
  enabledLayerKeys,
  mapSources,
  selected,
  onSelect,
  onExtentChange,
}: Props) {
  const mapContext = useMapContext()
  const wmsBySourceRef = useRef<Map<WtlNetMapSourceId, ImageLayer<ImageWMS>>>(new Map())
  const highlightRef = useRef<VectorLayer<VectorSource> | null>(null)
  const onSelectRef = useRef(onSelect)
  const onExtentRef = useRef(onExtentChange)
  const keysRef = useRef(enabledLayerKeys)
  const sourcesRef = useRef(mapSources)
  onSelectRef.current = onSelect
  onExtentRef.current = onExtentChange
  keysRef.current = enabledLayerKeys
  sourcesRef.current = mapSources

  // WMS(출처별) + highlight
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return

    const wmsUrl = `${getGeoServerBase()}/${WORKSPACE}/wms`
    const bySource = new Map<WtlNetMapSourceId, ImageLayer<ImageWMS>>()
    for (const src of WTL_NET_MAP_SOURCES) {
      const wms = new ImageLayer({
        source: new ImageWMS({
          url: wmsUrl,
          params: {
            LAYERS: '',
            TRANSPARENT: true,
            FORMAT: 'image/png',
          },
          serverType: 'geoserver',
          ratio: 1.5,
        }),
        zIndex: 880,
        visible: false,
      })
      wms.set('wtlNetworkWms', true)
      wms.set('wtlNetworkMapSource', src.id)
      map.addLayer(wms)
      bySource.set(src.id, wms)
    }
    wmsBySourceRef.current = bySource

    const highlight = new VectorLayer({
      source: new VectorSource(),
      style: highlightStyle(),
      zIndex: 900,
    })
    highlight.set('wtlNetworkHighlight', true)
    map.addLayer(highlight)
    highlightRef.current = highlight

    const publishExtent = () => {
      const size = map.getSize()
      const extent = size ? map.getView().calculateExtent(size) : null
      if (!extent || extent.length < 4) {
        onExtentRef.current(null)
        return
      }
      onExtentRef.current([extent[0], extent[1], extent[2], extent[3]])
    }

    const moveKey = map.on('moveend', publishExtent)
    publishExtent()

    const clickKey = map.on('singleclick', async (evt: MapBrowserEvent<PointerEvent>) => {
        const keys = [...keysRef.current]
        const sources = [...sourcesRef.current]
        if (keys.length === 0 || sources.length === 0) return
        try {
          const res = await call('', 'POST', {
            service: 'wtlNetworkService',
            action: 'getWtlNetworkAtPoint',
            params: {
              x: evt.coordinate[0],
              y: evt.coordinate[1],
              layerKeys: keys,
              mapSources: sources,
              tolerance: 12,
            },
          })
          const row = (res?.data ?? res)?.row as WtlNetworkRow | null | undefined
          if (row) onSelectRef.current(row)
      } catch {
        /* ignore */
      }
    })

    return () => {
      unByKey(moveKey)
      unByKey(clickKey)
      for (const layer of bySource.values()) map.removeLayer(layer)
      map.removeLayer(highlight)
      wmsBySourceRef.current = new Map()
      highlightRef.current = null
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady])

  // 출처·표시 토글에 맞춰 출처별 WMS 갱신
  useEffect(() => {
    for (const src of WTL_NET_MAP_SOURCES) {
      const layer = wmsBySourceRef.current.get(src.id)
      const source = layer?.getSource()
      if (!layer || !source) continue
      if (!mapSources.has(src.id) || enabledLayerKeys.size === 0) {
        layer.setVisible(false)
        source.updateParams({ LAYERS: '', CQL_FILTER: undefined })
        continue
      }
      const { layers, cql } = resolveWtlNetWmsLayers(enabledLayerKeys, [src.id])
      if (layers.length === 0) {
        layer.setVisible(false)
        source.updateParams({ LAYERS: '', CQL_FILTER: undefined })
        continue
      }
      layer.setVisible(true)
      const params: Record<string, string> = {
        LAYERS: layers.join(','),
        STYLES: layers.map(() => '').join(','),
      }
      if (cql.some((c) => c !== 'INCLUDE')) {
        params.CQL_FILTER = cql.join(';')
      } else {
        params.CQL_FILTER = ''
      }
      source.updateParams(params)
    }
  }, [enabledLayerKeys, mapSources])

  // highlight selected geom (화면 이동 없음)
  useEffect(() => {
    const layer = highlightRef.current
    const source = layer?.getSource()
    if (!source) return
    source.clear()
    const geom = selected?.geom
    if (!geom) return
    try {
      const features = new GeoJSON().readFeatures(
        { type: 'Feature', geometry: geom, properties: {} },
        { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }
      ) as Feature<Geometry>[]
      for (const f of features) source.addFeature(f)
    } catch {
      /* ignore */
    }
  }, [selected])
}
