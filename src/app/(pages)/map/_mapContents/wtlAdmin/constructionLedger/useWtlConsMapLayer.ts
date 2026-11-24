'use client'

/**
 * =============================================================================
 * [공사대장 · 지도 맞춤 UX 의도 — 임의로 바꾸지 말 것]
 * =============================================================================
 *
 * 1) 공사목록에서 공사 선택
 *    → 해당 공사 전체 범위로 맞춤 (필요하면 줌아웃). «화면만» 체크와 무관.
 *
 * 2) 공사위치 행 선택 («화면에 보이는 시설만» ON 일 때)
 *    - 전체공사 축척처럼 대상이 화면에 걸치지만 너무 작음 → 줌인 (의도된 진입)
 *    - 이미 가까이 보고 있음(걸침 + 줌인 불필요) → 맵무브·줌 없음 (휠은 사용자)
 *    - 화면 밖 → 그쪽으로 이동 (줌아웃만 금지)
 *    ※ «화면에 보이면 무조건 줌 금지»로 바꾸면 1→2 줌인이 사라짐. 금지.
 *
 * 3) 관련시설·필지·수용가 등 목록 선택
 *    → 강조만. 맵무브·줌인·줌아웃 없음 («화면만» ON).
 *
 * 4) 사용자가 휠·드래그로 보는 중
 *    → 자동 fit 으로 가로채지 말 것. 목록 범위 갱신은 moveend 이후.
 *
 * 관련: WtlConsRelatedTabs (조회 범위·체크), wtlConsRelatedStyle (아이콘)
 * =============================================================================
 */

import { useEffect, useRef } from 'react'
import Feature from 'ol/Feature'
import {
  containsXY,
  getCenter,
  getIntersection,
  intersects as extentIntersects,
  isEmpty,
} from 'ol/extent'
import type { Geometry } from 'ol/geom'
import type SimpleGeometry from 'ol/geom/SimpleGeometry'
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
} from '@/lib/mapDataQueryMapHighlight'
import { LAYER_GEOM_STACK_SKIP_KEY } from '@/lib/mapLayerGeometryOrder'
import type { WtlConsGeom4326 } from './wtlConsLedgerApi'
import {
  peekRelatedFacilityIcon,
  prefetchRelatedFacilityStyles,
  resolveRelatedFacilityOlStyle,
} from './wtlConsRelatedStyle'

/** 공사대장 포커스(공사이력·시설 등) 펄스 — 공용 0.08보다 약간 빠르게 */
const WTL_CONS_FOCUS_PULSE_STEP = 0.11

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

/** 공사이력 플로팅 요약(드래그 창) */
export type WtlConsMapFocusTooltip = {
  consCode: string
  title: string
  summary?: Array<{ label: string; value: string }>
}

export type WtlConsMapFocus = {
  geom: Record<string, unknown>
  projection: 'EPSG:4326' | 'EPSG:3857'
  /** 관련시설 선택 시 심볼 유지용 */
  styleName?: string
  styleCode?: string | null
  /** true면 이 포커스로 지도 맞춤하지 않음(화면만 표시 등) */
  skipFit?: boolean
  /** 있으면 공사이력 드래그 상세 창 */
  tooltip?: WtlConsMapFocusTooltip | null
}

/**
 * 플로팅 기본 위치용 앵커: «지금 화면 ∩ 도형».
 * 큰 공사면의 중심이 화면 밖이어도, 보이는 구간에 붙인다.
 */
export function focusTipCoordinate(map: Map, geom: Geometry | undefined): number[] | undefined {
  if (!geom) return undefined
  const view = extentOfVisibleMap(map)
  const geomExtent = geom.getExtent()
  if (!geomExtent.every((n) => Number.isFinite(n))) return undefined

  if (!view || !extentIntersects(view, geomExtent)) {
    // 화면과 안 겹치면 표시하지 않음(걸침만 요구)
    return undefined
  }

  const type = geom.getType()
  if (type === 'Point' || type === 'MultiPoint') {
    const c = (geom as SimpleGeometry).getFirstCoordinate()
    if (!c || c.length < 2) return undefined
    return containsXY(view, c[0]!, c[1]!) ? c : undefined
  }

  const overlap = getIntersection(view, geomExtent)
  if (!overlap || isEmpty(overlap)) return undefined
  const candidate = getCenter(overlap)
  if (typeof geom.intersectsCoordinate === 'function' && geom.intersectsCoordinate(candidate)) {
    return candidate
  }

  const closest = geom.getClosestPoint(candidate)
  if (closest?.length >= 2 && containsXY(view, closest[0]!, closest[1]!)) {
    return closest
  }

  // 화면 중심에 가장 가까운 도형 점 — 화면 안이면 사용
  const viewCenter = getCenter(view)
  const toView = geom.getClosestPoint(viewCenter)
  if (toView?.length >= 2 && containsXY(view, toView[0]!, toView[1]!)) {
    return toView
  }

  // 최후: 겹침 extent 중심을 화면 안으로 클램프(오목 도형 등)
  return [
    Math.min(Math.max(candidate[0]!, view[0]!), view[2]!),
    Math.min(Math.max(candidate[1]!, view[1]!), view[3]!),
  ]
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
   * «화면에 보이는 시설만» ON (= suppressListFit).
   * 파일 상단 [공사대장 · 지도 맞춤 UX 의도] 와 동일. 한 가지만 고쳐 다른 단계를 깨지 말 것.
   */
  suppressListFit?: boolean
  /** 알림으로 연 공사. 화면 안이어도 그 도형 범위로 이동한다 */
  forceFit?: boolean
}

