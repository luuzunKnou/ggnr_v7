'use client'

import { useEffect, useRef } from 'react'
import type { MapBrowserEvent } from 'ol'
import { unByKey } from 'ol/Observable'
import Feature from 'ol/Feature'
import { LineString, Point, Polygon } from 'ol/geom'
import ImageLayer from 'ol/layer/Image'
import VectorLayer from 'ol/layer/Vector'
import Overlay from 'ol/Overlay'
import ImageWMS from 'ol/source/ImageWMS'
import VectorSource from 'ol/source/Vector'
import GeoJSON from 'ol/format/GeoJSON'
import { Circle, Fill, Stroke, Style, Text } from 'ol/style'
import { call } from '@/lib/api'
import { geoserverWmsImageLoadFunction } from '@/lib/geoserverWmsImageLoad'
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
} from '@/lib/mapDataQueryMapHighlight'
import { getGeoServerBase } from '@/lib/geoserverUrl'
import { scaleMetersFromZoom } from '../../../../_mapComponents/hooks/mapScale'
import '../../../../_mapComponents/config/projections'
import {
  FORCE_IGNORE_SCALE_LAYER_KEY,
  mergeIgnoreScaleEnv,
  setIgnoreScaleFlag,
} from '../../../../_mapComponents/layerFactory/iconScaleWmsEnv'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import { fetchWtlAnalysisPipeWmsParams } from '../resolveWtlAnalysisPipeWms'
import { lonLatToView, useMapViewProjection, viewExtentToMercator } from '../topology/topoMapProjection'
import type { WtlOutageSelectionHighlight } from './wtlOutageMapFly'
import { outagePolygonsOf, type WtlOutageGate, type WtlOutageResult } from './wtlOutageSample'
import { setPanActive } from './wtlOutageEditShared'

const WORKSPACE = 'ggnr'
/** 급수전계량기 레이어 스타일 기본값(sld env 기본과 동일) — WMS 불가 시 폴백 */
const META_PS_FILL = 'rgba(255, 255, 255, 0.3)'
const META_PS_STROKE = '#17499d'
/** GeoServer(OGC) 축척 계산: 해상도(m/px) ÷ 0.28mm */
const OGC_PIXEL_M = 0.00028
/**
 * 수용가 점 지름(px) — 축척(1:N)별. 확대할수록 크게, 축소할수록 작게.
 * WMS에 ENV wtl_meta_ps_size + ignore_scale=1 로 넘긴다(공간분석은 축척 무관 표시).
 */
const META_PS_SIZE_STEPS: { maxScale: number; size: number }[] = [
  { maxScale: 300, size: 26 },
  { maxScale: 500, size: 22 },
  { maxScale: 800, size: 20 },
  { maxScale: 1500, size: 17 },
  { maxScale: 3000, size: 14 },
  { maxScale: 6000, size: 12 },
]
/** 이보다 작게는 줄이지 않음(클릭할 수 있는 크기 유지) */
const META_PS_SIZE_MIN = 10

function metaPsSizeAt(resolution: number): number {
  const scale = resolution / OGC_PIXEL_M
  return META_PS_SIZE_STEPS.find((s) => scale <= s.maxScale)?.size ?? META_PS_SIZE_MIN
}

const metaPsStyleCache = new Map<number, Style>()
function metaPsCircleStyle(size: number): Style {
  let style = metaPsStyleCache.get(size)
  if (!style) {
    style = new Style({
      image: new Circle({
        radius: size / 2,
        fill: new Fill({ color: META_PS_FILL }),
        stroke: new Stroke({ color: META_PS_STROKE, width: size >= 10 ? 2 : 1.5 }),
      }),
    })
    metaPsStyleCache.set(size, style)
  }
  return style
}

/** WMS 필터를 못 만들 때 — 축척 크기 그대로 항상 원 */
function metaPsAlwaysStyle(_feature: unknown, resolution: number) {
  return metaPsCircleStyle(metaPsSizeAt(resolution))
}

/**
 * GeoServer PostGIS 저장소는 PK(ogc_fid)를 속성으로 노출하지 않아 `ogc_fid=` CQL이 실패한다.
 * 피처 ID(`wtl_meta_ps.<ogc_fid>`) 필터를 쓴다 — serviceLayerFactory 와 같은 방식.
 */
function metaPsFidCql(ids: number[]): string {
  return `IN (${ids.map((id) => `'wtl_meta_ps.${Math.trunc(id)}'`).join(',')})`
}

/** WMS(ignore_scale)가 그릴 때는 벡터 폴백 숨김 — 필터 불가 시에만 always 스타일 */
function metaPsFallbackStyle(_feature: unknown, _resolution: number) {
  return undefined
}

