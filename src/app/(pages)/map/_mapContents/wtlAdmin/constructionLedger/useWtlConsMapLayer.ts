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
import type { WtlConsGeom4326 } from './wtlConsLedgerApi'

/** 공사목록·공사구역 선택 깜빡임. 공통 속도의 2.4배 */
const FOCUS_PULSE_STEP = DATA_QUERY_SELECTION_PULSE_STEP * 2.4

const MAIN_FILL = 'rgba(37, 99, 235, 0.18)'
const MAIN_STROKE = '#1d4ed8'
const FOCUS_FILL = 'rgba(22, 163, 74, 0.28)'
const FOCUS_STROKE = '#15803d'

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

function zoneFeatureStyle(feature: Feature, phase: number, selectionStyle: StyleFunction): Style | Style[] | undefined {
  if (feature.get('focus')) {
    return new Style({
      fill: new Fill({ color: FOCUS_FILL }),
      stroke: new Stroke({ color: FOCUS_STROKE, width: 3 }),
      zIndex: 40,
    })
  }
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
  const pulsePhaseRef = useRef(0)
  const focusPhaseRef = useRef(0)
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
    const zoneSource = new VectorSource()
    zoneSourceRef.current = zoneSource
    const zoneLayer = new VectorLayer({
      source: zoneSource,
      style: (feature) => zoneFeatureStyle(feature as Feature, pulsePhaseRef.current, selectionStyleRef.current),
      zIndex: 891,
    })
    zoneLayer.set('wtlConsZone', true)
    map.addLayer(layer)
    map.addLayer(zoneLayer)

    return () => {
      sourceRef.current = null
      zoneSourceRef.current = null
      map.removeLayer(layer)
      map.removeLayer(zoneLayer)
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
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    const source = sourceRef.current
    const zoneSource = zoneSourceRef.current
    if (!map || !source || !zoneSource) return
    source.clear()
    zoneSource.clear()
    const current = inputRef.current
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
        zoneSource.addFeature(focusFeature)
      }
    } catch {
      source.clear()
      zoneSource.clear()
      return
    }

    const preferred = (focusFeature ?? zoneFeature ?? selectedFeature)?.getGeometry()?.getExtent()
    const extent = finiteExtent(preferred) ?? finiteExtent(source.getExtent())
    if (!extent) return
    const paddingRef = mapContext?.applyMapViewPaddingRef
    const mapRef = mapContext?.mapInstanceRef
    // 다른 목록 메뉴와 같이, 패널 여백이 반영된 뒤에 같은 맞춤을 쓴다.
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
    input.bottomInset,
    mapContext?.applyMapViewPaddingRef,
    mapContext?.mapInstanceRef,
    mapContext?.mapReady,
  ])
}