function finiteExtent(extent: number[] | undefined | null): number[] | null {
  if (!extent || extent.length !== 4) return null
  if (!extent.every((value) => Number.isFinite(value)) || extent[0] === Infinity) return null
  return extent
}

/**
 * 좌·우·상·하 패널(view.padding)에 가려진 픽셀을 뺀 지도 범위.
 * «화면에 보이는 시설만» 필터·맵무브 걸침 판정 공통.
 */
export function extentOfVisibleMap(map: Map): number[] | null {
  const size = map.getSize()
  if (!size || size[0]! <= 0 || size[1]! <= 0) return null
  const padding = map.getView().padding ?? [0, 0, 0, 0]
  const top = Math.max(0, padding[0] ?? 0)
  const right = Math.max(0, padding[1] ?? 0)
  const bottom = Math.max(0, padding[2] ?? 0)
  const left = Math.max(0, padding[3] ?? 0)
  const x2 = size[0]! - right
  const y2 = size[1]! - bottom
  if (x2 - left < 8 || y2 - top < 8) return null
  const sw = map.getCoordinateFromPixel([left, y2])
  const ne = map.getCoordinateFromPixel([x2, top])
  if (!sw || !ne) return null
  const minX = Math.min(sw[0]!, ne[0]!)
  const minY = Math.min(sw[1]!, ne[1]!)
  const maxX = Math.max(sw[0]!, ne[0]!)
  const maxY = Math.max(sw[1]!, ne[1]!)
  if (![minX, minY, maxX, maxY].every((n) => Number.isFinite(n))) return null
  return [minX, minY, maxX, maxY]
}

/** 대상 extent가 패딩 반영 실제 지도 화면과 겹치면 true (패널 가림 영역 제외) */
export function extentTouchesView(map: Map, extent: number[]): boolean {
  const viewExtent = extentOfVisibleMap(map)
  if (!viewExtent) return false
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
  const padding = view.padding ?? [0, 0, 0, 0]
  const availW = Math.max(1, size[0]! - (padding[1] ?? 0) - (padding[3] ?? 0))
  const availH = Math.max(1, size[1]! - (padding[0] ?? 0) - (padding[2] ?? 0))
  const needed = view.getResolutionForExtent(extent, [availW, availH])
  if (!Number.isFinite(needed) || !(needed > 0)) return null
  return needed
}