/** WMS 수용가 점 크기 + 축척 무시(ignore_scale=1) */
function applyMetaPsWmsSize(layer: ImageLayer<ImageWMS> | null, resolution: number | undefined) {
  const source = layer?.getSource()
  if (!source || !resolution) return
  const env = setIgnoreScaleFlag(`wtl_meta_ps_size:${metaPsSizeAt(resolution)}`, true)
  if (source.getParams().ENV === env) return
  source.updateParams({ ...source.getParams(), ENV: env })
}
/** 필지 선택 강조(PNU 없을 때 대체) — 펄스 없는 고정 스타일 */
const PARCEL_SELECTION_STYLE = [
  new Style({
    stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.95)', width: 7 }),
    fill: new Fill({ color: 'rgba(220, 38, 38, 0.16)' }),
  }),
  new Style({
    stroke: new Stroke({ color: 'rgba(220, 38, 38, 0.85)', width: 4 }),
  }),
]

/** 화면 범위 제수변 버튼 (서비스 상한과 맞춤) */
const VISIBLE_GATE_LIMIT = 800
/** 좌측 하단 축척 240m. 이 값 이하(더 확대)에서만 열림·잠금 */
export const OUTAGE_OVERLAY_MAX_SCALE_M = 240

export function isOutageOverlayScaleVisible(zoom: number | undefined): boolean {
  if (zoom == null || !Number.isFinite(zoom)) return false
  const meters = scaleMetersFromZoom(zoom)
  return meters != null && meters <= OUTAGE_OVERLAY_MAX_SCALE_M
}

function clearOutageGraphics(source: VectorSource) {
  source
    .getFeatures()
    .filter((feature) => {
      const role = String(feature.get('role') ?? '')
      return role === 'zone' || role === 'pipe' || role === 'gate'
    })
    .forEach((feature) => source.removeFeature(feature))
}

function paintOutageResult(
  source: VectorSource,
  result: WtlOutageResult,
  viewProj: string,
  options?: { hideZone?: boolean; hiddenPipeIndexes?: number[] }
) {
  const toView = (c: [number, number]) => lonLatToView(c, viewProj)
  if (!options?.hideZone) {
    // 구멍(지우기로 뺀 곳) 포함
    outagePolygonsOf(result).forEach((poly, index) => {
      const rings = poly.map((raw) => {
        const ring = raw.map(toView)
        const first = ring[0]
        const last = ring[ring.length - 1]
        if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push(first)
        return ring
      })
      const zone = new Feature({ geometry: new Polygon(rings) })
      zone.setId(`zone-${result.gateId}-${index}`)
      zone.set('role', 'zone')
      source.addFeature(zone)
    })
  }
  const hidden = new Set(options?.hiddenPipeIndexes ?? [])
  result.pipes.forEach((line, index) => {
    if (line.length < 2 || hidden.has(index)) return
    const pipe = new Feature({ geometry: new LineString(line.map(toView)) })
    pipe.setId(`pipe-${result.gateId}-${index}`)
    pipe.set('role', 'pipe')
    source.addFeature(pipe)
  })
}

type GateControl = {
  overlay: Overlay
  root: HTMLDivElement
  openBtn: HTMLButtonElement
  lockBtn: HTMLButtonElement
  gateId: string
}

function paintRadio(control: GateControl, locked: boolean) {
  const base = 'px-1.5 py-0.5 text-[10px] font-semibold leading-none transition-colors'
  control.openBtn.className = locked
    ? `${base} rounded-l border border-slate-300 bg-white text-slate-500 hover:bg-slate-50`
    : `${base} rounded-l border border-emerald-600 bg-emerald-600 text-white`
  control.lockBtn.className = locked
    ? `${base} rounded-r border border-red-600 bg-red-600 text-white`
    : `${base} rounded-r border border-slate-300 bg-white text-slate-500 hover:bg-slate-50`
  control.openBtn.setAttribute('aria-checked', locked ? 'false' : 'true')
  control.lockBtn.setAttribute('aria-checked', locked ? 'true' : 'false')
}

type Props = {
  active: boolean
  pickMode: boolean
  lockedGateIds: string[]
  result: WtlOutageResult | null
  /** 수용가·도로명·필지 목록 선택 강조 */
  selectionHighlight?: WtlOutageSelectionHighlight | null
  /** 도형편집 중이면 단수 면은 편집 레이어만 표시 */
  hideZone?: boolean
  hiddenPipeIndexes?: number[]
  onVisibleGates: (gates: WtlOutageGate[]) => void
  onLockGate: (gateId: string) => void
  onUnlockGate: (gateId: string) => void
  /** 지도에서 결과 수용가 점 클릭 */
  onSelectCustomer?: (customerId: string) => void
}

