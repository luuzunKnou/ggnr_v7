'use client'

import { useEffect, useRef } from 'react'
import type { MapBrowserEvent } from 'ol'
import { unByKey } from 'ol/Observable'
import Feature from 'ol/Feature'
import { boundingExtent } from 'ol/extent'
import { LineString, MultiLineString, Point } from 'ol/geom'
import ImageLayer from 'ol/layer/Image'
import VectorLayer from 'ol/layer/Vector'
import ImageWMS from 'ol/source/ImageWMS'
import VectorSource from 'ol/source/Vector'
import { Circle, Fill, Icon, Stroke, Style, Text } from 'ol/style'
import { call } from '@/lib/api'
import { getGeoServerBase, getGeoServerPublicBase } from '@/lib/geoserverUrl'
import { resolveSymbolPreviewUrl } from '@/lib/geoserverStyleUtils'
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
} from '@/lib/mapDataQueryMapHighlight'
import '../../../../_mapComponents/config/projections'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import { scaleMetersFromZoom } from '../../../../_mapComponents/hooks/mapScale'
import { isOutageOverlayScaleVisible } from '../outage/useWtlOutageMapLayer'
import { fetchWtlAnalysisPipeWmsParams } from '../resolveWtlAnalysisPipeWms'
import {
  getViewProjectionCode,
  lonLatToView,
  mercatorToView,
  useMapViewProjection,
  viewExtentToMercator,
  viewToMercator,
} from '../topology/topoMapProjection'
import type { WtlLeakGate, WtlLeakResult, WtlLeakSnap } from './wtlLeakSample'

const WORKSPACE = 'ggnr'
const LEAK = '#dc2626'
const GATE_FOCUS_ZOOM = 17
const SA200_ICON_SIZE = 50
/**
 * 축척(좌측 하단 막대, m)별 제수변 아이콘 크기(px). 위에서부터 첫 일치
 * — 120m·240m에서는 작게, 그보다 확대하면 기본 크기
 */
const SA200_SIZE_BY_SCALE: { maxScaleM: number; size: number }[] = [
  { maxScaleM: 60, size: SA200_ICON_SIZE },
  { maxScaleM: 120, size: 34 },
  { maxScaleM: 240, size: 24 },
]
/** 탐색 관로 위 SA200 심볼 — 펄스 선(920)보다 위 */
const SA200_LAYER_Z = 935

/** 누수지점 선택 전 배경 관로 선 굵기(px) — SLD env 값. 기본 SLD는 상수관로 1px라 얇다 */
const BASE_PIPE_WIDTH = 3
const BASE_SPLY_WIDTH = 2.5
/** 결과 구간 클릭용 투명 선(표시는 pipe-all 한 피처가 담당) */
const PIPE_HIT_STYLE = new Style({ stroke: new Stroke({ color: 'rgba(0, 0, 0, 0.01)', width: 12 }) })
/** 스냅된 관로 강조 선 굵기(px) */
const SNAP_PIPE_WIDTH = 6

type Props = {
  active: boolean
  pickMode: boolean
  /** false면 지도 클릭으로 새 분석을 하지 않음(제수변·관로 선택은 가능) */
  analyzeEnabled?: boolean
  result: WtlLeakResult | null
  selectedGateId: string | null
  /** 선택된 경로(관로 LINE) 인덱스 — 해당 LINE에 pulse 강조 */
  selectedPipeIndex?: number | null
  /** 목록·지도에서 제수변을 고를 때마다 증가 — 해당 위치로 이동·펄스 */
  gateFocusToken?: number
  /** 이력 행을 누를 때마다 증가 — 같은 이력을 다시 눌러도 결과 범위로 이동 */
  historyFitToken?: number
  onSnap: (snap: WtlLeakSnap, result: WtlLeakResult) => void
  onSnapError: (msg: string) => void
  onSelectGate: (gate: WtlLeakGate) => void
  onSelectPipe?: (index: number | null) => void
  onBusy?: (busy: boolean) => void
  hiddenPipeIndexes?: number[]
}

