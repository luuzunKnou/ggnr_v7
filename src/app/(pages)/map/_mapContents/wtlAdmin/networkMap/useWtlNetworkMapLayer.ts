'use client'

import { useEffect, useRef, useState } from 'react'
import type { MapBrowserEvent } from 'ol'
import type { Map as OLMap } from 'ol'
import GeoJSON from 'ol/format/GeoJSON'
import { unByKey } from 'ol/Observable'
import ImageLayer from 'ol/layer/Image'
import VectorLayer from 'ol/layer/Vector'
import ImageWMS from 'ol/source/ImageWMS'
import VectorSource from 'ol/source/Vector'
import { getGeoServerBase } from '@/lib/geoserverUrl'
import { geoserverWmsImageLoadFunction } from '@/lib/geoserverWmsImageLoad'
import { call } from '@/lib/api'
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder'
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
  insertLayerBelowServiceLayer,
} from '@/lib/mapDataQueryMapHighlight'
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../../_mapComponents/config/mapDefaults'
import { scheduleFitMapToExtent3857 } from '../../../_mapComponents/config/mapAutoNavigation'
import '../../../_mapComponents/config/projections'
import { WORKSPACE } from '../../../_mapComponents/layerFactory/serviceLayerFactory'
import { useMapContext } from '../../../_mapComponents/MapContext'
import {
  resolveWtlNetWmsLayers,
  type WtlNetWmsSearchFilter,
} from './wtlNetworkLayerCatalog'
import {
  getWtlNetMapSources,
  type WtlNetMapSourceId,
} from './wtlNetworkMapSources'
import type { WtlNetworkRow } from './wtlNetworkTypes'

function selectionFeatures(map: OLMap, geom: unknown) {
  if (!geom || typeof geom !== 'object' || !('type' in geom) || !('coordinates' in geom)) return []
  const viewProj = map.getView().getProjection()?.getCode() || 'EPSG:3857'
  const features = new GeoJSON().readFeatures(
    {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: geom, properties: {} }],
    },
    { dataProjection: 'EPSG:4326', featureProjection: viewProj }
  )
  if (features.length === 0) return []
  const geomType = features[0].getGeometry()?.getType()
  if (geomType === 'Point' || geomType === 'MultiPoint') features[0].set('isRadarPoint', true)
  return features
}

type Props = {
  enabledLayerKeys: ReadonlySet<string>
  /** 함께 보기일 때 그룹마다 켜진 레이어. 없으면 선택한 그룹 모두 enabledLayerKeys 사용 */
  layersBySource?: Readonly<Record<string, readonly string[]>>
  mapSources: ReadonlySet<WtlNetMapSourceId>
  /** 서버 listWtlNetMapSources로 확정된 출처 id */
  availableSourceIds: readonly string[]
  selected: WtlNetworkRow | null
  onSelect: (row: WtlNetworkRow) => void
  onExtentChange: (bbox3857: [number, number, number, number] | null) => void
  /** 화면 내 조회 시 이동 중 진행 중 요청 취소용 */
  onMapMoveStart?: () => void
  /** 검색 조건 → WMS CQL */
  searchFilter?: WtlNetWmsSearchFilter | null
}