export function useWtlOutageMapLayer({
  active,
  pickMode,
  lockedGateIds,
  result,
  selectionHighlight = null,
  hideZone = false,
  hiddenPipeIndexes = [],
  onVisibleGates,
  onLockGate,
  onUnlockGate,
  onSelectCustomer,
}: Props) {
  const mapContext = useMapContext()
  /** 현재 지도 좌표계(기본 3857, 카카오 배경이면 5181) — 바뀌면 도형·버튼 위치를 다시 잡는다 */
  const viewProj = useMapViewProjection(mapContext?.mapInstanceRef, mapContext?.mapReady)
  const wmsRef = useRef<ImageLayer<ImageWMS> | null>(null)
  const pipeLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const pipeSourceRef = useRef<VectorSource | null>(null)
  const outageLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const highlightLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const highlightSourceRef = useRef<VectorSource | null>(null)
  const metaWmsRef = useRef<ImageLayer<ImageWMS> | null>(null)
  /** 선택 필지 — 지적(jijuk) 레이어 스타일 그대로, PNU로 그 필지만 */
  const jijukWmsRef = useRef<ImageLayer<ImageWMS> | null>(null)
  /** 분석 결과 수용가 전체 — wtl_meta_ps 레이어 스타일 */
  const resultMetaWmsRef = useRef<ImageLayer<ImageWMS> | null>(null)
  /** 1:3000보다 축소됐을 때 결과 수용가 점(WMS 대체) */
  const resultMetaVecRef = useRef<VectorSource | null>(null)
  const pulsePhaseRef = useRef(0)
  const controlsRef = useRef<Map<string, GateControl>>(new Map())
  const visibleGatesRef = useRef<Map<string, WtlOutageGate>>(new Map())
  const gateCacheRef = useRef<Map<string, WtlOutageGate>>(new Map())
  const visibleIdsKeyRef = useRef('')
  const pickRef = useRef(pickMode)
  const lockedRef = useRef<Set<string>>(new Set(lockedGateIds))
  const onVisibleRef = useRef(onVisibleGates)
  const onLockRef = useRef(onLockGate)
  const onUnlockRef = useRef(onUnlockGate)
  const fetchSeqRef = useRef(0)
  pickRef.current = pickMode
  lockedRef.current = new Set(lockedGateIds)
  onVisibleRef.current = onVisibleGates
  onLockRef.current = onLockGate
  onUnlockRef.current = onUnlockGate
  const onSelectCustomerRef = useRef(onSelectCustomer)
  onSelectCustomerRef.current = onSelectCustomer
  const resultRef = useRef(result)
  resultRef.current = result

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady || !active) return
    const toView = (c: [number, number]) => lonLatToView(c, viewProj)

    const wmsUrl = `${getGeoServerBase()}/${WORKSPACE}/wms`
    // 분할 없으면 부모+급수, 있으면 분할+급수(부모 제외). 조회 전엔 부모로 두고 갱신
    const initialPipeWms = {
      LAYERS: 'wtl_pipe_lm,wtl_sply_ls',
      STYLES: 'wtl_pipe_lm,wtl_sply_ls',
      ENV: 'wtl_pipe_lm_stroke_width:3;wtl_pipe_lm_label_property_name:;wtl_sply_ls_label_property_name:',
    }
    const wms = new ImageLayer({
      source: new ImageWMS({
        url: wmsUrl,
        params: {
          ...initialPipeWms,
          TRANSPARENT: true,
          FORMAT: 'image/png',
        },
        serverType: 'geoserver',
        ratio: 1.5,
        // 분할 관로 라벨 제거 SLD_BODY는 POST
        imageLoadFunction: geoserverWmsImageLoadFunction,
      }),
      zIndex: 880,
    })
    wms.set('wtlOutageWms', true)
    map.addLayer(wms)
    wmsRef.current = wms

    let pipeWmsCancelled = false
    void fetchWtlAnalysisPipeWmsParams({ pipeWidth: 3 }).then((pipeParams) => {
      if (pipeWmsCancelled) return
      const source = wms.getSource()
      if (!source) return
      const next = { ...source.getParams(), ...pipeParams }
      if (pipeParams.SLD_BODY) {
        next.STYLES = ''
      } else {
        delete next.SLD_BODY
      }
      source.updateParams(next)
    })

    // 제수변(SA200) — 열림·잠금 오버레이와 같은 축척(≤240m)에서만 표시.
    // SLD 1:3000보다 오버레이가 먼저 뜨므로, 보일 때는 ignore_scale=1로 심볼도 같이 그린다.
    const valveWms = new ImageLayer({
      source: new ImageWMS({
        url: wmsUrl,
        params: {
          LAYERS: 'wtl_valv_ps',
          STYLES: 'wtl_valv_ps',
          CQL_FILTER: `ftr_cde='SA200'`,
          ENV: mergeIgnoreScaleEnv(undefined, true),
          TRANSPARENT: true,
          FORMAT: 'image/png',
        },
        serverType: 'geoserver',
        ratio: 1.5,
      }),
      zIndex: 925,
      visible: isOutageOverlayScaleVisible(map.getView().getZoom()),
    })
    valveWms.set('wtlOutageValveWms', true)
    valveWms.set(FORCE_IGNORE_SCALE_LAYER_KEY, true)
    map.addLayer(valveWms)

    // vector fallback — WMS와 겹치면 고정 굵기로 번지므로 기본 숨김(미사용)
    const pipeSource = new VectorSource()
    const pipeLayer = new VectorLayer({
      source: pipeSource,
      zIndex: 879,
      visible: false,
      style: (feature) => {
        const table = String(feature.get('pipeTable') ?? '')
        if (table === 'wtl_sply_ls') {
          return new Style({ stroke: new Stroke({ color: '#93c5fd', width: 1.5 }) })
        }
        return new Style({ stroke: new Stroke({ color: '#2563eb', width: 2 }) })
      },
    })
    pipeLayer.set('wtlOutagePipeVec', true)
    map.addLayer(pipeLayer)
    pipeSourceRef.current = pipeSource
    pipeLayerRef.current = pipeLayer

    const outageSource = new VectorSource()
    const pipePulseStyle = createDataQuerySelectionRowHighlightStyle(() => pulsePhaseRef.current)
    // 단수 관로 — 구역의 근거선이라 펄스 없이 차분하게(흰 테두리 + 진한 빨강)
    const outagePipeStyle = [
      new Style({ stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.85)', width: 4.5 }) }),
      new Style({ stroke: new Stroke({ color: 'rgba(185, 28, 28, 0.85)', width: 2.5 }) }),
    ]
    const outageLayer = new VectorLayer({
      source: outageSource,
      zIndex: 920,
      style: (feature, resolution) => {
        const role = String(feature.get('role') ?? '')
        const id = String(feature.getId() ?? '')
        const gateId = String(feature.get('gateId') ?? id)
        const locked = lockedRef.current.has(gateId)
        // 단수구역(면) — 결과의 주인공이라 면이 펄스(데이터조회 Polygon 선택 강조와 동일)
        if (role === 'zone') {
          return pipePulseStyle(feature, resolution)
        }
        if (role === 'pipe') {
          return outagePipeStyle
        }
        // 잠긴 제수변 — 단수 구간이 없을 때만 레이더 펄스(어느 제수변을 잠갔는지 보이게).
        // 단수 구간이 생기면 단수구역 면이 펄스하므로 관리번호만 표시
        const gateLabel = new Style({
            text: new Text({
              text: String(feature.get('label') ?? ''),
              offsetY: 18,
              font: 'bold 11px sans-serif',
              fill: new Fill({ color: locked ? '#7f1d1d' : '#134e4a' }),
              stroke: new Stroke({ color: '#ffffff', width: 3 }),
            }),
          })
        if (!feature.get('gatePulse')) return gateLabel
        return [pipePulseStyle(feature, resolution), gateLabel]
          .flat()
          .filter((s): s is Style => s instanceof Style)
      },
    })
    outageLayer.set('wtlOutage', true)
    map.addLayer(outageLayer)
    outageLayerRef.current = outageLayer

    const highlightSource = new VectorSource()
    const highlightLayer = new VectorLayer({
      source: highlightSource,
      zIndex: 960,
      style: createDataQuerySelectionRowHighlightStyle(() => pulsePhaseRef.current),
    })
    highlightLayer.set('wtlOutageSelection', true)
    map.addLayer(highlightLayer)
    highlightLayerRef.current = highlightLayer
    highlightSourceRef.current = highlightSource

    // 수용가·도로명 — wtl_meta_ps 레이어 스타일로 점 표시 (ignore_scale로 축척 무관)
    const metaWms = new ImageLayer({
      source: new ImageWMS({
        url: `${getGeoServerBase()}/${WORKSPACE}/wms`,
        params: {
          LAYERS: `${WORKSPACE}:wtl_meta_ps`,
          STYLES: 'wtl_meta_ps',
          ENV: mergeIgnoreScaleEnv(undefined, true),
          TRANSPARENT: true,
          FORMAT: 'image/png',
        },
        serverType: 'geoserver',
        ratio: 1.5,
        imageLoadFunction: geoserverWmsImageLoadFunction,
        crossOrigin: 'anonymous',
      }),
      zIndex: 955,
      visible: false,
    })
    metaWms.set('wtlOutageMetaWms', true)
    metaWms.set(FORCE_IGNORE_SCALE_LAYER_KEY, true)

    const jijukWms = new ImageLayer({
      source: new ImageWMS({
        url: `${getGeoServerBase()}/${WORKSPACE}/wms`,
        params: {
          LAYERS: `${WORKSPACE}:jijuk`,
          STYLES: 'jijuk',
          TRANSPARENT: true,
          FORMAT: 'image/png',
        },
        serverType: 'geoserver',
        ratio: 1.5,
        imageLoadFunction: geoserverWmsImageLoadFunction,
        crossOrigin: 'anonymous',
      }),
      zIndex: 956,
      visible: false,
    })
    jijukWms.set('wtlOutageJijukWms', true)
    map.addLayer(jijukWms)
    jijukWmsRef.current = jijukWms

    // 선택 필지는 지적 스타일을 기반으로 외곽선만 굵게·라벨 검정(halo 흰색) — 서버가 만든 SLD_BODY.
    // 실패하면 원래 jijuk 스타일 그대로
    let parcelSldDisposed = false
    call('', 'POST', { service: 'wtlOutageService', action: 'loadWtlOutageParcelSld', params: {} })
      .then((res) => {
        if (parcelSldDisposed) return
        const sld = ((res?.data ?? res) as { sld?: string | null })?.sld
        const src = jijukWms.getSource()
        if (!sld || !src) return
        const params = { ...src.getParams() } as Record<string, unknown>
        delete params.STYLES
        // 긴 SLD_BODY는 geoserverWmsImageLoadFunction이 POST로 보낸다
        src.updateParams({ ...params, STYLES: '', SLD_BODY: sld })
      })
      .catch(() => {
        /* 원래 jijuk 스타일 유지 */
      })
    map.addLayer(metaWms)
    metaWmsRef.current = metaWms

    // 분석 결과 수용가 위치 — 같은 wtl_meta_ps 스타일, ogc_fid 목록으로 필터(길면 POST)
    const resultMetaWms = new ImageLayer({
      source: new ImageWMS({
        url: `${getGeoServerBase()}/${WORKSPACE}/wms`,
        params: {
          LAYERS: `${WORKSPACE}:wtl_meta_ps`,
          STYLES: 'wtl_meta_ps',
          ENV: mergeIgnoreScaleEnv(undefined, true),
          TRANSPARENT: true,
          FORMAT: 'image/png',
        },
        serverType: 'geoserver',
        ratio: 1.5,
        imageLoadFunction: geoserverWmsImageLoadFunction,
        crossOrigin: 'anonymous',
      }),
      zIndex: 950,
      visible: false,
    })
    resultMetaWms.set('wtlOutageResultMetaWms', true)
    resultMetaWms.set(FORCE_IGNORE_SCALE_LAYER_KEY, true)
    map.addLayer(resultMetaWms)
    resultMetaWmsRef.current = resultMetaWms

    const resultMetaVecSource = new VectorSource()
    const resultMetaVec = new VectorLayer({
      source: resultMetaVecSource,
      zIndex: 951,
      style: metaPsFallbackStyle,
    })
    resultMetaVec.set('wtlOutageResultMetaVec', true)
    map.addLayer(resultMetaVec)
    resultMetaVecRef.current = resultMetaVecSource

    const resolveGate = (gateId: string): WtlOutageGate | null =>
      visibleGatesRef.current.get(gateId) ?? gateCacheRef.current.get(gateId) ?? null

    const rememberGate = (gate: WtlOutageGate) => {
      gateCacheRef.current.set(gate.id, gate)
    }

    const ensureControl = (gate: WtlOutageGate) => {
      rememberGate(gate)
      let control = controlsRef.current.get(gate.id)
      if (control) {
        control.overlay.setPosition(toView(gate.point))
        return control
      }
      const root = document.createElement('div')
      root.setAttribute('role', 'radiogroup')
      root.setAttribute('aria-label', `${gate.name} 개폐`)
      root.className = 'flex overflow-hidden rounded shadow-md'
      // 루트는 클릭 통과 → 아래 제수변 WMS 속성조회. 버튼만 잠금 UI.
      root.style.pointerEvents = 'none'
      root.style.userSelect = 'none'

      const openBtn = document.createElement('button')
      openBtn.type = 'button'
      openBtn.setAttribute('role', 'radio')
      openBtn.textContent = '열림'
      openBtn.style.pointerEvents = 'auto'

      const lockBtn = document.createElement('button')
      lockBtn.type = 'button'
      lockBtn.setAttribute('role', 'radio')
      lockBtn.textContent = '잠금'
      lockBtn.style.pointerEvents = 'auto'

      // pointerdown만 막아 버튼에서 팬이 시작되지 않게 함.
      // pointerup까지 막으면 지도에서 시작한 드래그를 버튼 위에서 뗄 때
      // DragPan이 풀리지 않아 지도가 마우스에 붙은 채로 움직인다.
      const stopDown = (event: Event) => event.stopPropagation()
      const releaseStuckPan = () => {
        setPanActive(map, false)
        setPanActive(map, true)
      }
      for (const btn of [openBtn, lockBtn]) {
        btn.addEventListener('pointerdown', stopDown)
        btn.addEventListener('dblclick', stopDown)
        btn.addEventListener('selectstart', (event) => event.preventDefault())
        btn.addEventListener('pointerup', releaseStuckPan)
        btn.addEventListener('pointercancel', releaseStuckPan)
        btn.addEventListener('lostpointercapture', releaseStuckPan)
      }

      // 열림·잠금 어느 쪽을 눌러도 현재 상태를 반전(토글)
      const toggle = (event: Event) => {
        event.preventDefault()
        event.stopPropagation()
        const current = resolveGate(gate.id)
        if (!current) return
        if (lockedRef.current.has(gate.id)) onUnlockRef.current(gate.id)
        else onLockRef.current(gate.id)
      }
      openBtn.addEventListener('click', toggle)
      lockBtn.addEventListener('click', toggle)

      root.append(openBtn, lockBtn)
      const overlay = new Overlay({
        element: root,
        positioning: 'bottom-center',
        offset: [0, -14],
        stopEvent: false,
      })
      overlay.setPosition(toView(gate.point))
      map.addOverlay(overlay)
      control = { overlay, root, openBtn, lockBtn, gateId: gate.id }
      controlsRef.current.set(gate.id, control)
      return control
    }

    const syncVisibleControls = (gates: WtlOutageGate[]) => {
      const nextMap = new Map(gates.map((g) => [g.id, g]))
      visibleGatesRef.current = nextMap
      for (const gate of gates) rememberGate(gate)

      const keep = new Set(gates.map((g) => g.id))
      for (const id of lockedRef.current) keep.add(id)

      // id 집합이 바뀔 때만 패널에 알려 React 갱신 줄임
      const idsKey = [...keep].sort().join(',')
      if (idsKey !== visibleIdsKeyRef.current) {
        visibleIdsKeyRef.current = idsKey
        onVisibleRef.current(gates)
      }

      for (const gate of gates) {
        const control = ensureControl(gate)
        paintRadio(control, lockedRef.current.has(gate.id))
      }
      for (const id of lockedRef.current) {
        const gate = resolveGate(id)
        if (!gate) continue
        const control = ensureControl(gate)
        paintRadio(control, true)
      }

      for (const [id, control] of [...controlsRef.current.entries()]) {
        if (keep.has(id)) continue
        map.removeOverlay(control.overlay)
        controlsRef.current.delete(id)
      }
    }

    let moveTimer: ReturnType<typeof setTimeout> | null = null
    const clearControls = () => {
      for (const control of controlsRef.current.values()) {
        map.removeOverlay(control.overlay)
      }
      controlsRef.current.clear()
    }

    const fetchVisibleGates = async () => {
      if (!isOutageOverlayScaleVisible(map.getView().getZoom())) {
        clearControls()
        return
      }
      const size = map.getSize()
      const extent = size ? map.getView().calculateExtent(size) : null
      if (!extent || extent.length < 4) {
        syncVisibleControls([])
        return
      }
      const pad = Math.max((extent[2] - extent[0]) * 0.02, 20)
      // 서버는 3857 bbox를 받는다
      const bbox = viewExtentToMercator(
        [extent[0] - pad, extent[1] - pad, extent[2] + pad, extent[3] + pad],
        viewProj
      )
      const seq = ++fetchSeqRef.current
      try {
        const response = await call('', 'POST', {
          service: 'wtlOutageService',
          action: 'listWtlOutageGates',
          params: {
            bbox,
            limit: VISIBLE_GATE_LIMIT,
          },
        })
        if (seq !== fetchSeqRef.current) return
        const rows = ((response?.data ?? response)?.rows ?? []) as WtlOutageGate[]
        syncVisibleControls(rows.filter((g) => g?.id && Array.isArray(g.point) && g.point.length >= 2))
      } catch {
        if (seq !== fetchSeqRef.current) return
        syncVisibleControls([])
      }
    }

    const onResolution = () => {
      const scaleOk = isOutageOverlayScaleVisible(map.getView().getZoom())
      valveWms.setVisible(scaleOk)
      if (!scaleOk) clearControls()
    }

    const syncMetaPsSize = () => {
      const res = map.getView().getResolution()
      applyMetaPsWmsSize(metaWms, res)
      applyMetaPsWmsSize(resultMetaWms, res)
    }
    syncMetaPsSize()

    const onMoveEnd = () => {
      syncMetaPsSize()
      if (moveTimer) clearTimeout(moveTimer)
      moveTimer = setTimeout(() => {
        void fetchVisibleGates()
        // 벡터 관로는 WMS와 중복·고정 굵기 번짐 → 조회하지 않음
      }, 200)
    }

    /** 클릭 지점에서 가장 가까운 결과 수용가(점 반지름 + 여유 안) */
    const customerAt = (evt: MapBrowserEvent<PointerEvent>): string | null => {
      const customers = resultRef.current?.customers ?? []
      if (customers.length === 0) return null
      const res = map.getView().getResolution() ?? 1
      const tolPx = metaPsSizeAt(res) / 2 + 4
      let best: string | null = null
      let bestPx = Infinity
      for (const c of customers) {
        if (!c.point) continue
        const px = map.getPixelFromCoordinate(toView(c.point))
        if (!px) continue
        const d = Math.hypot(px[0] - evt.pixel[0], px[1] - evt.pixel[1])
        if (d <= tolPx && d < bestPx) {
          bestPx = d
          best = c.id
        }
      }
      return best
    }

    const onClick = (evt: MapBrowserEvent<PointerEvent>) => {
      if (!pickRef.current) return
      // 결과 수용가 점 — 목록 선택. stopPropagation 하지 않아 계량기 속성조회도 가능
      const customerId = onSelectCustomerRef.current ? customerAt(evt) : null
      if (customerId) {
        onSelectCustomerRef.current?.(customerId)
        return
      }
      // 제수변은 열림/잠금 버튼으로만 잠그고, 본체 클릭은 속성조회(식별)로 넘긴다.
    }

    const moveKey = map.on('moveend', onMoveEnd)
    const resolutionKey = map.getView().on('change:resolution', onResolution)
    const clickKey = map.on('singleclick', onClick as never)
    void fetchVisibleGates()

    return () => {
      pipeWmsCancelled = true
      parcelSldDisposed = true
      if (moveTimer) clearTimeout(moveTimer)
      unByKey(moveKey)
      unByKey(resolutionKey)
      unByKey(clickKey)
      for (const control of controlsRef.current.values()) {
        map.removeOverlay(control.overlay)
      }
      controlsRef.current.clear()
      visibleGatesRef.current.clear()
      visibleIdsKeyRef.current = ''
      map.removeLayer(metaWms)
      map.removeLayer(jijukWms)
      jijukWmsRef.current = null
      map.removeLayer(resultMetaWms)
      map.removeLayer(resultMetaVec)
      resultMetaWmsRef.current = null
      resultMetaVecRef.current = null
      map.removeLayer(highlightLayer)
      map.removeLayer(outageLayer)
      map.removeLayer(pipeLayer)
      map.removeLayer(wms)
      map.removeLayer(valveWms)
      metaWmsRef.current = null
      highlightLayerRef.current = null
      highlightSourceRef.current = null
      outageLayerRef.current = null
      pipeLayerRef.current = null
      pipeSourceRef.current = null
      wmsRef.current = null
    }
  }, [active, mapContext?.mapReady, mapContext?.mapInstanceRef, viewProj])

  // 단수 관로·목록 선택 강조 반짝임(데이터조회와 동일 펄스)
  useEffect(() => {
    const hasOutagePipes = Boolean(result?.pipes?.some((line) => line.length >= 2))
    if (!selectionHighlight && !hasOutagePipes && lockedGateIds.length === 0) return
    let rafId = 0
    const loop = () => {
      pulsePhaseRef.current += DATA_QUERY_SELECTION_PULSE_STEP
      highlightSourceRef.current?.changed()
      outageLayerRef.current?.getSource()?.changed()
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [selectionHighlight, result, lockedGateIds.length])

  // 잠금 상태 버튼 표시 갱신 + 단수 관로/면 표시
  useEffect(() => {
    const source = outageLayerRef.current?.getSource()
    const map = mapContext?.mapInstanceRef?.current
    if (!source || !map) return

    clearOutageGraphics(source)

    for (const [id, control] of controlsRef.current.entries()) {
      paintRadio(control, lockedGateIds.includes(id))
    }

    const markerIds = new Set<string>(lockedGateIds)
    // 단수 관로가 그려지면 제수변 펄스는 끔(단수구역 면 펄스로 충분). 수용가·도로명·필지 선택 펄스는 별도 레이어라 유지
    const gatePulse = !result?.pipes?.some((line) => line.length >= 2)
    for (const id of markerIds) {
      const gate = visibleGatesRef.current.get(id) ?? gateCacheRef.current.get(id)
      if (!gate) continue
      const feature = new Feature({ geometry: new Point(lonLatToView(gate.point, viewProj)) })
      feature.setId(gate.id)
      feature.set('role', 'gate')
      feature.set('isRadarPoint', gatePulse)
      feature.set('gatePulse', gatePulse)
      feature.set('gateId', gate.id)
      feature.set('label', gate.name)
      source.addFeature(feature)
    }

    if (result) paintOutageResult(source, result, viewProj, { hideZone, hiddenPipeIndexes })
    outageLayerRef.current?.changed()
  }, [result, lockedGateIds, hideZone, hiddenPipeIndexes, mapContext?.mapInstanceRef, viewProj])

  // 분석 결과 수용가 전체를 wtl_meta_ps 레이어 스타일로 표시
  const customerFidKey = (result?.customers ?? [])
    .map((c) => c.ogcFid)
    .filter((id): id is number => id != null && Number.isFinite(id))
    .map((id) => Math.trunc(id))
    .sort((a, b) => a - b)
    .join(',')
  const customerPoints = result?.customers
  useEffect(() => {
    const vec = resultMetaVecRef.current
    if (!vec) return
    vec.clear()
    for (const c of customerPoints ?? []) {
      if (!c.point || !Number.isFinite(c.point[0]) || !Number.isFinite(c.point[1])) continue
      vec.addFeature(new Feature({ geometry: new Point(lonLatToView(c.point, viewProj)) }))
    }
  }, [customerPoints, active, mapContext?.mapReady, viewProj])

  useEffect(() => {
    const layer = resultMetaWmsRef.current
    const source = layer?.getSource()
    if (!layer || !source) return
    const params = { ...source.getParams() } as Record<string, unknown>
    if (!customerFidKey) {
      layer.setVisible(false)
      delete params.CQL_FILTER
      source.updateParams(params)
      return
    }
    // 숫자 ogc_fid만 넣으므로 CQL 주입 위험 없음
    source.updateParams({ ...params, CQL_FILTER: metaPsFidCql(customerFidKey.split(',').map(Number)) })
    layer.setVisible(true)
    // viewProj: 좌표계가 바뀌면 레이어를 새로 만들므로 필터도 다시 건다
  }, [customerFidKey, active, mapContext?.mapReady, viewProj])

  // 수용가·도로명(점) / 필지(면) 선택 강조
  useEffect(() => {
    const source = highlightSourceRef.current ?? highlightLayerRef.current?.getSource()
    const metaWms = metaWmsRef.current
    const metaSource = metaWms?.getSource()
    if (!source) return
    source.clear()
    pulsePhaseRef.current = 0

    const jijukWms = jijukWmsRef.current
    const jijukSource = jijukWms?.getSource()
    const hideJijukWms = () => {
      if (!jijukWms || !jijukSource) return
      jijukWms.setVisible(false)
      const params = { ...jijukSource.getParams() } as Record<string, unknown>
      delete params.CQL_FILTER
      jijukSource.updateParams(params)
    }
    if (selectionHighlight?.kind !== 'polygon') hideJijukWms()

    const hideMetaWms = () => {
      if (!metaWms || !metaSource) return
      metaWms.setVisible(false)
      const params = { ...metaSource.getParams() } as Record<string, unknown>
      delete params.CQL_FILTER
      metaSource.updateParams(params)
    }

    if (!selectionHighlight) {
      hideMetaWms()
      highlightLayerRef.current?.changed()
      return
    }

    if (selectionHighlight.kind === 'point') {
      // 1) wtl_meta_ps 레이어 스타일(WMS)로 점 표시
      let cql: string | null = null
      if (selectionHighlight.ogcFid != null && Number.isFinite(selectionHighlight.ogcFid)) {
        cql = metaPsFidCql([selectionHighlight.ogcFid])
      } else if (selectionHighlight.meterNo?.trim()) {
        const m = selectionHighlight.meterNo.trim().replace(/'/g, "''")
        cql = `met_num='${m}'`
      }
      const useWms = Boolean(metaWms && metaSource && cql)
      if (useWms) {
        metaSource!.updateParams({ ...metaSource!.getParams(), CQL_FILTER: cql })
        metaWms!.setVisible(true)
      } else {
        hideMetaWms()
      }
      // WMS(ignore_scale) 실패·필터 불가 시에만 같은 기본 모양 원
      const base = new Feature({ geometry: new Point(lonLatToView(selectionHighlight.point, viewProj)) })
      base.setId('outage-meta-point-fallback')
      base.set('role', 'meta-point-fallback')
      base.setStyle(useWms ? metaPsFallbackStyle : metaPsAlwaysStyle)
      source.addFeature(base)
      // 2) 기존 선택 펄스(레이더) 유지
      const pulse = new Feature({ geometry: new Point(lonLatToView(selectionHighlight.point, viewProj)) })
      pulse.setId('outage-selection-point')
      pulse.set('role', 'selection-point')
      pulse.set('isRadarPoint', true)
      source.addFeature(pulse)
    } else {
      hideMetaWms()
      try {
        const features = new GeoJSON().readFeatures(
          {
            type: 'Feature',
            geometry: selectionHighlight.geometry4326,
            properties: {},
          },
          { dataProjection: 'EPSG:4326', featureProjection: viewProj }
        )
        // 필지 — 지적(jijuk) 레이어 스타일 그대로 그 필지만(PNU 필터). PNU가 없으면 고정 강조로 대신
        const pnu = String(selectionHighlight.pnu ?? '').replace(/\D/g, '').slice(0, 19)
        if (jijukWms && jijukSource && pnu.length >= 19) {
          jijukSource.updateParams({ ...jijukSource.getParams(), CQL_FILTER: `pnu='${pnu}'` })
          jijukWms.setVisible(true)
        } else {
          hideJijukWms()
          for (const f of features) {
            f.set('role', 'selection-polygon')
            f.setStyle(PARCEL_SELECTION_STYLE)
            source.addFeature(f)
          }
        }
      } catch {
        /* ignore */
      }
    }
    highlightLayerRef.current?.changed()
  }, [selectionHighlight, viewProj])
}
