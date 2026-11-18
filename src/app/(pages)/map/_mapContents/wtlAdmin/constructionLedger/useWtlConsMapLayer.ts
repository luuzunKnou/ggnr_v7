'use client'

import { useEffect, useRef } from 'react'
import Feature from 'ol/Feature'
import type Map from 'ol/Map'
import GeoJSON from 'ol/format/GeoJSON'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Fill, Icon, Stroke, Style } from 'ol/style'
import type { StyleFunction } from 'ol/style/Style'
import '../../../_mapComponents/config/projections'
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../../_mapComponents/config/mapDefaults'
import { scheduleFitMapToExtent3857 } from '../../../_mapComponents/config/mapAutoNavigation'
import { useMapContext } from '../../../_mapComponents/MapContext'
import {
  createDataQueryIdentifyHoverStyle,
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
} from '@/lib/mapDataQueryMapHighlight'
import { LAYER_GEOM_STACK_SKIP_KEY } from '@/lib/mapLayerGeometryOrder'
import type { WtlConsGeom4326 } from './wtlConsLedgerApi'
import {
  peekRelatedFacilityIcon,
  prefetchRelatedFacilityStyles,
  resolveRelatedFacilityOlStyle,
} from './wtlConsRelatedStyle'

const MAIN_FILL = 'rgba(37, 99, 235, 0.18)'
const MAIN_STROKE = '#1d4ed8'
/** 관련시설 강조 — 도로·하천 선택 강조와 같은 최상단대 */
const FOCUS_LAYER_Z = 9999
/** 관련시설 전체(미선택) — 공사·구역 위, 선택 강조 아래 */
const RELATED_LAYER_Z = 892
/** 관련시설 선택 시 공사·구역 면이 강조를 가리지 않도록 */
const WORK_DIM_OPACITY = 0.38
const ZONE_DIM_OPACITY = 0.45

function withZIndex(styled: void | Style | Style[], zIndex: number): Style | Style[] | undefined {
  if (!styled) return undefined
  const list = Array.isArray(styled) ? styled : [styled]
  for (const style of list) style.setZIndex(zIndex)
  return list
}

/** 사업·공사 기본 도형 (고정, 깜빡임 없음) */
function workBaseStyle(emphasized: boolean): Style[] {
  if (emphasized) {
    return [
      new Style({
        stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.85)', width: 8 }),
        zIndex: 1,
      }),
      new Style({
        fill: new Fill({ color: 'rgba(37, 99, 235, 0.28)' }),
        stroke: new Stroke({ color: MAIN_STROKE, width: 2.5 }),
        zIndex: 2,
      }),
    ]
  }
  return [
    new Style({
      fill: new Fill({ color: MAIN_FILL }),
      stroke: new Stroke({ color: MAIN_STROKE, width: 1.5 }),
      zIndex: 1,
    }),
  ]
}

function featureStyle(feature: Feature, selectionStyle: StyleFunction): Style | Style[] | undefined {
  if (feature.get('workOn')) {
    return withZIndex(selectionStyle(feature, 1) as Style | Style[] | undefined, 12)
  }
  return workBaseStyle(Boolean(feature.get('rim')))
}

/** 미선택 공사위치 — 고정 빨간 테두리 */
function zoneIdleStyle(feature: Feature, zIndex = 20): Style | Style[] {
  const geomType = feature.getGeometry()?.getType()
  if (geomType === 'LineString' || geomType === 'MultiLineString') {
    return [
      new Style({ stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.45)', width: 4.5 }), zIndex }),
      new Style({ stroke: new Stroke({ color: 'rgba(220, 38, 38, 0.4)', width: 2.8 }), zIndex }),
    ]
  }
  if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
    return [
      new Style({
        stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.4)', width: 3.5 }),
        fill: new Fill({ color: 'rgba(220, 38, 38, 0.08)' }),
        zIndex,
      }),
      new Style({
        stroke: new Stroke({ color: 'rgba(220, 38, 38, 0.35)', width: 2 }),
        zIndex,
      }),
    ]
  }
  return new Style({
    stroke: new Stroke({ color: 'rgba(220, 38, 38, 0.35)', width: 3 }),
    fill: new Fill({ color: 'rgba(220, 38, 38, 0.08)' }),
    zIndex,
  })
}

