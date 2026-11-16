'use client'

import { useEffect, useRef } from 'react'
import Feature from 'ol/Feature'
import GeoJSON from 'ol/format/GeoJSON'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Fill, Stroke, Style } from 'ol/style'
import type { StyleFunction } from 'ol/style/Style'
import '../../../_mapComponents/config/projections'
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../../_mapComponents/config/mapDefaults'
import { scheduleFitMapToExtent3857 } from '../../../_mapComponents/config/mapAutoNavigation'
import { useMapContext } from '../../../_mapComponents/MapContext'
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
} from '@/lib/mapDataQueryMapHighlight'
import { LAYER_GEOM_STACK_SKIP_KEY } from '@/lib/mapLayerGeometryOrder'
import type { WtlConsGeom4326 } from './wtlConsLedgerApi'

/** 공사목록·공사구역 선택 깜빡임. 공통 속도의 2.4배 */
const FOCUS_PULSE_STEP = DATA_QUERY_SELECTION_PULSE_STEP * 2.4

const MAIN_FILL = 'rgba(37, 99, 235, 0.18)'
const MAIN_STROKE = '#1d4ed8'
/** 관련시설 강조 — 도로·하천 선택 강조와 같은 최상단대 */
const FOCUS_LAYER_Z = 9999
/** 관련시설 선택 시 공사·구역 면이 강조를 가리지 않도록 */
const WORK_DIM_OPACITY = 0.38
const ZONE_DIM_OPACITY = 0.45

function pulseFeatureId(id: string) {
  return `pulse:${id}`
}

function withZIndex(styled: void | Style | Style[], zIndex: number): Style | Style[] | undefined {
  if (!styled) return undefined
  const list = Array.isArray(styled) ? styled : [styled]
  for (const style of list) style.setZIndex(zIndex)
  return list
}

/** 사업 전체 기본 도형. 파란 면은 고정이고 바깥 흰 테두리의 밝기·굵기만 크게 변한다. */
function baseRimStyle(phase: number): Style[] {
  const wave = Math.sin(phase)
  const whiteOp = Math.min(1, Math.max(0.35, 0.55 + 0.45 * wave))
  const whiteWidth = 8 + 3 * wave
  return [
    new Style({
      stroke: new Stroke({ color: `rgba(255, 255, 255, ${whiteOp})`, width: whiteWidth }),
      zIndex: 1,
    }),
    new Style({
      fill: new Fill({ color: 'rgba(37, 99, 235, 0.28)' }),
      stroke: new Stroke({ color: MAIN_STROKE, width: 2.5 }),
      zIndex: 2,
    }),
  ]
}

function featureStyle(feature: Feature, selectionStyle: StyleFunction, phase: number): Style | Style[] | undefined {
  if (feature.get('pulse')) {
    return withZIndex(selectionStyle(feature, 1) as Style | Style[] | undefined, 12)
  }
  if (feature.get('pulseDim')) return midSparkleStyle(feature, phase, 8)
  if (feature.get('rim')) return baseRimStyle(phase)
  return new Style({
    fill: new Fill({ color: MAIN_FILL }),
    stroke: new Stroke({ color: MAIN_STROKE, width: 1.5 }),
    zIndex: 1,
  })
}

/**
 * 고르지 않은 공사위치. 완전 밝기의 절반을 상한으로 두고 진폭도 줄인다.
 * 면 기준 완전 밝기: 흰 0.95 · 빨강 0.8 · 채움 0.22
 */