export function useWtlLeakMapLayer({
  active,
  pickMode,
  analyzeEnabled = true,
  result,
  selectedGateId,
  selectedPipeIndex = null,
  gateFocusToken = 0,
  historyFitToken = 0,
  onSnap,
  onSnapError,
  onSelectGate,
  onSelectPipe,
  onBusy,
  hiddenPipeIndexes = [],
}: Props) {
  const mapContext = useMapContext()
  /** 현재 지도 좌표계(기본 3857, 카카오 배경이면 5181) — 바뀌면 도형을 다시 그린다 */
  const viewProj = useMapViewProjection(mapContext?.mapInstanceRef, mapContext?.mapReady)
  const wmsRef = useRef<ImageLayer<ImageWMS> | null>(null)
  const pipeLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const pipeSourceRef = useRef<VectorSource | null>(null)
  const valveLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const valveSourceRef = useRef<VectorSource | null>(null)
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const highlightLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const highlightSourceRef = useRef<VectorSource | null>(null)
  const pulsePhaseRef = useRef(0)
  const pickRef = useRef(pickMode)
  const selectedRef = useRef(selectedGateId)
  const selectedPipeRef = useRef(selectedPipeIndex)
  const onSnapRef = useRef(onSnap)
  const onErrRef = useRef(onSnapError)
  const onSelectRef = useRef(onSelectGate)
  const onSelectPipeRef = useRef(onSelectPipe)
  const onBusyRef = useRef(onBusy)
  const busyRef = useRef(false)
  pickRef.current = pickMode
  const analyzeRef = useRef(analyzeEnabled)
  analyzeRef.current = analyzeEnabled

  // 누수지점 지정 가능할 때만 십자 커서
  useEffect(() => {
    const el = mapContext?.mapInstanceRef?.current?.getTargetElement()
    if (!el || !active) return
    if (pickMode && analyzeEnabled) el.style.cursor = 'crosshair'
    else if (el.style.cursor === 'crosshair') el.style.cursor = ''
  }, [pickMode, analyzeEnabled, active, mapContext?.mapReady, mapContext?.mapInstanceRef])
  selectedRef.current = selectedGateId
  selectedPipeRef.current = selectedPipeIndex
  onSnapRef.current = onSnap
  onErrRef.current = onSnapError
  onSelectRef.current = onSelectGate
  onSelectPipeRef.current = onSelectPipe
  onBusyRef.current = onBusy

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady || !active) return
    const toView = (c: [number, number]) => lonLatToView(c, viewProj)

    const wmsUrl = `${getGeoServerBase()}/${WORKSPACE}/wms`
    // 분할 없으면 부모+급수, 있으면 분할+급수(부모 제외). 조회 전엔 부모로 두고 갱신
    const initialPipeWms = {
      LAYERS: 'wtl_pipe_lm,wtl_sply_ls',
      STYLES: 'wtl_pipe_lm_nolabel,wtl_sply_ls_nolabel',
      ENV: `wtl_pipe_lm_stroke_width:${BASE_PIPE_WIDTH};wtl_sply_ls_stroke_width:${BASE_SPLY_WIDTH}`,
    }
    const wms = new ImageLayer({
      source: new ImageWMS({
        url: wmsUrl,
        params: {
          // 제수변(SA200)은 SLD 축척 제한이 있어 아래 벡터 레이어로 항상 표시
          ...initialPipeWms,
          TRANSPARENT: true,
          FORMAT: 'image/png',
        },
        serverType: 'geoserver',
        ratio: 1.5,
      }),
      zIndex: 880,
    })
    wms.set('wtlLeakWms', true)
    map.addLayer(wms)
    wmsRef.current = wms

    let pipeWmsCancelled = false
    void fetchWtlAnalysisPipeWmsParams({
      pipeWidth: BASE_PIPE_WIDTH,
      splyWidth: BASE_SPLY_WIDTH,
    }).then((pipeParams) => {
      if (pipeWmsCancelled) return
      const source = wms.getSource()
      if (!source) return
      source.updateParams({ ...source.getParams(), ...pipeParams })
    })

    // vector fallback — WMS 미가용 시 DB에서 직접 관로 표시
    const pipeSource = new VectorSource()
    const pipeLayer = new VectorLayer({
      source: pipeSource,
      zIndex: 879,
      style: (feature) => {
        const table = String(feature.get('pipeTable') ?? '')
        if (table === 'wtl_sply_ls') {
          return new Style({ stroke: new Stroke({ color: '#93c5fd', width: BASE_SPLY_WIDTH }) })
        }
        return new Style({ stroke: new Stroke({ color: '#2563eb', width: BASE_PIPE_WIDTH }) })
      },
    })
    pipeLayer.set('wtlLeakPipeVec', true)
    map.addLayer(pipeLayer)
    pipeSourceRef.current = pipeSource
    pipeLayerRef.current = pipeLayer

    const sa200IconUrl =
      resolveSymbolPreviewUrl('wtl_valv_ps_sa200.svg', getGeoServerPublicBase()) ??
      `${getGeoServerBase()}/www/symbol/water/wtl_valv_ps_sa200.svg`
    const valveSource = new VectorSource()
    const sa200Styles = new Map<number, Style>()
    const valveLayer = new VectorLayer({
      source: valveSource,
      zIndex: SA200_LAYER_Z,
      style: (_feature, resolution) => {
        const zoom = map.getView().getZoomForResolution(resolution)
        // 축척 막대 값과 맞추려고 반올림(줌 소수점 오차로 240.00m가 240.01m로 밀리지 않게)
        const meters = zoom == null ? null : scaleMetersFromZoom(Math.round(zoom * 1000) / 1000)
        const size =
          meters == null
            ? SA200_ICON_SIZE
            : (SA200_SIZE_BY_SCALE.find((s) => meters <= s.maxScaleM)?.size ?? SA200_SIZE_BY_SCALE.at(-1)!.size)
        let style = sa200Styles.get(size)
        if (!style) {
          style = new Style({
            image: new Icon({ src: sa200IconUrl, scale: size / 24, anchor: [0.5, 0.5] }),
          })
          sa200Styles.set(size, style)
        }
        return style
      },
    })
    valveLayer.set('wtlLeakSa200Vec', true)
    map.addLayer(valveLayer)
    valveSourceRef.current = valveSource
    valveLayerRef.current = valveLayer

    const source = new VectorSource()
    const pipePulseStyle = createDataQuerySelectionRowHighlightStyle(() => pulsePhaseRef.current)
    const layer = new VectorLayer({
      source,
      zIndex: 920,
      style: (feature, resolution) => {
        const role = String(feature.get('role') ?? '')
        // 탐색 관로 표시 — 구간 전체를 한 피처로 그려 이음부가 겹쳐 진해지지 않게(데이터조회 LINE 펄스와 동일)
        if (role === 'pipe-all') {
          return pipePulseStyle(feature, resolution)
        }
        // 구간별 선택용 — 거의 투명(클릭·선택만 받음)
        if (role === 'pipe') {
          return PIPE_HIT_STYLE
        }
        if (role === 'leak') {
          return new Style({
            image: new Circle({
              radius: 9,
              fill: new Fill({ color: LEAK }),
              stroke: new Stroke({ color: '#ffffff', width: 2 }),
            }),
            text: new Text({
              text: '누수',
              offsetY: -14,
              font: '11px sans-serif',
              fill: new Fill({ color: '#7f1d1d' }),
              stroke: new Stroke({ color: '#ffffff', width: 3 }),
            }),
          })
        }
        const id = String(feature.get('gateId') ?? '')
        const selected = id === selectedRef.current
        // 점은 wtl_valv_ps WMS가 담당. 오버레이는 관리번호 라벨만
        return new Style({
          text: new Text({
            text: String(feature.get('label') ?? ''),
            offsetY: selected ? -20 : -18,
            font: selected ? 'bold 16px sans-serif' : '14px sans-serif',
            fill: new Fill({ color: selected ? '#ea580c' : '#000000' }),
            stroke: new Stroke({ color: '#ffffff', width: 2 }),
          }),
        })
      },
    })
    layer.set('wtlLeak', true)
    map.addLayer(layer)
    layerRef.current = layer

    const highlightSource = new VectorSource()
    const highlightLayer = new VectorLayer({
      source: highlightSource,
      zIndex: 940,
      style: createDataQuerySelectionRowHighlightStyle(() => pulsePhaseRef.current),
    })
    highlightLayer.set('wtlLeakGatePulse', true)
    map.addLayer(highlightLayer)
    highlightLayerRef.current = highlightLayer
    highlightSourceRef.current = highlightSource

    // 마우스를 움직이면 가까운 관로 위 점에 스냅 표시 — 클릭은 이 점으로 분석
    const snapSource = new VectorSource()
    const snapLayer = new VectorLayer({
      source: snapSource,
      zIndex: 925,
      style: (feature) =>
        // 스냅된 관로 — 흰 테두리 위에 굵은 선으로 어느 관로에 붙었는지 표시
        feature.get('role') === 'snap-pipe'
          ? [
              new Style({ stroke: new Stroke({ color: '#ffffff', width: SNAP_PIPE_WIDTH + 3, lineCap: 'round' }) }),
              new Style({ stroke: new Stroke({ color: '#dc2626', width: SNAP_PIPE_WIDTH, lineCap: 'round' }) }),
            ]
          : new Style({
              image: new Circle({
                radius: 7,
                fill: new Fill({ color: 'rgba(220, 38, 38, 0.85)' }),
                stroke: new Stroke({ color: '#ffffff', width: 2 }),
              }),
            }),
    })
    map.addLayer(snapLayer)
    let snapFeature: Feature<Point> | null = null
    let snapPipeFeature: Feature | null = null
    let snapPipeSource: Feature | null = null
    let snapPoint: [number, number] | null = null
    const SNAP_PX = 15

    const clearSnap = () => {
      snapPoint = null
      if (snapPipeFeature) {
        snapSource.removeFeature(snapPipeFeature)
        snapPipeFeature = null
        snapPipeSource = null
      }
      if (snapFeature) {
        snapSource.removeFeature(snapFeature)
        snapFeature = null
      }
    }

    const onPointerMove = (evt: MapBrowserEvent<PointerEvent>) => {
      if (evt.dragging || !pickRef.current || !analyzeRef.current || busyRef.current) {
        clearSnap()
        return
      }
      const pipeSrc = pipeSourceRef.current
      const near = pipeSrc?.getClosestFeatureToCoordinate(evt.coordinate)
      const geom = near?.getGeometry()
      if (!geom) {
        clearSnap()
        return
      }
      const closest = geom.getClosestPoint(evt.coordinate) as [number, number]
      const res = map.getView().getResolution() ?? 1
      const distPx = Math.hypot(closest[0] - evt.coordinate[0], closest[1] - evt.coordinate[1]) / res
      if (distPx > SNAP_PX) {
        clearSnap()
        return
      }
      snapPoint = [closest[0], closest[1]]
      // 붙은 관로 강조(같은 관로면 다시 만들지 않음). 점이 위에 그려지도록 먼저 추가
      if (near && snapPipeSource !== near) {
        if (snapPipeFeature) snapSource.removeFeature(snapPipeFeature)
        snapPipeFeature = new Feature({ geometry: geom.clone() })
        snapPipeFeature.set('role', 'snap-pipe')
        snapPipeSource = near
        snapSource.addFeature(snapPipeFeature)
        if (snapFeature) {
          snapSource.removeFeature(snapFeature)
          snapSource.addFeature(snapFeature)
        }
      }
      if (!snapFeature) {
        snapFeature = new Feature({ geometry: new Point(snapPoint) })
        snapSource.addFeature(snapFeature)
      } else snapFeature.setGeometry(new Point(snapPoint))
    }

    const onClick = async (evt: MapBrowserEvent<PointerEvent>) => {
      if (!pickRef.current || busyRef.current) return
      // 제수변 피처 클릭이면 선택만
      const hit = map.forEachFeatureAtPixel(evt.pixel, (f) => (f.get('role') === 'pipe-all' ? undefined : f), {
        layerFilter: (l) => l === layer,
      })
      if (hit && String(hit.get('role')) === 'gate') {
        const gateId = String(hit.get('gateId') ?? '')
        const gate = (hit.get('gate') as WtlLeakGate | undefined) ?? null
        if (gate) onSelectRef.current(gate)
        else if (gateId) onSelectRef.current({ id: gateId, name: gateId, diameter: '—', address: '—', point: [0, 0] })
        evt.stopPropagation()
        return
      }

      // 결과 관로(경로 LINE) 클릭 → 선택 토글, pulse 강조
      if (hit && String(hit.get('role')) === 'pipe') {
        const index = Number(hit.get('pipeIndex') ?? -1)
        onSelectPipeRef.current?.(index === selectedPipeRef.current ? null : index)
        evt.stopPropagation()
        return
      }

      if (!analyzeRef.current) return
      busyRef.current = true
      onBusyRef.current?.(true)
      // 서버는 3857 클릭 좌표를 받는다
      const [clickX, clickY] = viewToMercator(snapPoint ?? evt.coordinate, viewProj)
      try {
        const res = await call('', 'POST', {
          service: 'wtlLeakService',
          action: 'analyzeWtlLeak',
          params: {
            // 스냅 표시 중이면 그 점(관로 위), 아니면 클릭 지점
            x: clickX,
            y: clickY,
            tolerance: 30,
          },
        })
        const body = (res?.data ?? res) as {
          result?: WtlLeakResult | null
          error?: string
        }
        if (body.error || !body.result) {
          onErrRef.current(body.error || '누수 분석에 실패했습니다.')
          return
        }
        onSnapRef.current(body.result.snap, body.result)
        evt.stopPropagation()
      } catch {
        onErrRef.current('누수 분석 요청에 실패했습니다.')
      } finally {
        busyRef.current = false
        onBusyRef.current?.(false)
        clearSnap()
      }
    }

    let moveTimer: ReturnType<typeof setTimeout> | null = null
    let viewFetchSeq = 0
    const fetchVisibleNetwork = async () => {
      const size = map.getSize()
      const extent = size ? map.getView().calculateExtent(size) : null
      if (!extent || extent.length < 4) return
      const pad = Math.max((extent[2] - extent[0]) * 0.02, 20)
      // 서버는 3857 bbox를 받는다
      const bbox = viewExtentToMercator(
        [extent[0] - pad, extent[1] - pad, extent[2] + pad, extent[3] + pad],
        viewProj
      )
      const seq = ++viewFetchSeq
      // 제수변은 축척 240m 이하(더 확대)에서만 — 단수구역 열림·잠금과 같은 기준
      const showValves = isOutageOverlayScaleVisible(map.getView().getZoom())
      valveLayer.setVisible(showValves)
      if (!showValves) valveSourceRef.current?.clear()
      try {
        const [pipeRes, valveRes] = await Promise.all([
          call('', 'POST', {
            service: 'wtlOutageService',
            action: 'listWtlPipesInView',
            params: { bbox, limit: 3000 },
          }),
          showValves
            ? call('', 'POST', {
                service: 'wtlLeakService',
                action: 'listWtlSa200ValvesInView',
                params: { bbox, limit: 4000 },
              })
            : Promise.resolve(null),
        ])
        if (seq !== viewFetchSeq) return

        const pipeRows = ((pipeRes?.data ?? pipeRes)?.pipes ?? []) as {
          coords: [number, number][]
          table: string
        }[]
        const pipeSrc = pipeSourceRef.current
        if (pipeSrc) {
          pipeSrc.clear()
          for (const row of pipeRows) {
            if (!row.coords || row.coords.length < 2) continue
            const f = new Feature({ geometry: new LineString(row.coords.map(toView)) })
            f.set('pipeTable', row.table)
            f.set('role', 'view-pipe')
            pipeSrc.addFeature(f)
          }
        }

        const valveRows = ((valveRes?.data ?? valveRes)?.valves ?? []) as {
          ogcFid: number
          lon: number
          lat: number
          name: string
        }[]
        const valveSrc = valveSourceRef.current
        if (valveSrc && showValves) {
          valveSrc.clear()
          for (const row of valveRows) {
            if (![row.lon, row.lat].every((n) => Number.isFinite(n))) continue
            const f = new Feature({ geometry: new Point(toView([row.lon, row.lat])) })
            f.setId(`sa200-${row.ogcFid}`)
            f.set('role', 'view-sa200')
            f.set('ogcFid', row.ogcFid)
            f.set('label', row.name)
            valveSrc.addFeature(f)
          }
        }
      } catch {
        /* skip */
      }
    }

    // 축소하는 순간 바로 숨김(재조회는 moveend에서)
    const onResolution = () => {
      if (!isOutageOverlayScaleVisible(map.getView().getZoom())) valveLayer.setVisible(false)
    }
    const resKey = map.getView().on('change:resolution', onResolution)

    const onMoveEnd = () => {
      if (moveTimer) clearTimeout(moveTimer)
      moveTimer = setTimeout(() => {
        void fetchVisibleNetwork()
      }, 200)
    }

    const clickKey = map.on('singleclick', onClick as never)
    const moveKey = map.on('moveend', onMoveEnd)
    const pointerKey = map.on('pointermove', onPointerMove as never)
    const el = map.getTargetElement()
    if (el && pickRef.current && analyzeRef.current) el.style.cursor = 'crosshair'
    void fetchVisibleNetwork()

    return () => {
      pipeWmsCancelled = true
      if (moveTimer) clearTimeout(moveTimer)
      unByKey(clickKey)
      unByKey(moveKey)
      unByKey(pointerKey)
      unByKey(resKey)
      map.removeLayer(snapLayer)
      if (el && el.style.cursor === 'crosshair') el.style.cursor = ''
      map.removeLayer(highlightLayer)
      map.removeLayer(layer)
      map.removeLayer(valveLayer)
      map.removeLayer(pipeLayer)
      map.removeLayer(wms)
      layerRef.current = null
      wmsRef.current = null
      pipeLayerRef.current = null
      pipeSourceRef.current = null
      valveLayerRef.current = null
      valveSourceRef.current = null
      highlightLayerRef.current = null
      highlightSourceRef.current = null
    }
    // pickMode는 클릭 가능 여부만 바꾼다. 여기 넣으면 그리기·지우기·완료마다 결과선 레이어가 비워진다.
  }, [active, mapContext?.mapReady, mapContext?.mapInstanceRef, viewProj])

  useEffect(() => {
    const source = layerRef.current?.getSource()
    if (!source) return
    source.clear()
    if (!result) return
    const toView = (c: [number, number]) => lonLatToView(c, viewProj)

    const leak = new Feature({
      geometry: new Point(mercatorToView([result.snap.x, result.snap.y], viewProj)),
    })
    leak.set('role', 'leak')
    source.addFeature(leak)

    const hidden = new Set(hiddenPipeIndexes)
    // 좌표는 그대로(이어 붙이지 않음) 여러 선을 한 피처로만 묶는다
    const shown = result.pipes
      .filter((line, index) => line.length >= 2 && !hidden.has(index))
      .map((line) => line.map(toView))
    if (shown.length > 0) {
      const all = new Feature({ geometry: new MultiLineString(shown) })
      all.set('role', 'pipe-all')
      source.addFeature(all)
    }
    result.pipes.forEach((line, index) => {
      if (line.length < 2 || hidden.has(index)) return
      const f = new Feature({ geometry: new LineString(line.map(toView)) })
      f.setId(`leak-pipe-${index}`)
      f.set('role', 'pipe')
      f.set('pipeIndex', index)
      source.addFeature(f)
    })

    for (const gate of result.gates) {
      const f = new Feature({ geometry: new Point(toView(gate.point)) })
      f.setId(gate.id)
      f.set('role', 'gate')
      f.set('gateId', gate.id)
      f.set('label', gate.name)
      f.set('gate', gate)
      source.addFeature(f)
    }
    layerRef.current?.changed()
  }, [result, selectedGateId, hiddenPipeIndexes, viewProj])

  // 신규 분석·이력 불러오기(snap이 바뀜)에서만 맞춤. 선 편집·되돌리기는 snap이 그대로라 시점 유지
  const fittedSnapRef = useRef<unknown>(null)
  const fittedTokenRef = useRef(0)
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!result) {
      fittedSnapRef.current = null
      return
    }
    if (!map) return
    // 새 분석·이력 불러오기(snap 변경)이거나 이력 행을 다시 누른 경우(토큰 변경)만 이동
    if (fittedSnapRef.current === result.snap && fittedTokenRef.current === historyFitToken) return
    fittedSnapRef.current = result.snap
    fittedTokenRef.current = historyFitToken
    const proj = getViewProjectionCode(map)
    const pts: [number, number][] = [mercatorToView([result.snap.x, result.snap.y], proj)]
    for (const line of result.pipes) {
      for (const c of line) {
        if (c.length < 2) continue
        pts.push(lonLatToView([Number(c[0]), Number(c[1])], proj))
      }
    }
    for (const gate of result.gates) {
      pts.push(lonLatToView(gate.point, proj))
    }
    if (pts.length === 0) return
    map.getView().fit(boundingExtent(pts), {
      padding: [40, 40, 40, 40],
      maxZoom: 20,
      duration: 450,
    })
  }, [result, historyFitToken, mapContext?.mapInstanceRef])

  // 점 펄스: 제수변 미선택 시 누수지점, 선택 시 해당 제수변 (+ 선택 관로 LINE)
  useEffect(() => {
    const source = highlightSourceRef.current
    if (!source) return
    source.clear()
    pulsePhaseRef.current = 0
    if (!result) {
      highlightLayerRef.current?.changed()
      return
    }
    const gate = selectedGateId ? result.gates.find((g) => g.id === selectedGateId) : null
    if (gate) {
      const pulse = new Feature({ geometry: new Point(lonLatToView(gate.point, viewProj)) })
      pulse.setId('leak-gate-pulse')
      pulse.set('role', 'selection-point')
      pulse.set('isRadarPoint', true)
      source.addFeature(pulse)
    } else {
      const pulse = new Feature({ geometry: new Point(mercatorToView([result.snap.x, result.snap.y], viewProj)) })
      pulse.setId('leak-snap-pulse')
      pulse.set('role', 'selection-point')
      pulse.set('isRadarPoint', true)
      source.addFeature(pulse)
    }
    const hidden = new Set(hiddenPipeIndexes)
    if (
      selectedPipeIndex != null &&
      !hidden.has(selectedPipeIndex) &&
      result.pipes[selectedPipeIndex] &&
      result.pipes[selectedPipeIndex].length >= 2
    ) {
      const line = result.pipes[selectedPipeIndex].map((c) => lonLatToView(c, viewProj))
      const pulse = new Feature({ geometry: new LineString(line) })
      pulse.setId('leak-pipe-pulse')
      pulse.set('role', 'selection-line')
      source.addFeature(pulse)
    }
    highlightLayerRef.current?.changed()
  }, [result, selectedGateId, selectedPipeIndex, hiddenPipeIndexes, viewProj])

  // 탐색 관로·누수/제수변 점 강조 반짝임(데이터조회와 동일 펄스)
  useEffect(() => {
    if (!result) return
    let rafId = 0
    const loop = () => {
      pulsePhaseRef.current += DATA_QUERY_SELECTION_PULSE_STEP
      highlightSourceRef.current?.changed()
      layerRef.current?.getSource()?.changed()
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [result, selectedGateId, selectedPipeIndex])

  // 목록·지도에서 제수변을 고를 때만 이동(토큰 증가). 신규 분석·이력 fit과 겹치지 않음
  useEffect(() => {
    if (!gateFocusToken) return
    const map = mapContext?.mapInstanceRef?.current
    const current = result
    const gateId = selectedGateId
    if (!map || !current || !gateId) return
    const gate = current.gates.find((g) => g.id === gateId)
    if (!gate) return
    const center = lonLatToView(gate.point, getViewProjectionCode(map))
    map.getView().animate({
      center,
      zoom: Math.max(map.getView().getZoom() ?? GATE_FOCUS_ZOOM, GATE_FOCUS_ZOOM),
      duration: 400,
    })
    // result·selectedGateId는 토큰 시점 값만 쓰고, 의존하면 새 분석 fit을 덮어씀
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gateFocusToken only
  }, [gateFocusToken, mapContext?.mapInstanceRef])
}
