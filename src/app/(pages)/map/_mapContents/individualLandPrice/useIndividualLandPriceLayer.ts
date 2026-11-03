'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Feature from 'ol/Feature'
import GeoJSON from 'ol/format/GeoJSON'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import type { MapBrowserEvent } from 'ol'
import { containsExtent } from 'ol/extent'
import { unByKey } from 'ol/Observable'
import { Fill, Stroke, Style } from 'ol/style'
import { call } from '@/lib/api'
import { insertLayerBelowServiceLayer } from '@/lib/mapDataQueryMapHighlight'
import { useMapContext } from '../../_mapComponents/MapContext'
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation'
import { isJijukJibunLabelVisible } from '../../_mapComponents/layerFactory/boundaryLayerFactory'
import { INDIVIDUAL_LAND_PRICE_SERVICE, LAND_PRICE_FOCUS_MAX_RESOLUTION } from './individualLandPriceConfig'

export type MapViewBbox = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  srid: number
}

const MAP_VIEW_DEBOUNCE_MS = 450

/** 목록 행 선택 → 상세 강조가 필지로 이동 (지도 클릭 선택은 제외) */
let focusMapFromListPnu: string | null = null
const FOCUS_FROM_LIST_EVENT = 'ggnr-individual-land-price-focus-list'

/** 목록에서 필지를 고를 때 — 지도 이동 요청. 목록 «이 지도에서 검색»은 suppress와 함께 끈다 */
export function markIndividualLandPriceSelectFromList(pnu: string) {
  const id = String(pnu ?? '').trim()
  if (!id) return
  focusMapFromListPnu = id
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FOCUS_FROM_LIST_EVENT, { detail: { pnu: id } }))
  }
}

/**
 * 공시지가 레이어와 같은 축척·현재 화면 범위(실시간).
 * 목록 조회 범위는 패널이 따로 고정하고, 지도만 바뀌면 «이 지도에서 검색»을 띄운다.
 * suppressListStaleUntilUserInteract: 목록 행 선택으로 지도가 움직일 때 버튼·재조회 신호를 잠시 끈다.
 */
export function useIndividualLandPriceMapViewBbox(): {
  bbox: MapViewBbox | null
  zoomOk: boolean
  /** true면 목록이 «지도 변경»으로 보지 않음(목록 선택 이동 중) */
  listStaleSuppressed: boolean
  suppressListStaleUntilUserInteract: () => void
} {
  const mapContext = useMapContext()
  const map = mapContext?.mapInstanceRef?.current ?? null
  const mapReady = mapContext?.mapReady
  const [state, setState] = useState<{ bbox: MapViewBbox | null; zoomOk: boolean }>({
    bbox: null,
    zoomOk: false,
  })
  const [listStaleSuppressed, setListStaleSuppressed] = useState(false)
  const suppressRef = useRef(false)
  const suppressListStaleUntilUserInteract = useCallback(() => {
    suppressRef.current = true
    setListStaleSuppressed(true)
  }, [])

  useEffect(() => {
    if (!mapReady || !map) {
      suppressRef.current = false
      setListStaleSuppressed(false)
      setState({ bbox: null, zoomOk: false })
      return
    }

    let timer: ReturnType<typeof setTimeout> | null = null
    const read = () => {
      const view = map.getView()
      const resolution = view.getResolution()
      const zoomOk = resolution != null && isJijukJibunLabelVisible(resolution)
      if (!zoomOk) {
        setState((prev) => (prev.bbox == null && !prev.zoomOk ? prev : { bbox: null, zoomOk: false }))
        return
      }
      const extent = view.calculateExtent(map.getSize())
      if (!extent || extent.length < 4) {
        setState({ bbox: null, zoomOk: true })
        return
      }
      const [minX, minY, maxX, maxY] = extent.map(Number)
      if (![minX, minY, maxX, maxY].every((n) => Number.isFinite(n))) {
        setState({ bbox: null, zoomOk: true })
        return
      }
      const projCode = view.getProjection()?.getCode() ?? 'EPSG:3857'
      const srid = Number(projCode.replace(/^EPSG:/i, '')) || 3857
      const next: MapViewBbox = { minX, minY, maxX, maxY, srid }
      setState((prev) => {
        const same =
          prev.zoomOk &&
          prev.bbox &&
          prev.bbox.minX === next.minX &&
          prev.bbox.minY === next.minY &&
          prev.bbox.maxX === next.maxX &&
          prev.bbox.maxY === next.maxY &&
          prev.bbox.srid === next.srid
        return same ? prev : { bbox: next, zoomOk: true }
      })
    }

    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        read()
      }, MAP_VIEW_DEBOUNCE_MS)
    }

    const onUserMap = () => {
      if (!suppressRef.current) return
      suppressRef.current = false
      setListStaleSuppressed(false)
    }
    const viewport = map.getViewport()
    viewport.addEventListener('pointerdown', onUserMap)
    viewport.addEventListener('wheel', onUserMap, { passive: true })

    read()
    map.on('moveend', schedule)
    return () => {
      if (timer) clearTimeout(timer)
      map.un('moveend', schedule)
      viewport.removeEventListener('pointerdown', onUserMap)
      viewport.removeEventListener('wheel', onUserMap)
    }
  }, [map, mapReady])

  return { ...state, listStaleSuppressed, suppressListStaleUntilUserInteract }
}

