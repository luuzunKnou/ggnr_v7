'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Feature from 'ol/Feature'
import type { FeatureLike } from 'ol/Feature'
import Point from 'ol/geom/Point'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import type { Map as OLMap } from 'ol'
import { Fill, Stroke, Style, Circle as CircleStyle } from 'ol/style'
import type { StyleFunction } from 'ol/style/Style'
import { call } from '@/lib/api'
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder'
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
  insertLayerBelowServiceLayer,
} from '@/lib/mapDataQueryMapHighlight'
import { useMapContext } from '../../_mapComponents/MapContext'
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation'
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../_mapComponents/config/mapDefaults'

/**
 * 상세 강조 시 맵 이동 여부 (id별).
 * 단일 boolean ref는 Strict Mode effect 재실행 때 false→true 로 바뀌어
 * 지도 첫 클릭에도 fit 이 다시 켜진다. id별 Map 으로 유지한다.
 * 목록 선택 true / 지도 클릭 false. 미등록 id 는 fit true.
 */
export const groundwaterPermitHighlightFitByIdRef = {
  current: new Map<string, boolean>(),
}

export function setGroundwaterPermitHighlightFit(id: string, fit: boolean) {
  groundwaterPermitHighlightFitByIdRef.current.set(id, fit)
}

/** 읽기만 하고 지우지 않음 — Strict Mode 재실행에도 동일 fit 유지 */
export function getGroundwaterPermitHighlightFit(id: string): boolean {
  const m = groundwaterPermitHighlightFitByIdRef.current
  if (m.has(id)) return m.get(id) === true
  return true
}

/** 데이터조회 레이더 + 중심 점(레이더만 있으면 위치가 흐려 보임) */
function createGroundwaterPermitHighlightStyle(getPulsePhase: () => number): StyleFunction {
  const radarStyleFn = createDataQuerySelectionRowHighlightStyle(getPulsePhase)
  return (feature: FeatureLike, resolution: number) => {
    const radar = radarStyleFn(feature, resolution)
    const center = new Style({
      image: new CircleStyle({
        radius: 7,
        fill: new Fill({ color: 'rgba(220, 38, 38, 0.95)' }),
        stroke: new Stroke({ color: '#ffffff', width: 2 }),
      }),
      zIndex: 2,
    })
    if (!radar) return center
    if (Array.isArray(radar)) return [...radar, center]
    return [radar, center]
  }
}

const LAYER_PROP = 'groundwaterPermitHighlight'

/** 목록·상세 패널이 동시에 훅을 써도 레이어 1개만 유지 */
let sharedMap: OLMap | null = null
let sharedSource: VectorSource | null = null
let sharedLayer: VectorLayer<VectorSource> | null = null
let sharedMountCount = 0
let sharedPulsePhase = 0
let sharedRadarRaf: number | null = null
let sharedRadarConsumers = 0

function startSharedRadar() {
  sharedRadarConsumers += 1
  if (sharedRadarRaf != null) return
  const loop = () => {
    sharedPulsePhase += DATA_QUERY_SELECTION_PULSE_STEP
    sharedSource?.changed()
    sharedRadarRaf = requestAnimationFrame(loop)
  }
  sharedRadarRaf = requestAnimationFrame(loop)
}

function stopSharedRadar() {
  sharedRadarConsumers = Math.max(0, sharedRadarConsumers - 1)
  if (sharedRadarConsumers > 0) return
  if (sharedRadarRaf != null) {
    cancelAnimationFrame(sharedRadarRaf)
    sharedRadarRaf = null
  }
  sharedPulsePhase = 0
}

function ensureSharedLayer(map: OLMap): VectorSource {
  if (sharedSource && sharedLayer && sharedMap === map) return sharedSource

  if (sharedLayer && sharedMap) {
    sharedMap.removeLayer(sharedLayer)
  }

  const source = new VectorSource()
  const layer = new VectorLayer({
    source,
    renderOrder: compareFeaturesByGeometryStackOrder,
    style: createGroundwaterPermitHighlightStyle(() => sharedPulsePhase),
  })
  layer.set(LAYER_PROP, true)
  // 데이터조회와 동일 — 서비스 WMS(기본 레이어) 아래에 두어 라벨을 가리지 않음
  insertLayerBelowServiceLayer(map, layer)

  sharedMap = map
  sharedSource = source
  sharedLayer = layer
  return source
}

function disposeSharedLayerIfUnused() {
  if (sharedMountCount > 0) return
  if (sharedRadarRaf != null) {
    cancelAnimationFrame(sharedRadarRaf)
    sharedRadarRaf = null
  }
  sharedRadarConsumers = 0
  sharedPulsePhase = 0
  if (sharedMap && sharedLayer) sharedMap.removeLayer(sharedLayer)
  sharedMap = null
  sharedSource = null
  sharedLayer = null
}

/**
 * 지하수 개발허가 선택/상세 → 데이터조회와 동일한 포인트 레이더 강조.
 * 맵 이동은 options.fit (기본 true). 지도 객체 클릭은 fit:false.
 */
export function useGroundwaterPermitMapHighlight() {
  const mapContext = useMapContext()
  const activeIdRef = useRef<string | null>(null)
  const [radarActive, setRadarActive] = useState(false)

  useEffect(() => {
    sharedMountCount += 1
    const map = mapContext?.mapInstanceRef?.current
    if (map) ensureSharedLayer(map)
    return () => {
      sharedMountCount -= 1
      disposeSharedLayerIfUnused()
    }
  }, [mapContext?.mapInstanceRef])

  useEffect(() => {
    if (!radarActive) return
    startSharedRadar()
    return () => stopSharedRadar()
  }, [radarActive])

  const clearHighlight = useCallback(() => {
    activeIdRef.current = null
    sharedSource?.clear()
    setRadarActive(false)
  }, [])

  const highlightById = useCallback(
    async (id: string, options?: { fit?: boolean }) => {
      const map = mapContext?.mapInstanceRef?.current
      if (!map || !id) return

      const source = ensureSharedLayer(map)
      const fit = options?.fit !== false
      activeIdRef.current = id

      try {
        const res = await call('', 'POST', {
          service: 'groundwaterPermitService',
          action: 'getGroundwaterPermitMapById',
          params: { id },
        })
        if (activeIdRef.current !== id) return

        const data = (res?.data ?? res) as {
          center3857?: [number, number] | null
          hasGeom?: boolean
          error?: string
        }
        source.clear()
        setRadarActive(false)

        const center = data?.center3857
        if (!data?.hasGeom || !Array.isArray(center) || center.length !== 2) {
          return
        }
        const x = Number(center[0])
        const y = Number(center[1])
        if (!Number.isFinite(x) || !Number.isFinite(y)) return

        const feature = new Feature({ geometry: new Point([x, y]), soinnKey: id })
        feature.set('isRadarPoint', true)
        source.addFeature(feature)
        setRadarActive(true)

        if (fit) {
          const pad = 40
          scheduleFitMapToExtent3857(map, [x - pad, y - pad, x + pad, y + pad], {
            maxZoom: Math.min(16, MAP_AUTO_NAV_MAX_ZOOM),
            pointZoom: Math.min(16, MAP_AUTO_NAV_MAX_ZOOM),
            applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
          })
        }
      } catch {
        // 목록·상세 선택은 유지, 지도만 실패
      }
    },
    [mapContext?.applyMapViewPaddingRef, mapContext?.mapInstanceRef]
  )

  return { highlightById, clearHighlight }
}
