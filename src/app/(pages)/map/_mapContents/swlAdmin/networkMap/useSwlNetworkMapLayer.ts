'use client'

import { useEffect, useRef } from 'react'
import type { MapBrowserEvent } from 'ol'
import Draw, { createBox, type DrawEvent } from 'ol/interaction/Draw'
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
import { resolveSwlNetWmsLayers } from './swlNetworkLayerCatalog'
import type { SwlNetworkRow } from './swlNetworkTypes'

const WORKSPACE = 'ggnr'
const HIGHLIGHT = '#0f766e'

function highlightStyle(): Style {
  return new Style({
    stroke: new Stroke({ color: HIGHLIGHT, width: 5 }),
    fill: new Fill({ color: 'rgba(13,148,136,0.28)' }),
    image: new CircleStyle({
      radius: 8,
      fill: new Fill({ color: HIGHLIGHT }),
      stroke: new Stroke({ color: '#ffffff', width: 2 }),
    }),
  })
}

function zoneStyle(): Style {
  return new Style({
    stroke: new Stroke({ color: '#0f766e', width: 2, lineDash: [6, 4] }),
    fill: new Fill({ color: 'rgba(13,148,136,0.12)' }),
  })
}

type Props = {
  enabledLayerKeys: ReadonlySet<string>
  selected: SwlNetworkRow | null
  zoneDraw: boolean
  zoneActive: boolean
  onSelect: (row: SwlNetworkRow) => void
  onExtentChange: (bbox3857: [number, number, number, number] | null) => void
  onZoneBbox: (bbox3857: [number, number, number, number] | null) => void
  onZoneDrawEnd: () => void
}

export function useSwlNetworkMapLayer({
  enabledLayerKeys,
  selected,
  zoneDraw,
  zoneActive,
  onSelect,
  onExtentChange,
  onZoneBbox,
  onZoneDrawEnd,
}: Props) {
  const mapContext = useMapContext()
  const wmsRef = useRef<ImageLayer<ImageWMS> | null>(null)
  const highlightRef = useRef<VectorLayer<VectorSource> | null>(null)
  const zoneSourceRef = useRef<VectorSource | null>(null)
  const onSelectRef = useRef(onSelect)
  const onExtentRef = useRef(onExtentChange)
  const onZoneRef = useRef(onZoneBbox)
  const onZoneEndRef = useRef(onZoneDrawEnd)
  const keysRef = useRef(enabledLayerKeys)
  const zoneDrawRef = useRef(zoneDraw)
  useEffect(() => {
    onSelectRef.current = onSelect
    onExtentRef.current = onExtentChange
    onZoneRef.current = onZoneBbox
    onZoneEndRef.current = onZoneDrawEnd
    keysRef.current = enabledLayerKeys
    zoneDrawRef.current = zoneDraw
  })

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return

    const wms = new ImageLayer({
      source: new ImageWMS({
        url: `${getGeoServerBase()}/${WORKSPACE}/wms`,
        params: { LAYERS: '', TRANSPARENT: true, FORMAT: 'image/png' },
        serverType: 'geoserver',
        ratio: 1.5,
      }),
      zIndex: 880,
      visible: false,
    })
    wms.set('swlNetworkWms', true)
    map.addLayer(wms)
    wmsRef.current = wms

    const highlight = new VectorLayer({
      source: new VectorSource(),
      style: highlightStyle(),
      zIndex: 900,
    })
    highlight.set('swlNetworkHighlight', true)
    map.addLayer(highlight)
    highlightRef.current = highlight

    const zoneSource = new VectorSource()
    const zoneLayer = new VectorLayer({ source: zoneSource, style: zoneStyle(), zIndex: 890 })
    zoneLayer.set('swlNetworkZone', true)
    map.addLayer(zoneLayer)
    zoneSourceRef.current = zoneSource

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
      if (zoneDrawRef.current) return
      const keys = [...keysRef.current]
      if (keys.length === 0) return
      try {
        const res = await call('', 'POST', {
          service: 'swlNetworkService',
          action: 'getSwlNetworkAtPoint',
          params: { x: evt.coordinate[0], y: evt.coordinate[1], layerKeys: keys, tolerance: 12 },
        })
        const row = (res?.data ?? res)?.row as SwlNetworkRow | null | undefined
        if (row) onSelectRef.current(row)
      } catch {
        /* ignore */
      }
    })

    return () => {
      unByKey(moveKey)
      unByKey(clickKey)
      map.removeLayer(wms)
      map.removeLayer(highlight)
      map.removeLayer(zoneLayer)
      wmsRef.current = null
      highlightRef.current = null
      zoneSourceRef.current = null
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady])

  useEffect(() => {
    const layer = wmsRef.current
    const source = layer?.getSource()
    if (!layer || !source) return
    const names = resolveSwlNetWmsLayers(enabledLayerKeys)
    if (names.length === 0) {
      layer.setVisible(false)
      source.updateParams({ LAYERS: '', CQL_FILTER: undefined })
      return
    }
    layer.setVisible(true)
    source.updateParams({
      LAYERS: names.join(','),
      STYLES: names.map(() => '').join(','),
      CQL_FILTER: '',
    })
  }, [enabledLayerKeys])

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

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    const zoneSource = zoneSourceRef.current
    if (!map || !zoneSource || !zoneDraw) return
    zoneSource.clear()
    const draw = new Draw({ source: zoneSource, type: 'Circle', geometryFunction: createBox() })
    const onEnd = (evt: DrawEvent) => {
      const extent = evt.feature.getGeometry()?.getExtent()
      if (extent && extent.length >= 4) {
        onZoneRef.current([extent[0], extent[1], extent[2], extent[3]])
      }
      onZoneEndRef.current()
    }
    draw.on('drawend', onEnd)
    map.addInteraction(draw)
    return () => {
      draw.un('drawend', onEnd)
      map.removeInteraction(draw)
    }
  }, [zoneDraw, mapContext?.mapInstanceRef, mapContext?.mapReady])

  useEffect(() => {
    if (zoneActive || zoneDraw) return
    zoneSourceRef.current?.clear()
  }, [zoneActive, zoneDraw])
}
