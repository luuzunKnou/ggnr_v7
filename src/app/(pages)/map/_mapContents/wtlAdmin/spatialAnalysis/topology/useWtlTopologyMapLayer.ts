'use client'

import { useEffect, useRef } from 'react'
import Feature from 'ol/Feature'
import { LineString, Point } from 'ol/geom'
import type { Map as OlMap } from 'ol'
import { boundingExtent, getCenter } from 'ol/extent'
import type BaseLayer from 'ol/layer/Base'
import type ImageLayer from 'ol/layer/Image'
import type ImageWMS from 'ol/source/ImageWMS'
import VectorLayer from 'ol/layer/Vector'
import { unByKey } from 'ol/Observable'
import VectorSource from 'ol/source/Vector'
import { Circle, Fill, RegularShape, Stroke, Style, Text } from 'ol/style'
import '../../../../_mapComponents/config/projections'
import { call } from '@/lib/api'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import {
  FORCE_IGNORE_SCALE_LAYER_KEY,
  mergeIgnoreScaleEnv,
} from '../../../../_mapComponents/layerFactory/iconScaleWmsEnv'
import { lonLatToView, useMapViewProjection } from './topoMapProjection'
import {
  createUndergroundFacilityLayers,
  findUndergroundFacilityServiceLayer,
  reapplyUndergroundFacilityServiceWms,
  UNDERGROUND_FACILITY_LAYERS,
} from '../../../../_mapComponents/layerFactory/undergroundFacilityLayerFactory'
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
} from '@/lib/mapDataQueryMapHighlight'
import type { WtlTopoMeetPipeLine, WtlTopoResult } from './wtlTopologySample'
import {
  WTL_TOPO_PIPE_DEFAULT_COLOR,
  wtlTopoPipeKey,
  wtlTopoPipeName,
} from './wtlTopologySample'

/** 채움 없는 붉은 원 테두리만 */
const STROKE = 'rgba(220, 38, 38, 0.85)'
const STROKE_SELECTED = 'rgba(185, 28, 28, 1)'

/**
 * 위상검증 배경 지하시설물.
 * 관로는 분할 키만 사용 (부모 wtl_pipe_lm 넣으면 겹침).
 */
const WTL_TOPO_UF_LAYERS = [
  'wtl_pipe_lm_etc',
  'wtl_pipe_lm_saa004',
  'wtl_pipe_lm_saa003',
  'wtl_sply_ls',
  'wtl_serv_ps',
  'wtl_puri_as',
  'wtl_valv_ps',
  'wtl_flow_ps',
  'wtl_meta_ps',
] as const

/** 편집(반전 등) 후 이 탭의 배경 WMS 레이어를 다시 받는다. */
export function refreshWtlTopologyBackground(map: OlMap | null | undefined): void {
  if (!map) return
  const stamp = String(Date.now())
  for (const layer of map.getLayers().getArray()) {
    if (layer.get(BG_LAYER_KEY) !== true) continue
    const source = (layer as ImageLayer<ImageWMS>).getSource()
    if (!source || typeof source.updateParams !== 'function') continue
    source.updateParams({ ...source.getParams(), _dc: stamp })
    source.changed()
    layer.changed()
  }
}

/** 검토 집중 시 다른 지하시설물 레이어에 곱하는 투명도 비율 */
const DIM_OPACITY_RATIO = 1
const DIM_PREV_KEY = 'wtlTopoDimPrevOpacity'
/** 이 탭 전용 배경 WMS 레이어 표식 / 기존 레이어를 가릴 때 원래 투명도를 보관하는 키 */
const BG_LAYER_KEY = 'wtlTopologyBackground'
const HIDE_PREV_KEY = 'wtlTopoHidePrevOpacity'
const BG_Z_INDEX = 40
/**
 * 급수관 스타일의 라벨 규칙을 끄는 GeoServer ENV (라벨 속성명을 비움)
 * + 선 굵기를 누수분석·단수구역과 같은 2.5px로
 */