/** 선택 공사위치 — 흰 테두리 + 검정선 (공사 빨간 강조와 구분) */
function zoneSelectedStyle(feature: Feature, zIndex = 30): Style | Style[] {
  const geomType = feature.getGeometry()?.getType()
  if (geomType === 'LineString' || geomType === 'MultiLineString') {
    return [
      new Style({ stroke: new Stroke({ color: '#ffffff', width: 9 }), zIndex }),
      new Style({ stroke: new Stroke({ color: '#111827', width: 5 }), zIndex }),
    ]
  }
  if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
    return [
      new Style({
        stroke: new Stroke({ color: '#ffffff', width: 8 }),
        fill: new Fill({ color: 'rgba(17, 24, 39, 0.12)' }),
        zIndex,
      }),
      new Style({
        stroke: new Stroke({ color: '#111827', width: 3.5 }),
        zIndex,
      }),
    ]
  }
  return new Style({
    stroke: new Stroke({ color: '#111827', width: 4 }),
    fill: new Fill({ color: 'rgba(17, 24, 39, 0.15)' }),
    zIndex,
  })
}

/** 관련시설 — GeoServer 레이어 심볼(조건 ftr_cde 포함). 없으면 모듈 폴백 */
function relatedFacilityStyle(feature: Feature, onStyleReady: () => void): Style | Style[] {
  const styleName = String(feature.get('styleName') ?? '').trim()
  const styleCode = String(feature.get('styleCode') ?? '').trim() || null
  if (!styleName) {
    return resolveRelatedFacilityOlStyle('', null, feature.getGeometry()?.getType(), onStyleReady)
  }
  return resolveRelatedFacilityOlStyle(
    styleName,
    styleCode,
    feature.getGeometry()?.getType(),
    onStyleReady
  )
}

/**
 * 관련시설 포커스.
 * - 심볼(점): SLD 크기 유지 + 데이터조회와 같은 레이더/펄스
 * - 관(선): 원래 심볼 + 얇은 흰·검정 테두리
 */
function focusFeatureStyle(
  feature: Feature,
  pulseStyle: StyleFunction,
  onStyleReady: () => void
): Style | Style[] | undefined {
  const geomType = feature.getGeometry()?.getType()
  const styleName = String(feature.get('styleName') ?? '').trim()
  const styleCode = String(feature.get('styleCode') ?? '').trim() || null
  if ((geomType === 'Point' || geomType === 'MultiPoint') && styleName) {
    const icon = peekRelatedFacilityIcon(styleName, styleCode)
    const pulse = pulseStyle(feature, 1) as Style | Style[] | undefined
    const pulseList = pulse ? (Array.isArray(pulse) ? pulse : [pulse]) : []
    for (const style of pulseList) style.setZIndex(FOCUS_LAYER_Z)
    if (icon) {
      return [
        new Style({
          zIndex: FOCUS_LAYER_Z + 1,
          image: new Icon({
            src: icon.src,
            scale: icon.scale,
            anchor: [0.5, 0.5],
            opacity: 1,
          }),
        }),
        ...pulseList,
      ]
    }
    return withZIndex(pulse, FOCUS_LAYER_Z)
  }
  if (geomType === 'LineString' || geomType === 'MultiLineString') {
    const base = relatedFacilityStyle(feature, onStyleReady)
    const baseList = Array.isArray(base) ? base : [base]
    let coreW: number | null = null
    for (const style of baseList) {
      const stroke = style.getStroke()
      const w = stroke?.getWidth()
      if (typeof w === 'number') coreW = coreW == null ? w : Math.min(coreW, w)
      style.setZIndex(FOCUS_LAYER_Z + 1)
    }
    const pipeW = coreW ?? 2.5
    return [
      new Style({
        stroke: new Stroke({ color: '#ffffff', width: pipeW + 5 }),
        zIndex: FOCUS_LAYER_Z,
      }),
      new Style({
        stroke: new Stroke({ color: '#111827', width: pipeW + 2.5 }),
        zIndex: FOCUS_LAYER_Z,
      }),
      ...baseList,
    ]
  }
  const styled = pulseStyle(feature, 1) as Style | Style[] | undefined
  if (!styled) return undefined
  return withZIndex(styled, FOCUS_LAYER_Z)
}