/** 공사 전체 축척처럼 대상이 너무 작아, 맞추려면 줌인해야 하면 true */
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
  /** 체크 ON/OFF만으로 도형 이펙트·핏을 다시 돌리지 않음(목록 카운트와 분리) */
  const suppressListFitRef = useRef(Boolean(input.suppressListFit))
  suppressListFitRef.current = Boolean(input.suppressListFit)
  const projectKey = input.projectGeoms.map((item) => `${item.id}:${item.geom4326 ? 1 : 0}`).join(',')
  /** 맵무브 조건용. 사업 전체 도형 ON으로 형제 도형만 추가될 때는 변하지 않음 */
  const selectedGeomKey = input.selectedId
    ? `${input.selectedId}|${
        input.projectGeoms.some((item) => item.id === input.selectedId && item.geom4326) ? 1 : 0
      }`
    : `*|${input.projectGeoms.filter((item) => item.geom4326).length}`
  const zoneKey = `${input.zoneId ?? ''}|${input.zones.map((zone) => `${zone.id}:${zone.geometry3857 ? 1 : 0}`).join(',')}`
  const focusKey = input.focus
    ? `${input.focus.projection}:${JSON.stringify(input.focus.geom).slice(0, 180)}|${input.focus.tooltip?.consCode ?? ''}`
    : ''
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
      focusPhaseRef.current += WTL_CONS_FOCUS_PULSE_STEP
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
    // 도형 1건 실패로 공사·공사위치 전체를 지우지 않음
    const hasWorkSelection = Boolean(current.selectedId)
    for (const item of current.projectGeoms) {
      if (!item.geom4326) continue
      try {
        const geometry = readGeom(format, item.geom4326, 'EPSG:4326')
        const feature = new Feature(geometry)
        feature.setId(item.id)
        const selectedWork = item.id === current.selectedId
        if (selectedWork) feature.set('workOn', true)
        else if (!hasWorkSelection) feature.set('rim', true)
        source.addFeature(feature)
        if (selectedWork) selectedFeature = feature
      } catch {
        /* 잘못된 본표 도형 스킵 */
      }
    }
    for (const zone of current.zones) {
      if (!zone.geometry3857) continue
      try {
        const feature = new Feature(readGeom(format, zone.geometry3857, 'EPSG:3857'))
        const selected = zone.id === current.zoneId
        feature.setId(`zone:${zone.id}`)
        // 관련시설 등 포커스 중엔 검정 선택 스타일만 끔(zoneId·조회 범위는 유지)
        feature.set('zoneOn', selected && !hasFocus)
        zoneSource.addFeature(feature)
        if (selected) zoneFeature = feature
      } catch {
        /* 잘못된 공사위치 도형 스킵 */
      }
    }
    for (const item of current.relatedFacilities ?? []) {
      if (!item.geom) continue
      try {
        const feature = new Feature(readGeom(format, item.geom, item.projection))
        feature.setId(`related:${item.id}`)
        feature.set('related', true)
        feature.set('styleName', item.styleName)
        feature.set('styleCode', item.styleCode ?? '')
        relatedSource.addFeature(feature)
      } catch {
        /* 관련시설 도형 스킵 */
      }
    }
    if (current.focus?.geom) {
      try {
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
      } catch {
        focusFeature = null
      }
    }

    try {
      const prev = fitGateRef.current
      const suppressListFit = suppressListFitRef.current
      const forceFit = Boolean(current.forceFit)
      const focusAcquired = Boolean(focusKey) && focusKey !== prev?.focusKey
      const zoneAcquired =
        Boolean(current.zoneId) && current.zoneId !== prev?.zoneId
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

      /** kind 분기 — 파일 상단 UX 의도 참고 */
      const fitListTarget = (extent: number[], kind: 'work' | 'zone' | 'focus') => {
        const liveMap = mapRef?.current
        if (!liveMap) return
        fitGateRef.current = gateSnapshot
        if (kind === 'focus') {
          if (suppressListFit || current.focus?.skipFit) return
          scheduleFitMapToExtent3857(liveMap, extent, {
            maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
            applyMapViewPadding: () => paddingRef?.current?.(),
          })
          return
        }
        if (kind === 'work' || forceFit) {
          scheduleFitMapToExtent3857(liveMap, extent, {
            maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
            applyMapViewPadding: () => paddingRef?.current?.(),
          })
          return
        }
        // zone: 걸침+이미 가까움 → skip / 걸침+너무 작음 → 줌인 / 화면 밖 → 이동(줌아웃 금지)
        if (suppressListFit) {
          if (extentTouchesView(liveMap, extent) && !fitWouldZoomIn(liveMap, extent)) {
            return
          }
        }
        scheduleFitMapToExtent3857(liveMap, extent, {
          maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
          noZoomOut: suppressListFit,
          applyMapViewPadding: () => paddingRef?.current?.(),
        })
      }

      if (focusWantsFit) {
        const focusExtent = finiteExtent(focusFeature?.getGeometry()?.getExtent())
        // 도형 미도착 시 gate 고정 금지 — 로드 후 다시 맞춤
        if (!focusExtent) return
        const timer = window.setTimeout(() => fitListTarget(focusExtent, 'focus'), 80)
        return () => window.clearTimeout(timer)
      }

      if (zoneWantsFit) {
        const zoneExtent = finiteExtent(zoneFeature?.getGeometry()?.getExtent())
        if (!zoneExtent) {
          const zoneRow = current.zones.find((z) => z.id === current.zoneId)
          // 행은 있는데 도형 자체가 없으면 맞춤 포기. 아직 목록 전이면 대기
          if (zoneRow && !zoneRow.geometry3857) {
            fitGateRef.current = gateSnapshot
          }
          return
        }
        const timer = window.setTimeout(() => fitListTarget(zoneExtent, 'zone'), 80)
        return () => window.clearTimeout(timer)
      }

      // 공사 선택·구역 해제·fitToken — 공사 전체 맞춤(줌아웃 포함)
      const preferred =
        selectedFeature?.getGeometry()?.getExtent() ??
        finiteExtent(source.getExtent()) ??
        undefined
      const extent = finiteExtent(preferred)
      if (!extent) return
      const timer = window.setTimeout(() => fitListTarget(extent, 'work'), 80)
      return () => window.clearTimeout(timer)
    } catch {
      /* 맞춤 실패해도 도형 표시는 유지 */
    }
  }, [
    projectKey,
    selectedGeomKey,
    input.fitToken,
    input.selectedId,
    input.forceFit,
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