/** 라벨만 끔 — 굵기는 지하시설물과 동일하게 본편 SLD Categorize */
const SPLY_NO_LABEL_ENV = 'wtl_sply_ls_label_property_name:'
/** 굵기를 누수분석·단수구역(선 3px)에 맞춘 SLD_BODY로 다시 그릴 관로 분할 레이어 */
const PIPE_WIDEN_TABLES = new Set(['wtl_pipe_lm_etc', 'wtl_pipe_lm_saa004', 'wtl_pipe_lm_saa003'])
/**
 * 축척과 무관하게 보여 줄 시설 레이어(_ps 포함).
 * SLD의 ignore_scale env + OL minZoom 해제로 항상 표시.
 */
const FACILITY_TABLES = new Set([
  'wtl_valv_ps',
  'wtl_flow_ps',
  'wtl_serv_ps',
  'wtl_meta_ps',
  'wtl_puri_as',
])
/** 접합점 검토: 체크(선택)·마우스 올린 관로의 선 굵기(px). 일반 관로는 3 */
const EMPH_LINE_WIDTH = 6.5
/** 강조 점선: 선 굵기 대비 칠한 길이·간격 비율 (6.5px 기준 약 13px 선, 10px 간격) */
const DASH_ON_RATIO = 2
const DASH_GAP_RATIO = 1.5
/** 검토 대상 관로 아래 후광 */
const HALO_COLOR = 'rgba(255, 255, 255, 0.85)'
const HALO_EXTRA_WIDTH = 5
/**
 * 반전 대상(체크된 관로)은 프로젝트 공통 LINE 선택 강조(펄스)를 후광으로 쓴다
 * — 데이터조회·단수·급수경로와 같은 효과. 움직임 줄이기 설정이면 펄스를 멈춘다.
 */

/** StyleFunction 반환값(Style | Style[] | void)을 배열로 정리 */
function toStyleArray(result: Style | Style[] | void | null | undefined): Style[] {
  if (!result) return []
  return Array.isArray(result) ? result : [result]
}

/** 오류 선택 시 화면 맞춤: 여백(px)과 확대 한계 */
const FIT_PADDING_PX = 80
/** 아주 짧은 관·지점도 너무 확대되지 않게 (축척 막대 약 15m) */
const FIT_MAX_ZOOM = 20
/** 긴 관이라도 시설 심볼이 보이는 범위보다 너무 축소되지 않게 (축척 막대 약 480m) */
const FIT_MIN_ZOOM = 15

/** 좌표들이 모두 화면에 들어오도록 이동·확대한다 (FIT_MIN_ZOOM~FIT_MAX_ZOOM) */
function fitToCoords(map: OlMap, coords: [number, number][]): void {
  if (coords.length === 0) return
  const view = map.getView()
  const extent = boundingExtent(coords)
  view.fit(extent, {
    padding: [FIT_PADDING_PX, FIT_PADDING_PX, FIT_PADDING_PX, FIT_PADDING_PX],
    maxZoom: FIT_MAX_ZOOM,
    duration: 400,
    callback: () => {
      const z = view.getZoom()
      if (z != null && z < FIT_MIN_ZOOM) {
        view.animate({ center: getCenter(extent), zoom: FIT_MIN_ZOOM, duration: 200 })
      }
    },
  })
}


function arrowStyleAt(
  line: LineString,
  t: number,
  color: string,
  radius: number
): Style | null {
  const c = line.getCoordinateAt(t)
  const a = line.getCoordinateAt(Math.max(0, t - 0.02))
  const b = line.getCoordinateAt(Math.min(1, t + 0.02))
  if (!c || !a || !b) return null
  const rotation = Math.atan2(b[1]! - a[1]!, b[0]! - a[0]!)
  return new Style({
    geometry: new Point(c),
    image: new RegularShape({
      points: 3,
      radius,
      rotation: -rotation + Math.PI / 2,
      fill: new Fill({ color }),
      stroke: new Stroke({ color, width: 1 }),
    }),
  })
}

/** 화면에서 이 길이(px)보다 짧은 선은 중간 화살표 없이 시작점 표시 + 끝 화살표만 그린다 */
const SHORT_LINE_PX = 40

/**
 * 선분 방향(시작→끝) 화살표 — 중간 + 끝점. 관경·SLD와 무관.
 * 화면에서 매우 짧은 선(수 m 이하)은 선이 거의 보이지 않으므로,
 * 시작점에 점을 찍고 끝점에 화살표를 그려 어느 쪽이 시작인지 알 수 있게 한다.
 */
