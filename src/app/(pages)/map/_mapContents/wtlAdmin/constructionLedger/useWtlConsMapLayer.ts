'use client'

/**
 * =============================================================================
 * [공사대장 · 지도 맞춤 UX 의도 — 임의로 바꾸지 말 것]
 * =============================================================================
 *
 * 1) 사업·공사 목록 선택
 *    → 사업만 선택: 그 사업의 보이는 본표 도형 전부 반짝이(스타일 펄스).
 *    → 공사 선택: 그 공사 본표만 반짝이(공사위치가 가리지 않게). 본표 없으면 공사위치 반짝이.
 *    → 맞춤 대상 shp가 바뀔 때만 지도 이동. 단건 사업→공사(같은 shp)는 재맞춤 없음.
 *
 * 2) 공사위치 행 선택 («화면에 보이는 시설만» ON 일 때)
 *    → 선택한 공사위치만 반짝이 (본표 반짝이는 끔).
 *    → 미선택 공사위치는 펄스 없이 항상 그림.
 *    - 전체가 작으면 줌인 / 이미 가까우면 유지 / 화면 밖이면 이동(줌아웃 금지)
 *    ※ «화면에 보이면 무조건 줌 금지»로 바꾸면 1→2 줌인이 사라짐. 금지.
 *
 * 3) 관련시설·필지·수용가·공사이력 등 목록 선택
 *    → 반짝이는 선택한 행만(포커스 레이어 opacity). 본표·공사위치 반짝이 끔.
 *    → 미선택 관련시설·공사위치 도형은 그대로 표시.
 *    → 맵무브·줌 없음 («화면만» ON).
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
import SimpleGeometry from 'ol/geom/SimpleGeometry'
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
import { createDataQuerySelectionRowHighlightStyle } from '@/lib/mapDataQueryMapHighlight'
import { LAYER_GEOM_STACK_SKIP_KEY } from '@/lib/mapLayerGeometryOrder'
import type { WtlConsGeom4326 } from './wtlConsLedgerApi'
import {
  peekRelatedFacilityIcon,
  prefetchRelatedFacilityStyles,
  resolveRelatedFacilityOlStyle,
} from './wtlConsRelatedStyle'

/** 공사대장 포커스(공사이력·시설 등) 펄스 — 공용 0.08보다 약간 빠르게 */
const WTL_CONS_FOCUS_PULSE_STEP = 0.11

/** 미선택(형제) 본표 — 전체도형 ON 시에도 보이도록 채우기·선 강화 (예전 0.18은 너무 연함) */
const MAIN_FILL = 'rgba(37, 99, 235, 0.32)'
const MAIN_STROKE = '#1d4ed8'
/** 관련시설 강조 — 도로·하천 선택 강조와 같은 최상단대 */
const FOCUS_LAYER_Z = 9999
/** 관련시설 전체(미선택) — 공사·구역 위, 선택 강조 아래 */
const RELATED_LAYER_Z = 892
/** 관련시설 선택 시 공사 본표만 살짝 죽임. 공사위치(미선택)는 그대로 보이게 */
const WORK_DIM_OPACITY = 0.38
/** 관련행·필지 포커스 중에도 공사위치는 또렷이 — 연하게만 살짝 */
const ZONE_DIM_OPACITY = 0.95

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
      stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.7)', width: 5 }),
      zIndex: 1,
    }),
    new Style({
      fill: new Fill({ color: MAIN_FILL }),
      stroke: new Stroke({ color: MAIN_STROKE, width: 2.2 }),
      zIndex: 2,
    }),
  ]
}

function featureStyle(feature: Feature, pulseStyle: StyleFunction): Style | Style[] | undefined {
  // 본표 반짝이 — 데이터조회와 같은 스타일 펄스(투명도만으로는 잘 안 보임)
  if (feature.get('workOn')) {
    return (
      withZIndex(pulseStyle(feature, 1) as Style | Style[] | undefined, 12) ??
      workBaseStyle(true)
    )
  }
  return workBaseStyle(Boolean(feature.get('rim')))
}