function midSparkleStyle(feature: Feature, phase: number, zIndex = 20): Style | Style[] {
  const wave = Math.sin(phase)
  const geomType = feature.getGeometry()?.getType()
  if (geomType === 'LineString' || geomType === 'MultiLineString') {
    const whiteOp = 0.35 + 0.15 * wave
    const redOp = 0.3 + 0.175 * wave
    return [
      new Style({ stroke: new Stroke({ color: `rgba(255, 255, 255, ${whiteOp})`, width: 4.5 + 0.75 * wave }), zIndex }),
      new Style({ stroke: new Stroke({ color: `rgba(220, 38, 38, ${redOp})`, width: 2.8 + 0.6 * wave }), zIndex }),
    ]
  }
  if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
    const whiteOp = 0.3 + 0.175 * wave
    const redOp = 0.25 + 0.15 * wave
    const fillOp = 0.06 + 0.05 * wave
    return [
      new Style({
        stroke: new Stroke({ color: `rgba(255, 255, 255, ${whiteOp})`, width: 3.5 + 0.5 * wave }),
        fill: new Fill({ color: `rgba(220, 38, 38, ${fillOp})` }),
        zIndex,
      }),
      new Style({
        stroke: new Stroke({ color: `rgba(220, 38, 38, ${redOp})`, width: 2 + 0.4 * wave }),
        zIndex,
      }),
    ]
  }
  return new Style({
    stroke: new Stroke({ color: `rgba(220, 38, 38, ${0.25 + 0.2 * wave})`, width: 3 }),
    fill: new Fill({ color: 'rgba(220, 38, 38, 0.08)' }),
    zIndex,
  })
}

/** 관련시설 강조. 공통 선택 스타일보다 굵게, 스타일 z도 최상단. */
function focusFeatureStyle(feature: Feature, selectionStyle: StyleFunction): Style | Style[] | undefined {
  const geomType = feature.getGeometry()?.getType()
  const styled = selectionStyle(feature, 1) as Style | Style[] | undefined
  if (!styled) return undefined
  const list = Array.isArray(styled) ? styled : [styled]
  if (geomType === 'LineString' || geomType === 'MultiLineString') {
    for (const style of list) {
      const stroke = style.getStroke()
      if (!stroke) continue
      const w = stroke.getWidth() ?? 5
      stroke.setWidth(w + 4)
      style.setZIndex(FOCUS_LAYER_Z)
    }
    return list
  }
  return withZIndex(styled, FOCUS_LAYER_Z)
}

function zoneFeatureStyle(feature: Feature, phase: number, selectionStyle: StyleFunction): Style | Style[] | undefined {
  if (feature.get('zoneOn')) {
    return withZIndex(selectionStyle(feature, 1) as Style | Style[] | undefined, 30)
  }
  return midSparkleStyle(feature, phase, 20)
}

function readGeom(
  format: GeoJSON,
  geom: Record<string, unknown> | WtlConsGeom4326,
  dataProjection: string
) {
  return format.readGeometry(geom, {
    dataProjection,
    featureProjection: 'EPSG:3857',
  })
}

export type WtlConsMapFocus = {
  geom: Record<string, unknown>
  projection: 'EPSG:4326' | 'EPSG:3857'
}

export type WtlConsProjectGeom = {
  id: string
  geom4326: WtlConsGeom4326 | null
}

export type WtlConsMapZone = {
  id: string
  geometry3857: Record<string, unknown> | null
}

export type WtlConsMapInput = {
  projectGeoms: WtlConsProjectGeom[]
  selectedId: string | null
  zones: WtlConsMapZone[]
  zoneId: string | null
  focus: WtlConsMapFocus | null
  /** 검색·사업 선택처럼 도형이 그대로여도 지도를 다시 맞출 때 올린다. */
  fitToken?: number
  /** 첨부파일이 가리는 아래 높이. 드래그 중에는 바꾸지 않는다. */
  bottomInset?: number
}

function finiteExtent(extent: number[] | undefined | null): number[] | null {
  if (!extent || extent.length !== 4) return null
  if (!extent.every((value) => Number.isFinite(value)) || extent[0] === Infinity) return null
  return extent
}