function directedLineStyles(
  line: LineString,
  color: string,
  width: number,
  lineDash?: number[],
  resolution?: number
): Style[] {
  const styles: Style[] = [
    new Style({
      // 점선은 끝을 평평하게(butt) 해야 굵은 선에서도 간격이 메워지지 않는다(기본 round는 양끝이 반폭씩 늘어남)
      stroke: new Stroke({ color, width, lineDash, lineCap: lineDash ? 'butt' : 'round' }),
    }),
  ]
  const len = line.getLength()
  // 시작점과 끝점이 같은 점인 퇴화 선분은 방향을 그릴 수 없다
  if (len <= 0) return styles
  const midRadius = Math.max(9, width + 5)
  const endRadius = Math.max(10, width + 6)
  const screenPx = resolution && resolution > 0 ? len / resolution : Infinity
  if (screenPx < SHORT_LINE_PX) {
    const start = line.getFirstCoordinate()
    styles.push(
      new Style({
        geometry: new Point(start),
        image: new Circle({
          radius: Math.max(4, width + 2),
          fill: new Fill({ color }),
          stroke: new Stroke({ color: '#ffffff', width: 2 }),
        }),
      })
    )
    // 시작점 점과 겹치지 않도록 화살표를 진행 방향 앞쪽으로 살짝 띄워 놓는다
    const end = line.getLastCoordinate()
    const before = line.getCoordinateAt(Math.max(0, 1 - 0.02))
    const rotation = Math.atan2(end[1]! - before[1]!, end[0]! - before[0]!)
    const ahead = (endRadius + 4) * (resolution ?? 0)
    const tip: [number, number] = [
      end[0]! + Math.cos(rotation) * ahead,
      end[1]! + Math.sin(rotation) * ahead,
    ]
    styles.push(
      new Style({
        geometry: new Point(tip),
        image: new RegularShape({
          points: 3,
          radius: endRadius,
          rotation: -rotation + Math.PI / 2,
          fill: new Fill({ color }),
          stroke: new Stroke({ color: '#ffffff', width: 1.5 }),
        }),
      })
    )
    return styles
  }
  const spacing = 48
  const count = Math.max(1, Math.min(10, Math.floor(len / spacing)))
  for (let i = 1; i <= count; i++) {
    const arrow = arrowStyleAt(line, i / (count + 1), color, midRadius)
    if (arrow) styles.push(arrow)
  }
  // 끝점 화살표(유수방향 확인용)
  const endArrow = arrowStyleAt(line, 1, color, endRadius)
  if (endArrow) styles.push(endArrow)
  return styles
}

export type WtlTopoMeetHighlight = {
  pipes: WtlTopoMeetPipeLine[]
  checkedKeys: Set<string>
  /** 검토 목록에서 마우스를 올린(또는 포커스한) 관로 키 — 지도에서 더 강조 */
  hoverKey?: string | null
  /** true면 관로 구성이 바뀌어도 화면을 맞추지 않는다 (지도에서 하나씩 고를 때) */
  noFit?: boolean
  preview: boolean
}

type Props = {
  active: boolean
  result: WtlTopoResult | null
  selectedId: string | null
  visibleIds: Set<string> | null
  meetHighlight?: WtlTopoMeetHighlight | null
  /** 선택 이슈 관로(역방향 등) — 빨간 선+화살표 */
  selectedLine?: [number, number][] | null
  /** 빨간 원 클릭 시 해당 오류를 목록에서 선택 */
  onSelectIssue?: (id: string) => void
  /** true면 빨간 원 클릭 선택을 막는다(도형 그리기·수정 중) */
  suspendIssueClick?: boolean
}