/** 미선택 공사위치 — 고정 빨간 테두리(펄스 없음, 항상 보이게) */
function zoneIdleStyle(feature: Feature, zIndex = 20): Style | Style[] {
  const geomType = feature.getGeometry()?.getType()
  if (geomType === 'LineString' || geomType === 'MultiLineString') {
    return [
      new Style({ stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.9)', width: 6.5 }), zIndex }),
      new Style({ stroke: new Stroke({ color: 'rgba(220, 38, 38, 0.88)', width: 3.8 }), zIndex }),
    ]
  }
  if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
    return [
      new Style({
        stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.88)', width: 5.5 }),
        fill: new Fill({ color: 'rgba(220, 38, 38, 0.28)' }),
        zIndex,
      }),
      new Style({
        stroke: new Stroke({ color: 'rgba(220, 38, 38, 0.85)', width: 2.8 }),
        zIndex,
      }),
    ]
  }
  return new Style({
    stroke: new Stroke({ color: 'rgba(220, 38, 38, 0.88)', width: 4 }),
    fill: new Fill({ color: 'rgba(220, 38, 38, 0.28)' }),
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
 * 선택 행 포커스(관련시설 등) — 심볼 위에 스타일 펄스(깜빡임).
 * 펄스를 아래에 두면 관 심볼에 가려져 안 보임 → zIndex 를 심볼보다 높게.
 */
function focusFeatureStyle(
  feature: Feature,
  pulseStyle: StyleFunction,
  onStyleReady: () => void
): Style | Style[] | undefined {
  const geomType = feature.getGeometry()?.getType()
  const styleName = String(feature.get('styleName') ?? '').trim()
  const styleCode = String(feature.get('styleCode') ?? '').trim() || null
  const pulse = pulseStyle(feature, 1) as Style | Style[] | undefined
  const pulseList = pulse ? (Array.isArray(pulse) ? pulse : [pulse]) : []
  for (const style of pulseList) style.setZIndex(FOCUS_LAYER_Z + 2)

  if ((geomType === 'Point' || geomType === 'MultiPoint') && styleName) {
    const icon = peekRelatedFacilityIcon(styleName, styleCode)
    if (icon) {
      return [
        ...pulseList,
        new Style({
          zIndex: FOCUS_LAYER_Z + 1,
          image: new Icon({
            src: icon.src,
            scale: icon.scale,
            anchor: [0.5, 0.5],
            opacity: 1,
          }),
        }),
      ]
    }
    return pulseList.length ? pulseList : undefined
  }
  if (geomType === 'LineString' || geomType === 'MultiLineString') {
    if (styleName) {
      const base = relatedFacilityStyle(feature, onStyleReady)
      const baseList = Array.isArray(base) ? base : [base]
      for (const style of baseList) style.setZIndex(FOCUS_LAYER_Z + 1)
      // 관 심볼 위 + 반짝이(펄스)
      return [...baseList, ...pulseList]
    }
    return pulseList.length ? pulseList : undefined
  }
  if (!pulse) return undefined
  return withZIndex(pulse, FOCUS_LAYER_Z + 2)
}

function zoneFeatureStyle(feature: Feature, pulseStyle: StyleFunction): Style | Style[] {
  // 선택 공사위치만 스타일 펄스. 미선택은 idle(항상 그림)
  if (feature.get('zoneOn')) {
    return withZIndex(pulseStyle(feature, 1) as Style | Style[] | undefined, 30) ?? zoneIdleStyle(feature, 20)
  }
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
  /** 관련시설·공사이력 행 id — 목록 레이어와 겹치지 않게 제외 */
  id?: string
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
  if ((type === 'Point' || type === 'MultiPoint') && geom instanceof SimpleGeometry) {
    const c = geom.getFirstCoordinate()
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
  /** 선택 반짝이(공사·공사위치·관련행) — 데이터조회 선택 행과 동일 펄스 */
  const focusPhaseRef = useRef(0)
  const focusPulseStyleRef = useRef(
    createDataQuerySelectionRowHighlightStyle(() => focusPhaseRef.current)
  )
  /** 본표 선택 반짝이(스타일 펄스) 활성 */
  const workOpacityPulseRef = useRef(false)
  const workDimRef = useRef(false)
  const zoneOpacityPulseRef = useRef(false)
  const zoneDimRef = useRef(false)
  const focusOpacityPulseRef = useRef(false)
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
  /**
   * 맞춤 대상 본표 id 목록. 사업(전체)→단건 공사로 바꿔도 같은 shp면 키가 같아 재맞춤 안 함.
   */
  const selectedGeomKey = (
    input.selectedId
      ? input.projectGeoms.filter((item) => item.id === input.selectedId && item.geom4326)
      : input.projectGeoms.filter((item) => item.geom4326)
  )
    .map((item) => item.id)
    .sort()
    .join(',')
  const zoneKey = `${input.zoneId ?? ''}|${input.zones.map((zone) => `${zone.id}:${zone.geometry3857 ? 1 : 0}`).join(',')}`
  const focusKey = input.focus
    ? `${input.focus.id ?? ''}|${input.focus.projection}:${JSON.stringify(input.focus.geom).slice(0, 180)}|${input.focus.tooltip?.consCode ?? ''}`
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
      style: (feature) => featureStyle(feature as Feature, focusPulseStyleRef.current),
      zIndex: 890,
    })
    layer.set('wtlConsWork', true)
    layer.set(LAYER_GEOM_STACK_SKIP_KEY, true)
    workLayerRef.current = layer
    const zoneSource = new VectorSource()
    zoneSourceRef.current = zoneSource
    const zoneLayer = new VectorLayer({
      source: zoneSource,
      style: (feature) => zoneFeatureStyle(feature as Feature, focusPulseStyleRef.current),
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

  /**
   * 선택 반짝이 프레임.
   * 본표·공사위치·관련행: 스타일 펄스 + layer.changed (박자 공유).
   */
  useEffect(() => {
    let rafId = 0
    const loop = () => {
      focusPhaseRef.current += WTL_CONS_FOCUS_PULSE_STEP

      const workLayer = workLayerRef.current
      if (workLayer) {
        if (workDimRef.current) workLayer.setOpacity(WORK_DIM_OPACITY)
        else workLayer.setOpacity(1)
        if (workOpacityPulseRef.current) workLayer.changed()
      }

      const zoneLayer = zoneLayerRef.current
      if (zoneLayer) {
        if (zoneDimRef.current) zoneLayer.setOpacity(ZONE_DIM_OPACITY)
        else zoneLayer.setOpacity(1)
        if (zoneOpacityPulseRef.current) zoneLayer.changed()
      }

      const focusLayer = focusLayerRef.current
      if (focusLayer) {
        focusLayer.setOpacity(1)
        // 관련시설·수용가 등 — 스타일 펄스(심볼 위). opacity 만 쓰면 안 보임
        if (focusOpacityPulseRef.current) focusLayer.changed()
      }
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
    // 반짝이 우선순위: 관련행 focus > 공사위치 > 공사본표 (동시에 하나만)
    const hasZonePulse = Boolean(current.zoneId) && !hasFocus
    workDimRef.current = hasFocus || hasZonePulse
    workOpacityPulseRef.current = false
    zoneDimRef.current = hasFocus
    zoneOpacityPulseRef.current = hasZonePulse
    focusOpacityPulseRef.current = hasFocus
    if (workLayer) {
      workLayer.setOpacity(workDimRef.current ? WORK_DIM_OPACITY : 1)
      // 기본 890 — 본표 펄스 중에는 공사위치(891) 위로 올려 가리지 않게
      workLayer.setZIndex(890)
    }
    if (zoneLayer) zoneLayer.setOpacity(hasFocus ? ZONE_DIM_OPACITY : 1)
    if (relatedLayer) {
      relatedLayer.setOpacity(1)
      relatedLayer.setVisible(true)
    }
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
    const focusRowId = String(current.focus?.id ?? '').trim()
    let workOnCount = 0
    for (const item of current.projectGeoms) {
      if (!item.geom4326) continue
      try {
        const geometry = readGeom(format, item.geom4326, 'EPSG:4326')
        const feature = new Feature(geometry)
        feature.setId(item.id)
        const selectedWork = item.id === current.selectedId
        // 본표 반짝이: 관련행/공사위치 없을 때
        // - 공사 선택 → 해당 1건만
        // - 사업만 선택(공사 없음) → 보이는 본표 전부
        const pulseWork =
          !hasFocus &&
          !hasZonePulse &&
          (selectedWork || !hasWorkSelection)
        if (pulseWork) {
          feature.set('workOn', true)
          workOnCount += 1
        }
        source.addFeature(feature)
        if (selectedWork) selectedFeature = feature
      } catch {
        /* 잘못된 본표 도형 스킵 */
      }
    }
    // 본표 반짝이 켜짐 → 스타일 펄스 프레임
    const workPulsing = workOnCount > 0 && !workDimRef.current
    workOpacityPulseRef.current = workPulsing
    if (workLayer && workPulsing) workLayer.setZIndex(896)
    // 공사 선택인데 본표 도형이 없으면 공사위치 전부 반짝이 (가장 작은 단위)
    const pulseZonesForSelectedWork =
      !hasFocus &&
      !hasZonePulse &&
      hasWorkSelection &&
      workOnCount === 0 &&
      current.zones.some((z) => Boolean(z.geometry3857))
    for (const zone of current.zones) {
      if (!zone.geometry3857) continue
      const selected = zone.id === current.zoneId
      // 공사 본표가 펄스 중이면 미선택 공사위치는 그리지 않음(본표를 가려 펄스가 안 보임)
      if (workPulsing && !selected && !pulseZonesForSelectedWork) continue
      try {
        const feature = new Feature(readGeom(format, zone.geometry3857, 'EPSG:3857'))
        feature.setId(`zone:${zone.id}`)
        // 공사위치 반짝이: 행 선택 / 또는 공사 선택·본표 없을 때 전부
        feature.set('zoneOn', (selected && !hasFocus) || pulseZonesForSelectedWork)
        zoneSource.addFeature(feature)
        if (selected) zoneFeature = feature
      } catch {
        /* 잘못된 공사위치 도형 스킵 */
      }
    }
    zoneOpacityPulseRef.current = hasZonePulse || pulseZonesForSelectedWork
    for (const item of current.relatedFacilities ?? []) {
      if (!item.geom) continue
      // 선택 행은 focus 레이어에서만 반짝이 — 목록 레이어에 중복 그리지 않음
      if (focusRowId && item.id === focusRowId) continue
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
        if (focusRowId) focusFeature.setId(`focus:${focusRowId}`)
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
      // selectedId만 바뀌고 맞춤 대상 shp가 같으면(단건 사업→공사) 재맞춤하지 않음
      const shouldFit =
        !prev ||
        prev.fitToken !== current.fitToken ||
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