/** 공사대장 본표 면과, 선택한 공사구역 면을 지도에 올리고 그 범위로 이동한다. */
export function useWtlConsMapLayer(input: WtlConsMapInput) {
  const mapContext = useMapContext()
  const sourceRef = useRef<VectorSource | null>(null)
  const zoneSourceRef = useRef<VectorSource | null>(null)
  const focusSourceRef = useRef<VectorSource | null>(null)
  const workLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const zoneLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const focusLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const pulsePhaseRef = useRef(0)
  const focusPhaseRef = useRef(0)
  /** 이전 맞춤 기준. 탭·강조 해제만으로는 지도를 다시 맞추지 않는다. */
  const fitGateRef = useRef<{
    fitToken?: number
    selectedId: string | null
    projectKey: string
    focusKey: string
  } | null>(null)
  const selectionStyleRef = useRef(
    createDataQuerySelectionRowHighlightStyle(() => focusPhaseRef.current)
  )
  const bottomRef = mapContext?.mapPaddingBottomRef
  if (bottomRef) bottomRef.current = Math.max(0, input.bottomInset ?? 0)

  useEffect(() => {
    return () => {
      if (bottomRef) bottomRef.current = 0
      mapContext?.applyMapViewPaddingRef?.current?.()
    }
  }, [bottomRef, mapContext?.applyMapViewPaddingRef])
  const inputRef = useRef(input)
  inputRef.current = input
  const projectKey = input.projectGeoms.map((item) => `${item.id}:${item.geom4326 ? 1 : 0}`).join(',')
  const zoneKey = `${input.zoneId ?? ''}|${input.zones.map((zone) => `${zone.id}:${zone.geometry3857 ? 1 : 0}`).join(',')}`
  const focusKey = input.focus ? `${input.focus.projection}:${JSON.stringify(input.focus.geom).slice(0, 180)}` : ''

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return

    const source = new VectorSource()
    sourceRef.current = source
    const layer = new VectorLayer({
      source,
      style: (feature) => featureStyle(feature as Feature, selectionStyleRef.current, pulsePhaseRef.current),
      zIndex: 890,
    })
    layer.set('wtlConsWork', true)
    layer.set(LAYER_GEOM_STACK_SKIP_KEY, true)
    workLayerRef.current = layer
    const zoneSource = new VectorSource()
    zoneSourceRef.current = zoneSource
    const zoneLayer = new VectorLayer({
      source: zoneSource,
      style: (feature) => zoneFeatureStyle(feature as Feature, pulsePhaseRef.current, selectionStyleRef.current),
      zIndex: 891,
    })
    zoneLayer.set('wtlConsZone', true)
    zoneLayer.set(LAYER_GEOM_STACK_SKIP_KEY, true)
    zoneLayerRef.current = zoneLayer
    const focusSource = new VectorSource()
    focusSourceRef.current = focusSource
    const focusLayer = new VectorLayer({
      source: focusSource,
      style: (feature) => focusFeatureStyle(feature as Feature, selectionStyleRef.current),
      zIndex: FOCUS_LAYER_Z,
    })
    focusLayer.set('wtlConsFocus', true)
    focusLayer.set(LAYER_GEOM_STACK_SKIP_KEY, true)
    focusLayerRef.current = focusLayer
    map.addLayer(layer)
    map.addLayer(zoneLayer)
    map.addLayer(focusLayer)

    return () => {
      sourceRef.current = null
      zoneSourceRef.current = null
      focusSourceRef.current = null
      workLayerRef.current = null
      zoneLayerRef.current = null
      focusLayerRef.current = null
      map.removeLayer(layer)
      map.removeLayer(zoneLayer)
      map.removeLayer(focusLayer)
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady])

  useEffect(() => {
    let rafId = 0
    const loop = () => {
      pulsePhaseRef.current += DATA_QUERY_SELECTION_PULSE_STEP
      focusPhaseRef.current += FOCUS_PULSE_STEP
      sourceRef.current?.forEachFeature((feature) => {
        if (feature.get('pulse') || feature.get('pulseDim') || feature.get('rim')) feature.changed()
      })
      zoneSourceRef.current?.forEachFeature((feature) => {
        if (feature.get('sparkle')) feature.changed()
      })
      focusSourceRef.current?.forEachFeature((feature) => {
        if (feature.get('focus')) feature.changed()
      })
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    const source = sourceRef.current
    const zoneSource = zoneSourceRef.current
    const focusSource = focusSourceRef.current
    if (!map || !source || !zoneSource || !focusSource) return
    source.clear()
    zoneSource.clear()
    focusSource.clear()
    const current = inputRef.current
    const hasFocus = Boolean(current.focus?.geom)
    const workLayer = workLayerRef.current
    const zoneLayer = zoneLayerRef.current
    const focusLayer = focusLayerRef.current
    if (workLayer) workLayer.setOpacity(hasFocus ? WORK_DIM_OPACITY : 1)
    if (zoneLayer) zoneLayer.setOpacity(hasFocus ? ZONE_DIM_OPACITY : 1)
    if (focusLayer) {
      focusLayer.setZIndex(FOCUS_LAYER_Z)
      focusLayer.set(LAYER_GEOM_STACK_SKIP_KEY, true)
      const layers = map.getLayers()
      if (layers.getArray().includes(focusLayer)) {
        layers.remove(focusLayer)
        layers.push(focusLayer)
      }
    }
    const format = new GeoJSON()
    let focusFeature: Feature | null = null
    let selectedFeature: Feature | null = null
    let zoneFeature: Feature | null = null
    try {
      for (const item of current.projectGeoms) {
        if (!item.geom4326) continue
        const geometry = readGeom(format, item.geom4326, 'EPSG:4326')
        const feature = new Feature(geometry)
        feature.setId(item.id)
        feature.set('rim', true)
        source.addFeature(feature)
        const selectedWork = item.id === current.selectedId
        if (selectedWork) selectedFeature = feature
        const zonesCoverWork = selectedWork && current.zones.some((zone) => zone.geometry3857)
        if (!selectedWork || zonesCoverWork) continue
        const pulse = new Feature(geometry.clone())
        pulse.setId(pulseFeatureId(item.id))
        pulse.set('pulse', true)
        source.addFeature(pulse)
      }
      for (const zone of current.zones) {
        if (!zone.geometry3857) continue
        const feature = new Feature(readGeom(format, zone.geometry3857, 'EPSG:3857'))
        const selected = zone.id === current.zoneId
        feature.setId(`zone:${zone.id}`)
        feature.set('zoneOn', selected)
        feature.set('sparkle', true)
        zoneSource.addFeature(feature)
        if (selected) zoneFeature = feature
      }
      if (current.focus?.geom) {
        focusFeature = new Feature(readGeom(format, current.focus.geom, current.focus.projection))
        focusFeature.set('focus', true)
        const focusGeomType = focusFeature.getGeometry()?.getType()
        if (focusGeomType === 'Point' || focusGeomType === 'MultiPoint') {
          focusFeature.set('isRadarPoint', true)
        }
        focusSource.addFeature(focusFeature)
      }
    } catch {
      source.clear()
      zoneSource.clear()
      focusSource.clear()
      return
    }

    const prev = fitGateRef.current
    const focusAcquired = Boolean(focusKey) && focusKey !== prev?.focusKey
    const shouldFit =
      !prev ||
      prev.fitToken !== current.fitToken ||
      prev.selectedId !== current.selectedId ||
      prev.projectKey !== projectKey ||
      focusAcquired
    fitGateRef.current = {
      fitToken: current.fitToken,
      selectedId: current.selectedId,
      projectKey,
      focusKey,
    }
    if (!shouldFit) return

    const preferred = (focusFeature ?? zoneFeature ?? selectedFeature)?.getGeometry()?.getExtent()
    const extent = finiteExtent(preferred) ?? finiteExtent(source.getExtent())
    if (!extent) return
    const paddingRef = mapContext?.applyMapViewPaddingRef
    const mapRef = mapContext?.mapInstanceRef
    // 사업·공사 선택·관련시설 신규 선택·명시 fitToken 때만 맞춤. 탭·강조 해제는 제외.
    const timer = window.setTimeout(() => {
      const liveMap = mapRef?.current
      if (!liveMap) return
      scheduleFitMapToExtent3857(liveMap, extent, {
        maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
        applyMapViewPadding: () => paddingRef?.current?.(),
      })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [
    projectKey,
    input.fitToken,
    input.selectedId,
    zoneKey,
    focusKey,
    mapContext?.applyMapViewPaddingRef,
    mapContext?.mapInstanceRef,
    mapContext?.mapReady,
  ])
}