export function useWtlNetworkMapLayer({
  enabledLayerKeys,
  layersBySource,
  mapSources,
  availableSourceIds,
  selected,
  onSelect,
  onExtentChange,
  onMapMoveStart,
  searchFilter = null,
}: Props) {
  const mapContext = useMapContext()
  const wmsBySourceRef = useRef<Map<WtlNetMapSourceId, ImageLayer<ImageWMS>>>(new Map())
  const highlightSourceRef = useRef<VectorSource | null>(null)
  const pulsePhaseRef = useRef(0)
  const [radarActive, setRadarActive] = useState(false)
  const onSelectRef = useRef(onSelect)
  const onExtentRef = useRef(onExtentChange)
  const onMoveStartRef = useRef(onMapMoveStart)
  const keysRef = useRef(enabledLayerKeys)
  const sourcesRef = useRef(mapSources)
  const paddingRef = useRef(mapContext?.applyMapViewPaddingRef)
  onSelectRef.current = onSelect
  onExtentRef.current = onExtentChange
  onMoveStartRef.current = onMapMoveStart
  keysRef.current = enabledLayerKeys
  sourcesRef.current = mapSources
  paddingRef.current = mapContext?.applyMapViewPaddingRef

  const availableKey = availableSourceIds.join('\u0001')

  // WMS(출처별) + highlight — 서버가 내려준 가용 출처 기준으로 생성
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return
    if (availableSourceIds.length === 0) {
      wmsBySourceRef.current = new Map()
      return
    }

    const sourceDefs = getWtlNetMapSources().filter((s) =>
      availableSourceIds.includes(s.id)
    )
    const wmsUrl = `${getGeoServerBase()}/${WORKSPACE}/wms`
    const bySource = new Map<WtlNetMapSourceId, ImageLayer<ImageWMS>>()
    for (const src of sourceDefs) {
      const wms = new ImageLayer({
        source: new ImageWMS({
          url: wmsUrl,
          params: {
            LAYERS: '',
            TRANSPARENT: true,
            FORMAT: 'image/png',
          },
          serverType: 'geoserver',
          ratio: 1,
          imageLoadFunction: geoserverWmsImageLoadFunction,
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

    const publishExtent = () => {
      const size = map.getSize()
      const extent = size ? map.getView().calculateExtent(size) : null
      if (!extent || extent.length < 4) {
        onExtentRef.current(null)
        return
      }
      onExtentRef.current([extent[0], extent[1], extent[2], extent[3]])
    }

    const moveStartKey = map.on('movestart', () => {
      onMoveStartRef.current?.()
    })
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
      unByKey(moveStartKey)
      unByKey(moveKey)
      unByKey(clickKey)
      for (const layer of bySource.values()) map.removeLayer(layer)
      wmsBySourceRef.current = new Map()
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady, availableKey, availableSourceIds])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return
    const source = new VectorSource()
    highlightSourceRef.current = source
    const layer = new VectorLayer({
      source,
      renderOrder: compareFeaturesByGeometryStackOrder,
      style: createDataQuerySelectionRowHighlightStyle(() => pulsePhaseRef.current),
    })
    layer.set('wtlNetworkHighlight', true)
    insertLayerBelowServiceLayer(map, layer)
    return () => {
      map.removeLayer(layer)
      highlightSourceRef.current = null
      setRadarActive(false)
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady])

  useEffect(() => {
    if (!radarActive) return
    let rafId = 0
    const loop = () => {
      pulsePhaseRef.current += DATA_QUERY_SELECTION_PULSE_STEP
      highlightSourceRef.current?.changed()
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [radarActive])

  // 출처·표시 토글에 맞춰 출처별 WMS 갱신
  useEffect(() => {
    const sourceDefs = getWtlNetMapSources().filter((s) =>
      availableSourceIds.includes(s.id)
    )
    for (const src of sourceDefs) {
      const layer = wmsBySourceRef.current.get(src.id)
      const source = layer?.getSource()
      if (!layer || !source) continue
      const keysForSource = layersBySource
        ? new Set(layersBySource[src.id] ?? [])
        : enabledLayerKeys
      if (!mapSources.has(src.id) || keysForSource.size === 0) {
        layer.setVisible(false)
        source.updateParams({ LAYERS: '', CQL_FILTER: undefined })
        continue
      }
      const { layers, cql } = resolveWtlNetWmsLayers(keysForSource, [src.id], searchFilter)
      if (layers.length === 0) {
        layer.setVisible(false)
        source.updateParams({ LAYERS: '', CQL_FILTER: undefined })
        continue
      }
      layer.setVisible(true)
      const params: Record<string, string> = {
        LAYERS: layers.map((name) => `${WORKSPACE}:${name}`).join(','),
        STYLES: layers.join(','),
      }
      if (cql.some((c) => c !== 'INCLUDE')) {
        params.CQL_FILTER = cql.join(';')
      } else {
        params.CQL_FILTER = ''
      }
      source.updateParams(params)
    }
  }, [
    enabledLayerKeys,
    layersBySource,
    mapSources,
    availableKey,
    availableSourceIds,
    mapContext?.mapReady,
    searchFilter,
  ])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    const source = highlightSourceRef.current
    if (!map || !source) return
    source.clear()
    const features = selectionFeatures(map, selected?.geom)
    if (features.length === 0) {
      setRadarActive(false)
      return
    }
    source.addFeatures(features)
    const ext = source.getExtent()
    if (ext.every((v) => Number.isFinite(v))) {
      scheduleFitMapToExtent3857(map, ext as [number, number, number, number], {
        maxZoom: Math.min(16, MAP_AUTO_NAV_MAX_ZOOM),
        applyMapViewPadding: () => paddingRef.current?.current?.(),
      })
    }
    setRadarActive(true)
  }, [selected, mapContext?.mapInstanceRef, mapContext?.mapReady])
}