function zoneFeatureStyle(feature: Feature): Style | Style[] {
  if (feature.get('zoneOn')) return zoneSelectedStyle(feature, 30)
  return zoneIdleStyle(feature, 20)
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
  /** 관련시설 선택 시 심볼 유지용 */
  styleName?: string
  styleCode?: string | null
  /** true면 이 포커스로 지도 맞춤하지 않음(화면만 표시 등) */
  skipFit?: boolean
}

/** 관련시설 목록 도형 — 지하시설물 패널과 무관하게 벡터로만 그림 */
export type WtlConsRelatedFacility = {
  id: string
  geom: Record<string, unknown>
  projection: 'EPSG:4326' | 'EPSG:3857'
  /** getGeoServerStyle name — 보통 관망 layerKey */
  styleName: string
  /** SLD 조건 심볼 키 (ftr_cde 등) */
  styleCode?: string | null
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
  /** 관련시설(변류·관로 등) 전체. 패널 체크 없이 표시 */
  relatedFacilities?: WtlConsRelatedFacility[]
  /** 검색·사업 선택처럼 도형이 그대로여도 지도를 다시 맞출 때 올린다. */
  fitToken?: number
  /** 첨부파일이 가리는 아래 높이. 드래그 중에는 바꾸지 않는다. */
  bottomInset?: number
  /**
   * «화면에 보이는 시설만» ON
   * - 공사위치·시설·이력: 너무 축소면 줌인. 걸친 큰 도형 줌아웃·불필요 무브 없음
   * - 필지·건물: 이미 겹치면 맵무브·줌 없음(목록 갱신 방지)
   * OFF(전체): 선택 시 해당 범위로 맞춤(줌인·줌아웃)
   */
  suppressListFit?: boolean
}

function finiteExtent(extent: number[] | undefined | null): number[] | null {
  if (!extent || extent.length !== 4) return null
  if (!extent.every((value) => Number.isFinite(value)) || extent[0] === Infinity) return null
  return extent
}

/** 대상 extent가 현재 지도 화면과 겹치면 true */
export function extentTouchesView(map: Map, extent: number[]): boolean {
  const size = map.getSize()
  if (!size || size[0]! <= 0 || size[1]! <= 0) return false
  const viewExtent = map.getView().calculateExtent(size)
  return (
    extent[0]! < viewExtent[2]! &&
    extent[2]! > viewExtent[0]! &&
    extent[1]! < viewExtent[3]! &&
    extent[3]! > viewExtent[1]!
  )
}

function resolutionForExtent(map: Map, extent: number[]): number | null {
  const view = map.getView()
  const size = map.getSize()
  if (!size || size[0]! <= 0 || size[1]! <= 0) return null
  const availW = Math.max(1, size[0]! - 160)
  const availH = Math.max(1, size[1]! - 160)
  const needed = view.getResolutionForExtent(extent, [availW, availH])
  if (!Number.isFinite(needed) || !(needed > 0)) return null
  return needed
}

/** 대상 전체를 넣으려면 지금보다 축소해야 하면 true */
function fitWouldZoomOut(map: Map, extent: number[]): boolean {
  const currentRes = map.getView().getResolution()
  const needed = resolutionForExtent(map, extent)
  if (currentRes == null || !(currentRes > 0) || needed == null) return false
  return needed > currentRes * 1.02
}

/** 대상에 맞추려면 지금보다 확대(줌인)해야 하면 true */
function fitWouldZoomIn(map: Map, extent: number[]): boolean {
  const currentRes = map.getView().getResolution()
  const needed = resolutionForExtent(map, extent)
  if (currentRes == null || !(currentRes > 0) || needed == null) return false
  return needed < currentRes * 0.98
}

