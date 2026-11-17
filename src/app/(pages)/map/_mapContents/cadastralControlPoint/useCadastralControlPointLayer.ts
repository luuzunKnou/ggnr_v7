'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MapBrowserEvent } from 'ol'
import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import VectorLayer from 'ol/layer/Vector'
import { unByKey } from 'ol/Observable'
import VectorSource from 'ol/source/Vector'
import { call } from '@/lib/api'
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
  insertLayerBelowServiceLayer,
} from '@/lib/mapDataQueryMapHighlight'
import { useMapContext } from '../../_mapComponents/MapContext'
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation'
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../_mapComponents/config/mapDefaults'
import type { CadastralControlPointType } from './cadastralControlPointConfig'
import { CADASTRAL_CONTROL_POINT_WMS_LAYER_ID } from './cadastralControlPointLayerId'
import {
  clearCadastralControlPointKindCql,
  clearCadastralControlPointWms,
  ensureCadastralControlPointWms,
  syncCadastralControlPointKindCql,
} from './cadastralControlPointMapSync'
import { mapApiItem, toMapCoord3857 } from './cadastralControlPointTypes'

const HIGHLIGHT_PROP = 'cadastralControlPointHighlight'

function zoomToBuffer(zoom: number): number {
  if (zoom >= 18) return 4
  if (zoom >= 16) return 8
  if (zoom >= 14) return 16
  if (zoom >= 12) return 28
  return 40
}

type Options = {
  typeFilter: CadastralControlPointType | ''
  selectedId: string | null
  onSelect: (id: string) => void
}

/** 지적기준점 — GeoServer WMS 표시 + identify 클릭 + 선택 하이라이트 */
export function useCadastralControlPointLayer({ typeFilter, selectedId, onSelect }: Options) {
  const mapContext = useMapContext()
  const map = mapContext?.mapInstanceRef?.current ?? null
  const mapReady = mapContext?.mapReady
  const highlightLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const highlightSourceRef = useRef<VectorSource | null>(null)
  const onSelectRef = useRef(onSelect)
  const fittedDetailIdRef = useRef<string | null>(null)
  const pulsePhaseRef = useRef(0)
  const [pulseOn, setPulseOn] = useState(false)
  const blockClickRef = useRef(false)
  const cqlRef = useRef(mapContext?.serviceWmsCqlByLayer ?? null)
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
    cqlRef.current = mapContext?.serviceWmsCqlByLayer ?? null
  }, [mapContext?.serviceWmsCqlByLayer])

  useEffect(() => {
    ensureCadastralControlPointWms(mapContext?.setVisibleLayerNames)
    return () => {
      clearCadastralControlPointWms(mapContext?.setVisibleLayerNames)
      clearCadastralControlPointKindCql(mapContext?.setServiceWmsCqlByLayer)
    }
  }, [mapContext?.setVisibleLayerNames, mapContext?.setServiceWmsCqlByLayer])

  useEffect(() => {
    syncCadastralControlPointKindCql(mapContext?.setServiceWmsCqlByLayer, typeFilter)
  }, [typeFilter, mapContext?.setServiceWmsCqlByLayer])

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
    if (!mapReady || !map) return
    const highlightSource = new VectorSource()
    highlightSourceRef.current = highlightSource
    const highlightLayer = new VectorLayer({
      source: highlightSource,
      style: createDataQuerySelectionRowHighlightStyle(() => pulsePhaseRef.current),
      zIndex: 95,
    })
    highlightLayer.set(HIGHLIGHT_PROP, true)
    insertLayerBelowServiceLayer(map, highlightLayer)
    highlightLayerRef.current = highlightLayer
    return () => {
      map.removeLayer(highlightLayer)
      highlightLayerRef.current = null
      highlightSourceRef.current = null
      setPulseOn(false)
    }
  }, [map, mapReady])

  useEffect(() => {
    const source = highlightSourceRef.current
    if (!source) return
    source.clear()
    setPulseOn(false)
    if (!selectedId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'cadastralControlPointService',
          action: 'get',
          params: { id: selectedId },
        })
        if (cancelled) return
        const data = (res?.data ?? res) as { item?: Parameters<typeof mapApiItem>[0] | null }
        const point = data.item ? mapApiItem(data.item) : null
        const coord = point?.coord3857
        if (!coord) return
        const feature = new Feature({ geometry: new Point(coord) })
        feature.set('isRadarPoint', true)
        source.addFeature(feature)
        setPulseOn(true)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  useEffect(() => {
    if (!mapReady || !map) return
    const handleClick = async (evt: MapBrowserEvent<PointerEvent>) => {
      if (blockClickRef.current) return
      const zoom = evt.map.getView().getZoom() ?? 10
      const [x, y] = evt.coordinate as [number, number]
      try {
        const tableFilters = cqlRef.current
        const res = await call('', 'POST', {
          service: 'standardService',
          action: 'identifyFeatures',
          params: {
            x,
            y,
            buffer: zoomToBuffer(zoom),
            tables: [CADASTRAL_CONTROL_POINT_WMS_LAYER_ID],
            schema: 'layer',
            tableFilters: tableFilters ?? undefined,
          },
        })
        const data = res?.data ?? res
        const results = Array.isArray(data?.results) ? data.results : []
        const first = results[0] as
          | { tableName?: string; features?: { data?: Record<string, unknown> }[] }
          | undefined
        const table = String(first?.tableName ?? '').trim().toLowerCase()
        if (table !== CADASTRAL_CONTROL_POINT_WMS_LAYER_ID) return
        const raw = first?.features?.[0]?.data
        const seq = Number(raw?.seq ?? raw?.SEQ)
        if (!Number.isInteger(seq) || seq < 1) return
        onSelectRef.current(String(seq))
      } catch {
        /* identify 실패 무시 */
      }
    }
    const key = map.on('singleclick', handleClick as never)
    return () => unByKey(key)
  }, [map, mapReady])

  useEffect(() => {
    if (!selectedId) {
      fittedDetailIdRef.current = null
      return
    }
    if (fittedDetailIdRef.current === selectedId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'cadastralControlPointService',
          action: 'get',
          params: { id: selectedId },
        })
        if (cancelled || !map) return
        const data = (res?.data ?? res) as { item?: Parameters<typeof mapApiItem>[0] | null }
        const point = data.item ? mapApiItem(data.item) : null
        const coord = point?.coord3857
        if (!coord) return
        fittedDetailIdRef.current = selectedId
        const [cx, cy] = coord
        scheduleFitMapToExtent3857(map, [cx, cy, cx, cy], {
          maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
          pointZoom: 18,
          applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
        })
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId, map, mapContext?.applyMapViewPaddingRef])

  const fitToPoint = useCallback(
    (id: string) => {
      if (!map) return
      void (async () => {
        try {
          const res = await call('', 'POST', {
            service: 'cadastralControlPointService',
            action: 'get',
            params: { id },
          })
          const data = (res?.data ?? res) as { item?: Parameters<typeof mapApiItem>[0] | null }
          const point = data.item ? mapApiItem(data.item) : null
          const g = point?.geom5181
          if (!g) return
          const [x, y] = toMapCoord3857(g)
          fittedDetailIdRef.current = id
          scheduleFitMapToExtent3857(map, [x, y, x, y], {
            maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
            pointZoom: 18,
            applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
          })
        } catch {
          /* ignore */
        }
      })()
    },
    [map, mapContext?.applyMapViewPaddingRef]
  )

  return { fitToPoint }
}
