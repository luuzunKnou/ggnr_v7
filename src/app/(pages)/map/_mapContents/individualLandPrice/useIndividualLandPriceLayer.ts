'use client'

import { useEffect, useRef } from 'react'
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
import { INDIVIDUAL_LAND_PRICE_SERVICE, LAND_PRICE_FOCUS_MAX_RESOLUTION } from './individualLandPriceConfig'

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
 * 상세 필지 강조. 필지가 화면 밖이거나 많이 축소돼 있으면 필지로 이동한다
 * (지도에서 클릭한 필지는 이미 화면 안이라 그대로 둔다).
 */
export function useIndividualLandPriceHighlight(
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

    const size = map.getSize()
    const view = map.getView()
    const inView = size ? containsExtent(view.calculateExtent(size), extent ?? geom.getExtent()) : false
    const zoomedIn = (view.getResolution() ?? Infinity) <= LAND_PRICE_FOCUS_MAX_RESOLUTION
    if (!inView || !zoomedIn) {
      scheduleFitMapToExtent3857(map, extent ?? geom.getExtent(), {
        maxZoom: 19,
        fitPadding: [160, 160, 160, 160],
        applyMapViewPadding: () => applyPaddingRef?.current?.(),
      })
    }
    return () => {
      map.removeLayer(layer)
    }
  }, [map, mapReady, geometry, extent, applyPaddingRef])
}