/** 공사대장 본표 면과, 선택한 공사구역 면을 지도에 올리고 그 범위로 이동한다. */
export function useWtlConsMapLayer(input: WtlConsMapInput) {
  const mapContext = useMapContext()
  const sourceRef = useRef<VectorSource | null>(null)
  const zoneSourceRef = useRef<VectorSource | null>(null)
  const relatedSourceRef = useRef<VectorSource | null>(null)
  const focusSourceRef = useRef<VectorSource | null>(null)
  const workLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const zoneLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const relatedLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const focusLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  /** 이전 맞춤 기준. 탭·강조 해제만으로는 지도를 다시 맞추지 않는다. */
  const fitGateRef = useRef<{
    fitToken?: number
    selectedId: string | null
    /** 선택 공사(또는 사업 전체) 도형 준비 여부 — 전체도형 스위치로 형제만 늘면 바뀌지 않음 */
    selectedGeomKey: string
    focusKey: string
    zoneId: string | null
  } | null>(null)
  /** 공사 선택 — 고정 강조(깜빡임 없음) */
  const selectionStyleRef = useRef(createDataQueryIdentifyHoverStyle())
  /** 관련시설 포커스 — 데이터조회와 동일 레이더/펄스 */
  const focusPhaseRef = useRef(0)
  const focusPulseStyleRef = useRef(
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
  /** 맵무브 조건용. 사업 전체 도형 ON으로 형제 도형만 추가될 때는 변하지 않음 */
  const selectedGeomKey = input.selectedId
    ? `${input.selectedId}|${
        input.projectGeoms.some((item) => item.id === input.selectedId && item.geom4326) ? 1 : 0
      }`
    : `*|${input.projectGeoms.filter((item) => item.geom4326).length}`
  const zoneKey = `${input.zoneId ?? ''}|${input.zones.map((zone) => `${zone.id}:${zone.geometry3857 ? 1 : 0}`).join(',')}`
  const focusKey = input.focus ? `${input.focus.projection}:${JSON.stringify(input.focus.geom).slice(0, 180)}` : ''
  const relatedKey = (input.relatedFacilities ?? [])
    .map(
      (item) =>
        `${item.id}:${item.styleName}:${item.styleCode ?? ''}:${item.projection}:${JSON.stringify(item.geom).slice(0, 80)}`
    )
    .join('|')

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return

    const source = new VectorSource()
    sourceRef.current = source
    const layer = new VectorLayer({
      source,
      style: (feature) => featureStyle(feature as Feature, selectionStyleRef.current),
      zIndex: 890,
    })
    layer.set('wtlConsWork', true)
    layer.set(LAYER_GEOM_STACK_SKIP_KEY, true)
    workLayerRef.current = layer
    const zoneSource = new VectorSource()
    zoneSourceRef.current = zoneSource
    const zoneLayer = new VectorLayer({
      source: zoneSource,
      style: (feature) => zoneFeatureStyle(feature as Feature),
      zIndex: 891,
    })
    zoneLayer.set('wtlConsZone', true)
    zoneLayer.set(LAYER_GEOM_STACK_SKIP_KEY, true)
    zoneLayerRef.current = zoneLayer
    const relatedSource = new VectorSource()
    relatedSourceRef.current = relatedSource
    const relatedLayer = new VectorLayer({
      source: relatedSource,
      style: (feature) =>
        relatedFacilityStyle(feature as Feature, () => {
          relatedLayerRef.current?.changed()
        }),
      zIndex: RELATED_LAYER_Z,
    })
    relatedLayer.set('wtlConsRelated', true)
    relatedLayer.set(LAYER_GEOM_STACK_SKIP_KEY, true)
    relatedLayerRef.current = relatedLayer
    const focusSource = new VectorSource()
    focusSourceRef.current = focusSource
    const focusLayer = new VectorLayer({
      source: focusSource,
      style: (feature) =>
        focusFeatureStyle(feature as Feature, focusPulseStyleRef.current, () => {
          focusLayerRef.current?.changed()
        }),
      zIndex: FOCUS_LAYER_Z,
    })
    focusLayer.set('wtlConsFocus', true)
    focusLayer.set(LAYER_GEOM_STACK_SKIP_KEY, true)
    focusLayerRef.current = focusLayer
    map.addLayer(layer)
    map.addLayer(zoneLayer)
    map.addLayer(relatedLayer)
    map.addLayer(focusLayer)

    return () => {
      sourceRef.current = null
      zoneSourceRef.current = null
      relatedSourceRef.current = null
      focusSourceRef.current = null
      workLayerRef.current = null
      zoneLayerRef.current = null
      relatedLayerRef.current = null
      focusLayerRef.current = null
      map.removeLayer(layer)
      map.removeLayer(zoneLayer)
      map.removeLayer(relatedLayer)
      map.removeLayer(focusLayer)
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady])

  /** 관련시설 포커스만 펄스(공사·구역 깜빡임은 유지하지 않음) */
  useEffect(() => {
    let rafId = 0
    const loop = () => {
      focusPhaseRef.current += DATA_QUERY_SELECTION_PULSE_STEP
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
    const relatedSource = relatedSourceRef.current
    const focusSource = focusSourceRef.current
    if (!map || !source || !zoneSource || !relatedSource || !focusSource) return
    source.clear()
    zoneSource.clear()
    relatedSource.clear()
    focusSource.clear()
    const current = inputRef.current
    const hasFocus = Boolean(current.focus?.geom)
    const workLayer = workLayerRef.current
    const zoneLayer = zoneLayerRef.current
    const relatedLayer = relatedLayerRef.current
    const focusLayer = focusLayerRef.current
    if (workLayer) workLayer.setOpacity(hasFocus ? WORK_DIM_OPACITY : 1)
    if (zoneLayer) zoneLayer.setOpacity(hasFocus ? ZONE_DIM_OPACITY : 1)
    if (relatedLayer) relatedLayer.setOpacity(hasFocus ? 0.55 : 1)
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
      const hasWorkSelection = Boolean(current.selectedId)
      for (const item of current.projectGeoms) {
        if (!item.geom4326) continue
        const geometry = readGeom(format, item.geom4326, 'EPSG:4326')
        const feature = new Feature(geometry)
        feature.setId(item.id)
        const selectedWork = item.id === current.selectedId
        // 선택 공사(또는 사업만 볼 때)는 강조 테두리, 형제 도형은 기본 표시
        if (selectedWork) feature.set('workOn', true)
        else if (!hasWorkSelection) feature.set('rim', true)
        source.addFeature(feature)
        if (selectedWork) selectedFeature = feature
      }
      for (const zone of current.zones) {
        if (!zone.geometry3857) continue
        const feature = new Feature(readGeom(format, zone.geometry3857, 'EPSG:3857'))
        const selected = zone.id === current.zoneId
        feature.setId(`zone:${zone.id}`)
        feature.set('zoneOn', selected)
        zoneSource.addFeature(feature)
        if (selected) zoneFeature = feature
      }
      for (const item of current.relatedFacilities ?? []) {
        if (!item.geom) continue
        const feature = new Feature(readGeom(format, item.geom, item.projection))
        feature.setId(`related:${item.id}`)
        feature.set('related', true)
        feature.set('styleName', item.styleName)
        feature.set('styleCode', item.styleCode ?? '')
        relatedSource.addFeature(feature)
      }
      if (current.focus?.geom) {
        focusFeature = new Feature(readGeom(format, current.focus.geom, current.focus.projection))
        focusFeature.set('focus', true)
        if (current.focus.styleName) {
          focusFeature.set('styleName', current.focus.styleName)
          focusFeature.set('styleCode', current.focus.styleCode ?? '')
        }
        const focusGeomType = focusFeature.getGeometry()?.getType()
        if (focusGeomType === 'Point' || focusGeomType === 'MultiPoint') {
          focusFeature.set('isRadarPoint', true)
        }
        focusSource.addFeature(focusFeature)
      }
    } catch {
      source.clear()
      zoneSource.clear()
      relatedSource.clear()
      focusSource.clear()
      return
    }

    const prev = fitGateRef.current
    const suppressListFit = Boolean(current.suppressListFit)
    const focusAcquired = Boolean(focusKey) && focusKey !== prev?.focusKey
    /** 공사위치·목록 포커스: 화면만이면 겹칠 때 무브 없음, 밖만 맞춤 */
    const zoneAcquired =
      Boolean(current.zoneId) && current.zoneId !== prev?.zoneId
    /** 공사위치 해제 시 선택 공사로 줌아웃. 이력·시설 포커스로 지운 경우는 제외 */
    const zoneReleased =
      Boolean(prev?.zoneId) && !current.zoneId && !focusKey
    const focusWantsFit = focusAcquired
    const zoneWantsFit = zoneAcquired
    const shouldFit =
      !prev ||
      prev.fitToken !== current.fitToken ||
      prev.selectedId !== current.selectedId ||
      prev.selectedGeomKey !== selectedGeomKey ||
      focusWantsFit ||
      zoneWantsFit ||
      zoneReleased
    const gateSnapshot = {
      fitToken: current.fitToken,
      selectedId: current.selectedId,
      selectedGeomKey,
      focusKey,
      zoneId: current.zoneId,
    }
    if (!shouldFit) return

    const paddingRef = mapContext?.applyMapViewPaddingRef
    const mapRef = mapContext?.mapInstanceRef

    /**
     * 화면만 ON (공사위치·시설·이력):
     * - 줌아웃 필요(큰 도형) → 무브·줌 없음
     * - 이미 적정 줌으로 보임 → 무브 없음
     * - 너무 축소 → 줌인만(noZoomOut)
     * 전체 OFF → 범위 맞춤
     */
    const fitListTarget = (extent: number[]) => {
      const liveMap = mapRef?.current
      if (!liveMap) return
      fitGateRef.current = gateSnapshot
      if (suppressListFit) {
        if (fitWouldZoomOut(liveMap, extent)) return
        if (extentTouchesView(liveMap, extent) && !fitWouldZoomIn(liveMap, extent)) return
      }
      scheduleFitMapToExtent3857(liveMap, extent, {
        maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
        noZoomOut: suppressListFit,
        applyMapViewPadding: () => paddingRef?.current?.(),
      })
    }

    // 관련시설·수용가·공사이력 포커스
    if (focusWantsFit) {
      const focusExtent = finiteExtent(focusFeature?.getGeometry()?.getExtent())
      if (!focusExtent) {
        fitGateRef.current = gateSnapshot
        return
      }
      const timer = window.setTimeout(() => fitListTarget(focusExtent), 80)
      return () => window.clearTimeout(timer)
    }

    // 공사위치
    if (zoneWantsFit) {
      const zoneExtent = finiteExtent(zoneFeature?.getGeometry()?.getExtent())
      if (!zoneExtent) {
        fitGateRef.current = gateSnapshot
        return
      }
      const timer = window.setTimeout(() => fitListTarget(zoneExtent), 80)
      return () => window.clearTimeout(timer)
    }

    // 공사 선택·구역 해제 등
    const preferred = (() => {
      if (zoneReleased) {
        return (
          selectedFeature?.getGeometry()?.getExtent() ??
          finiteExtent(source.getExtent()) ??
          undefined
        )
      }
      if (current.zoneId && zoneFeature) return zoneFeature.getGeometry()?.getExtent()
      return selectedFeature?.getGeometry()?.getExtent()
    })()
    const extent = finiteExtent(preferred) ?? finiteExtent(source.getExtent())
    if (!extent) return
    const timer = window.setTimeout(() => {
      const liveMap = mapRef?.current
      if (!liveMap) return
      fitGateRef.current = gateSnapshot
      scheduleFitMapToExtent3857(liveMap, extent, {
        maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
        applyMapViewPadding: () => paddingRef?.current?.(),
      })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [
    projectKey,
    selectedGeomKey,
    input.fitToken,
    input.selectedId,
    input.suppressListFit,
    zoneKey,
    focusKey,
    relatedKey,
    mapContext?.applyMapViewPaddingRef,
    mapContext?.mapInstanceRef,
    mapContext?.mapReady,
  ])

  /** 관련시설 목록이 바뀔 때만 SLD·심볼 재조회 (선택 토글 등과 분리) */
  useEffect(() => {
    const entries = (inputRef.current.relatedFacilities ?? []).map((item) => ({
      styleName: item.styleName,
      styleCode: item.styleCode,
    }))
    if (entries.length === 0) return
    let cancelled = false
    void prefetchRelatedFacilityStyles(entries, { refresh: true }).then(() => {
      if (cancelled) return
      relatedLayerRef.current?.changed()
      focusLayerRef.current?.changed()
    })
    return () => {
      cancelled = true
    }
  }, [relatedKey])
}