export function useWtlTopologyMapLayer({
  active,
  result,
  selectedId,
  visibleIds,
  meetHighlight = null,
  selectedLine = null,
  onSelectIssue,
  suspendIssueClick = false,
}: Props) {
  const mapContext = useMapContext()
  /** 현재 지도 좌표계(3857, 카카오 배경이면 5181) — 바뀌면 도형을 다시 그린다 */
  const viewProj = useMapViewProjection(mapContext?.mapInstanceRef, mapContext?.mapReady)
  const toView = (coord: [number, number]) => lonLatToView(coord, viewProj)
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const meetLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  /** 반전 대상 선택 펄스 위상(rad) */
  const pulseRef = useRef(0)
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId
  const onSelectRef = useRef(onSelectIssue)
  onSelectRef.current = onSelectIssue
  const suspendClickRef = useRef(suspendIssueClick)
  suspendClickRef.current = suspendIssueClick
  const suppressIdentifyRef = useRef(mapContext?.suppressMapIdentifyUntilRef)
  suppressIdentifyRef.current = mapContext?.suppressMapIdentifyUntilRef

  /**
   * 탭 활성 시 검증 대상 관로·시설을 이 탭 전용 WMS 레이어로 직접 그린다.
   * 지하시설물 패널의 레이어 선택 상태는 건드리지 않는다.
   * - 관로·급수관은 라벨 없이 선만 그린다(분할 관로는 SLD에서 TextSymbolizer 제거, 급수관은 ENV).
   * - 같은 테이블을 지하시설물 패널이 이미 그리고 있으면 중복을 피하려고 탭이 켜진 동안만 숨긴다.
   */
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady || !active) return

    const wanted = new Set<string>(WTL_TOPO_UF_LAYERS)
    const options = UNDERGROUND_FACILITY_LAYERS.filter((o) => wanted.has(o.tableName))
    const layers = createUndergroundFacilityLayers(options)
    layers.forEach((layer) => {
      const tableName = String(layer.get('layerTableName') ?? '')
      // 지하시설물 패널 동기화(useUndergroundFacilityLayerSync)가 건드리지 않게 표식을 바꾼다
      layer.unset('undergroundFacilityLayer')
      layer.set(BG_LAYER_KEY, true)
      layer.setZIndex(BG_Z_INDEX + WTL_TOPO_UF_LAYERS.indexOf(tableName as never))
      layer.setVisible(true)
      if (tableName === 'wtl_sply_ls') {
        const source = layer.getSource()
        source?.updateParams({ ...source.getParams(), ENV: SPLY_NO_LABEL_ENV })
      }
      if (FACILITY_TABLES.has(tableName)) {
        // 공간분석 배경 _ps·시설 — ignore_scale=1 + factory minZoom 해제
        // 검색바 축척 토글이 덮어쓰지 않도록 force 표식
        layer.setMinZoom(0)
        layer.setMaxZoom(Infinity)
        layer.set(FORCE_IGNORE_SCALE_LAYER_KEY, true)
        const source = layer.getSource()
        if (source) {
          const params = source.getParams()
          const current = typeof params.ENV === 'string' ? params.ENV : undefined
          source.updateParams({
            ...params,
            ENV: mergeIgnoreScaleEnv(current, true),
          })
        }
      }
      map.addLayer(layer)
    })

    // 관로 분할 레이어만 굵기·라벨 제거 SLD로 다시 그린다. 시설 축척은 ignore_scale ENV.
    let cancelled = false
    const pipeWidenTables = layers
      .map((l) => String(l.get('layerTableName') ?? ''))
      .filter((t) => PIPE_WIDEN_TABLES.has(t))
    if (pipeWidenTables.length > 0) {
      call('', 'POST', {
        service: 'wtlTopologyService',
        action: 'loadWtlTopoFacilitySlds',
        params: { tables: pipeWidenTables },
      })
        .then((res) => {
          if (cancelled) return
          const body = (res?.data ?? res) as { slds?: Record<string, string> }
          const slds = body?.slds ?? {}
          layers.forEach((layer) => {
            const sld = slds[String(layer.get('layerTableName') ?? '')]
            if (!sld) return
            const source = layer.getSource()
            if (!source) return
            const params = { ...source.getParams() }
            delete params.STYLES
            // 긴 SLD_BODY는 geoserverWmsImageLoadFunction이 POST로 보낸다
            source.updateParams({ ...params, STYLES: '', SLD_BODY: sld })
          })
        })
        .catch(() => {
          // 원래 스타일 그대로 둔다
        })
    }

    // 본 지도 지하시설물 묶음 GetMap에서 동일 테이블만 잠시 제외(선택 상태는 유지)
    const ufService = findUndergroundFacilityServiceLayer(map)
    if (ufService) {
      ufService.set('ufTempHideTables', [...wanted])
      reapplyUndergroundFacilityServiceWms(map)
    }
    // 레거시 테이블당 레이어는 투명 처리
    const hidden: BaseLayer[] = []
    map
      .getLayers()
      .getArray()
      .forEach((l) => {
        if (l.get('undergroundFacilityLayer') !== true) return
        if (l.get('undergroundFacilityServiceLayer')) return
        if (!wanted.has(String(l.get('layerTableName') ?? ''))) return
        if (typeof l.get(HIDE_PREV_KEY) === 'number') return
        l.set(HIDE_PREV_KEY, l.getOpacity())
        l.setOpacity(0)
        hidden.push(l)
      })

    return () => {
      cancelled = true
      layers.forEach((layer) => map.removeLayer(layer))
      if (ufService) {
        ufService.unset('ufTempHideTables')
        reapplyUndergroundFacilityServiceWms(map)
      }
      hidden.forEach((l) => {
        const prev = l.get(HIDE_PREV_KEY)
        if (typeof prev === 'number') l.setOpacity(prev)
        l.unset(HIDE_PREV_KEY)
      })
    }
  }, [active, mapContext?.mapReady, mapContext?.mapInstanceRef])

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady || !active) return

    const source = new VectorSource()
    const layer = new VectorLayer({
      source,
      zIndex: 940,
      style: (feature, resolution) => {
        const role = String(feature.get('role') ?? 'point')
        if (role === 'selected-line') {
          const geom = feature.getGeometry()
          if (!(geom instanceof LineString)) return undefined
          return directedLineStyles(geom, STROKE_SELECTED, 3.5, undefined, resolution)
        }
        const selected = String(feature.get('issueId') ?? '') === selectedRef.current
        return new Style({
          image: new Circle({
            radius: selected ? 16 : 14,
            fill: new Fill({ color: 'rgba(0,0,0,0)' }),
            stroke: new Stroke({
              color: selected ? STROKE_SELECTED : STROKE,
              width: selected ? 2.5 : 2,
            }),
          }),
        })
      },
    })
    layer.set('wtlTopology', true)
    map.addLayer(layer)
    layerRef.current = layer

    const flipPulseStyle = createDataQuerySelectionRowHighlightStyle(() => pulseRef.current)
    const meetSource = new VectorSource()
    const meetLayer = new VectorLayer({
      source: meetSource,
      zIndex: 945,
      style: (feature, resolution) => {
        const mode = String(feature.get('mode') ?? 'idle')
        // 실제 관로 색(saa_cde별 GeoServer 스타일). 반전 대상은 굵은 점선으로 구분
        const color = String(feature.get('color') ?? WTL_TOPO_PIPE_DEFAULT_COLOR)
        const label = String(feature.get('label') ?? '')
        const hovered = feature.get('hover') === true
        // 강조 = 체크(선택)한 관로 또는 목록에서 마우스를 올린 관로. 둘 다 같은 모양으로 그린다:
        // 펄스 후광 + 점선 + 굵은 선 + 큰 라벨. (방향 반전은 체크한 관로에만 적용됨)
        const emphasized = mode === 'flip' || hovered
        const width = emphasized ? EMPH_LINE_WIDTH : 3
        // 점선 길이·간격을 선 굵기에 비례시켜 굵어져도 끊김이 분명하게 보이게 한다
        const dash = emphasized ? [width * DASH_ON_RATIO, width * DASH_GAP_RATIO] : undefined
        const geom = feature.getGeometry()
        if (!(geom instanceof LineString)) return undefined
        // 후광을 먼저 깔아 주변 관로 위에서도 검토 대상이 도드라지게 한다.
        // 강조 관로는 공통 선택 펄스(흰+붉은 이중 선), 그 외는 얇은 고정 흰 후광
        const halo = emphasized
          ? toStyleArray(flipPulseStyle(feature, resolution))
          : [
              new Style({
                stroke: new Stroke({ color: HALO_COLOR, width: width + HALO_EXTRA_WIDTH }),
              }),
            ]
        const styles = [...halo, ...directedLineStyles(geom, color, width, dash, resolution)]
        // 강조 관로는 다른 관로 위로, 마우스를 올린 관로는 그중에서도 맨 위로
        const z = hovered ? 20 : emphasized ? 10 : 0
        styles.forEach((s) => s.setZIndex(z))
        const mid = geom.getCoordinateAt(0.5)
        if (label && mid) {
          styles.push(
            new Style({
              geometry: new Point(mid),
              zIndex: z + 1,
              text: new Text({
                // 체크(반전 대상으로 선택)만 한 상태이므로 "선택됨". 실제 반전은 저장 시점이다.
                text: mode === 'flip' ? `${label} (선택됨)` : label,
                font: emphasized ? 'bold 14px sans-serif' : 'bold 12px sans-serif',
                fill: new Fill({ color }),
                stroke: new Stroke({ color: '#ffffff', width: 3 }),
                offsetY: -14,
                overflow: true,
              }),
            })
          )
        }
        return styles
      },
    })
    meetLayer.set('wtlTopologyMeet', true)
    map.addLayer(meetLayer)
    meetLayerRef.current = meetLayer

    const onCircleClick = (evt: MouseEvent) => {
      // 그리기·수정 중에는 클릭을 Draw/Modify에 그대로 넘긴다
      if (suspendClickRef.current) return
      const pixel = map.getEventPixel(evt)
      let issueId = ''
      map.forEachFeatureAtPixel(
        pixel,
        (feature) => {
          if (String(feature.get('role') ?? '') !== 'point') return undefined
          const id = String(feature.get('issueId') ?? '')
          if (!id) return undefined
          issueId = id
          return feature
        },
        { layerFilter: (candidate) => candidate === layer, hitTolerance: 4 }
      )
      if (!issueId) return
      const suppress = suppressIdentifyRef.current
      if (suppress) suppress.current = Date.now() + 800
      onSelectRef.current?.(issueId)
    }
    const viewport = map.getViewport()
    viewport.addEventListener('click', onCircleClick, true)

    return () => {
      viewport.removeEventListener('click', onCircleClick, true)
      map.removeLayer(layer)
      map.removeLayer(meetLayer)
      layerRef.current = null
      meetLayerRef.current = null
    }
  }, [active, mapContext?.mapReady, mapContext?.mapInstanceRef])

  /** 체크된(반전 대상) 관로나 목록에서 마우스를 올린 관로가 있으면 공통 선택 펄스를 돌린다. */
  const hasFlip =
    Boolean(meetHighlight?.hoverKey) ||
    Boolean(
      meetHighlight?.pipes.some((p) => meetHighlight.checkedKeys.has(wtlTopoPipeKey(p.table, p.ogcFid)))
    )
  useEffect(() => {
    if (!active || !hasFlip) return
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      return
    }
    let rafId = 0
    const loop = () => {
      pulseRef.current += DATA_QUERY_SELECTION_PULSE_STEP
      meetLayerRef.current?.changed()
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(rafId)
      pulseRef.current = 0
      meetLayerRef.current?.changed()
    }
  }, [active, hasFlip])

  /**
   * 검토 중인 관로가 있으면 나머지 지하시설물(WMS)을 흐리게 해서 해당 관로에 집중시킨다.
   * 검토가 끝나거나 탭을 벗어나면 원래 투명도로 되돌린다.
   */
  const focusActive =
    Boolean(meetHighlight && meetHighlight.pipes.length > 0) ||
    Boolean(selectedLine && selectedLine.length >= 2)
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady || !active || !focusActive) return

    const dim = (layer: BaseLayer) => {
      if (layer.get(BG_LAYER_KEY) !== true) return
      if (typeof layer.get(DIM_PREV_KEY) === 'number') return
      const prev = layer.getOpacity()
      layer.set(DIM_PREV_KEY, prev)
      layer.setOpacity(prev * DIM_OPACITY_RATIO)
    }
    const restore = (layer: BaseLayer) => {
      const prev = layer.get(DIM_PREV_KEY)
      if (typeof prev !== 'number') return
      layer.setOpacity(prev)
      layer.unset(DIM_PREV_KEY)
    }

    const layers = map.getLayers()
    layers.getArray().forEach(dim)
    // 확대·축소 등으로 시설 레이어가 새로 추가돼도 같은 처리
    const addKey = layers.on('add', (e) => dim(e.element as BaseLayer))
    return () => {
      unByKey(addKey)
      layers.getArray().forEach(restore)
    }
  }, [active, focusActive, mapContext?.mapReady, mapContext?.mapInstanceRef])

  useEffect(() => {
    const source = layerRef.current?.getSource()
    if (!source) return
    source.clear()
    if (!result) return

    for (const issue of result.issues) {
      // 오류를 선택하면 그 오류의 원만 그린다. 선택 해제 시 목록 전체 원을 다시 그린다.
      if (selectedId && issue.id !== selectedId) continue
      if (!selectedId && visibleIds && !visibleIds.has(issue.id)) continue
      const pt = new Feature({ geometry: new Point(toView(issue.point)) })
      pt.setId(issue.id)
      pt.set('issueId', issue.id)
      pt.set('role', 'point')
      source.addFeature(pt)
    }

    // 선택 관로: 접합점 다중선이 없을 때 빨간 선+화살표 (역방향·샘플 등)
    const hasMeet = Boolean(meetHighlight && meetHighlight.pipes.length > 0)
    if (!hasMeet && selectedLine && selectedLine.length >= 2) {
      const lineFeat = new Feature({
        geometry: new LineString(selectedLine.map(toView)),
      })
      lineFeat.setId('selected-line')
      lineFeat.set('role', 'selected-line')
      source.addFeature(lineFeat)
    }

    layerRef.current?.changed()
  }, [result, visibleIds, selectedId, selectedLine, meetHighlight, viewProj]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !selectedId || !result) {
      layerRef.current?.changed()
      return
    }
    const issue = result.issues.find((i) => i.id === selectedId)
    if (issue) {
      // 오류마다 관 길이가 달라, 선택한 관로(또는 지점)가 화면에 다 들어오도록 맞춘다
      const coords = [issue.point, ...(issue.line ?? [])].map(toView)
      fitToCoords(map, coords)
    }
    layerRef.current?.changed()
    // 좌표계 변경만으로는 다시 맞추지 않는다(선택이 바뀔 때만)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, result, mapContext?.mapInstanceRef])

  /**
   * 접합점·유수방향 검토 관로가 불러와지면, 모인 관로 전체가 보이도록 다시 맞춘다.
   * 체크 토글(방향만 바뀜)에는 다시 맞추지 않도록 관로 구성으로만 판단한다.
   */
  const meetPipesSig = meetHighlight
    ? meetHighlight.pipes.map((p) => wtlTopoPipeKey(p.table, p.ogcFid)).join('|')
    : ''
  const meetFitRef = useRef('')
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !meetPipesSig || !meetHighlight) {
      meetFitRef.current = ''
      return
    }
    if (meetFitRef.current === meetPipesSig) return
    meetFitRef.current = meetPipesSig
    if (meetHighlight.noFit) return
    const coords = meetHighlight.pipes.flatMap((p) => p.line.map(toView))
    fitToCoords(map, coords)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 관로 구성이 바뀔 때만
  }, [meetPipesSig, mapContext?.mapInstanceRef])

  useEffect(() => {
    const source = meetLayerRef.current?.getSource()
    if (!source) return
    source.clear()
    if (!meetHighlight || meetHighlight.pipes.length === 0) {
      meetLayerRef.current?.changed()
      return
    }
    meetHighlight.pipes.forEach((p) => {
      if (p.line.length < 2) return
      const key = wtlTopoPipeKey(p.table, p.ogcFid)
      const checked = meetHighlight.checkedKeys.has(key)
      const coords =
        meetHighlight.preview && checked ? [...p.line].reverse() : p.line
      const mode = meetHighlight.preview
        ? checked
          ? 'flip'
          : 'keep'
        : checked
          ? 'flip'
          : 'idle'
      const f = new Feature({
        geometry: new LineString(coords.map(toView)),
      })
      f.setId(`meet-${key}`)
      f.set('mode', mode)
      f.set('color', p.color || WTL_TOPO_PIPE_DEFAULT_COLOR)
      f.set('label', wtlTopoPipeName(p.table, p.ogcFid))
      f.set('hover', meetHighlight.hoverKey === key)
      source.addFeature(f)
    })
    meetLayerRef.current?.changed()
  }, [meetHighlight, viewProj]) // eslint-disable-line react-hooks/exhaustive-deps
}