const HIGHLIGHT_PROP = 'individualLandPriceHighlight'
const geoJsonFormat = new GeoJSON()

/** 개별공시지가 메뉴가 열려 있는 동안 지도 클릭 위치의 필지를 상세로 연다 */
export function useIndividualLandPriceMapClick(onSelect: (pnu: string) => void) {
  const mapContext = useMapContext()
  const map = mapContext?.mapInstanceRef?.current ?? null
  const mapReady = mapContext?.mapReady
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
    let seq = 0
    const handleClick = async (evt: MapBrowserEvent<PointerEvent>) => {
      if (blockClickRef.current) return
      const [x, y] = evt.coordinate
      const mySeq = ++seq
      try {
        const res = await call('', 'POST', {
          service: INDIVIDUAL_LAND_PRICE_SERVICE,
          action: 'pnuAtPoint',
          params: { x, y },
        })
        if (mySeq !== seq || !res?.success) return
        const pnu = ((res.data ?? res) as { pnu?: string | null }).pnu
        if (pnu) onSelectRef.current(pnu)
      } catch {
        /* 클릭 위치 조회 실패는 무시 */
      }
    }
    const key = map.on('singleclick', handleClick as never)
    return () => {
      seq++
      unByKey(key)
    }
  }, [map, mapReady])
}

const OFFICIAL_LAND_PRICE_CONTROL_ID = 'official-land-price'

function setOfficialLandPriceControl(active: boolean) {
  window.dispatchEvent(
    new CustomEvent('ggnr-map-control-set', { detail: { id: OFFICIAL_LAND_PRICE_CONTROL_ID, active } })
  )
}

/** 개별공시지가 메뉴가 열려 있는 동안 지도 우측 «공시지가» 표시를 켜 두고, 닫으면 끈다 */
export function useOfficialLandPriceControlWhileOpen() {
  const mapReady = useMapContext()?.mapReady

  useEffect(() => {
    if (!mapReady) return
    setOfficialLandPriceControl(true)
  }, [mapReady])

  useEffect(() => () => setOfficialLandPriceControl(false), [])
}

const highlightStyle = [
  new Style({ stroke: new Stroke({ color: '#ffffff', width: 6 }) }),
  new Style({
    fill: new Fill({ color: 'rgba(124, 58, 237, 0.15)' }),
    stroke: new Stroke({ color: '#7c3aed', width: 3 }),
  }),
]

/**
 * 상세 필지 강조.
 * - 목록에서 고른 경우: 항상 해당 필지로 지도 이동 (같은 필지 재선택 포함)
 * - 지도 클릭: 화면 밖이거나 많이 축소돼 있을 때만 이동
 */
export function useIndividualLandPriceHighlight(
  pnu: string,
  geometry: unknown,
  extent: [number, number, number, number] | null
) {
  const mapContext = useMapContext()
  const map = mapContext?.mapInstanceRef?.current ?? null
  const mapReady = mapContext?.mapReady
  const applyPaddingRef = mapContext?.applyMapViewPaddingRef

  useEffect(() => {
    if (!mapReady || !map || !geometry) return
    const geom = geoJsonFormat.readGeometry(geometry)
    if (!geom) return
    const source = new VectorSource({ features: [new Feature({ geometry: geom })] })
    const layer = new VectorLayer({ source, style: highlightStyle })
    layer.set(HIGHLIGHT_PROP, true)
    insertLayerBelowServiceLayer(map, layer)

    const fitTarget = extent ?? (geom.getExtent() as [number, number, number, number])
    const fitToParcel = () => {
      /** noZoomOut: 필지 fit 패딩 때문에 현재보다 축소되지 않게 함 */
      scheduleFitMapToExtent3857(map, fitTarget, {
        maxZoom: 19,
        fitPadding: [160, 160, 160, 160],
        noZoomOut: true,
        applyMapViewPadding: () => applyPaddingRef?.current?.(),
      })
    }

    const fromList = focusMapFromListPnu === pnu
    if (fromList) focusMapFromListPnu = null

    const size = map.getSize()
    const view = map.getView()
    const inView = size ? containsExtent(view.calculateExtent(size), fitTarget) : false
    const zoomedIn = (view.getResolution() ?? Infinity) <= LAND_PRICE_FOCUS_MAX_RESOLUTION
    if (fromList || !inView || !zoomedIn) fitToParcel()

    const onFocusFromList = (evt: Event) => {
      const id = String((evt as CustomEvent<{ pnu?: string }>).detail?.pnu ?? '').trim()
      if (id !== pnu) return
      focusMapFromListPnu = null
      fitToParcel()
    }
    window.addEventListener(FOCUS_FROM_LIST_EVENT, onFocusFromList)

    return () => {
      window.removeEventListener(FOCUS_FROM_LIST_EVENT, onFocusFromList)
      map.removeLayer(layer)
    }
  }, [map, mapReady, pnu, geometry, extent, applyPaddingRef])
}
