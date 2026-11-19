'use client'

import { useEffect, useRef } from 'react'
import Feature from 'ol/Feature'
import { LineString, Point } from 'ol/geom'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import ImageLayer from 'ol/layer/Image'
import ImageWMS from 'ol/source/ImageWMS'
import { Circle, Fill, Stroke, Style, Text } from 'ol/style'
import { getGeoServerBase } from '@/lib/geoserverUrl'
import { transform } from 'ol/proj'
import '../../../../_mapComponents/config/projections'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import { zoomFromScaleMeters } from '../../../../_mapComponents/hooks/mapScale'
import { scheduleFitMapToExtent3857 } from '../../../../_mapComponents/config/mapAutoNavigation'
import {
  createEmpty as createEmptyExtent,
  extend as extendExtent,
  extendCoordinate,
  isEmpty as isEmptyExtent,
} from 'ol/extent'
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
} from '@/lib/mapDataQueryMapHighlight'
import { geoserverWmsImageLoadFunction } from '@/lib/geoserverWmsImageLoad'
import type { WtlSupplyPathResult } from './wtlSupplySample'

const FLOW = '#38bdf8'
const PIPE_CASING = '#0c4a6e'
const DASH = [6, 22]
/** 대시 패턴 한 주기(합계). 오프셋이 이 값으로 순환해야 끊김이 없음 */
const DASH_PERIOD = DASH[0] + DASH[1]
const SOURCE = '#0369a1'
/** 결과 범위를 구하지 못했을 때만 쓰는 이동 줌 (축척 480m) */
const VIEW_ZOOM = 15
/** 결과 범위에 맞출 때 최대 줌 (축척 60m). 아주 작은 경로가 지나치게 확대되지 않게 */
const FIT_MAX_ZOOM = 18
/** 순차 재생: 물이 흐르는 속도(실제 m/s). 관로 길이에 따라 지점마다 도착 시각이 달라진다 */
const FLOW_SPEED_M_PER_S = 450
/** 아주 긴 경로에서 너무 오래 걸리지 않게 하는 총 재생 시간 상한(ms). 넘으면 속도를 올려 맞춤 */
const MAX_REVEAL_MS = 7000
/** 흰 대시(물 흐름) 화면 속도(px/s). 기존 프레임당 1.2px × 60fps 와 같음 */
const FLOW_DASH_PX_PER_S = 72
/**
 * 흐름 속도는 줌과 상관없이 화면 기준 일정(FLOW_DASH_PX_PER_S).
 * 대신 이 줌(좌측 하단 축척 120.00m = 줌 17)보다 축소하면 흰 대시 사이 간격을 넓혀
 * 선이 촘촘하고 분주해 보이는 것을 줄인다
 */
const DASH_SPACING_ZOOM = zoomFromScaleMeters(120)
/** 축소 시 대시 간격 최대 배율 (축척 120m→240m 사이에서 1→2배로 늘고, 240m 이상은 2배 유지) */
const DASH_GAP_MAX_FACTOR = 2
/** serviceLayerFactory 와 동일한 GeoServer 워크스페이스 */
const WMS_WORKSPACE = 'ggnr'
/** SLD 스타일명 = 테이블명 (정수장·배수지) */
const FACILITY_WMS_LAYERS = ['wtl_puri_as', 'wtl_serv_ps']

function to3857(coord: [number, number]): [number, number] {
  const [x, y] = transform(coord, 'EPSG:4326', 'EPSG:3857')
  return [x, y]
}

/** 폴리라인을 시작점에서 targetLen 까지만 잘라 반환 (끝점은 구간 내 보간) */
function sliceLine(coords: number[][], targetLen: number): number[][] {
  const out: number[][] = [coords[0]!]
  let acc = 0
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i]!
    const b = coords[i + 1]!
    const segLen = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!)
    if (acc + segLen >= targetLen) {
      const t = segLen === 0 ? 0 : (targetLen - acc) / segLen
      out.push([a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t])
      return out
    }
    out.push(b)
    acc += segLen
  }
  return out
}

/** 폴리라인에서 시작점 기준 a~b 거리 구간만 잘라 반환 (양 끝은 구간 내 보간) */
function subLine(coords: number[][], a: number, b: number): number[][] {
  const out: number[][] = []
  let acc = 0
  for (let i = 0; i < coords.length - 1; i++) {
    const p = coords[i]!
    const q = coords[i + 1]!
    const seg = Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!)
    const s0 = acc
    const s1 = acc + seg
    if (seg > 0 && s1 >= a && s0 <= b) {
      const at = (t: number) => [p[0]! + (q[0]! - p[0]!) * t, p[1]! + (q[1]! - p[1]!) * t]
      if (out.length === 0) out.push(at(Math.max(0, (a - s0) / seg)))
      out.push(at(Math.min(1, (b - s0) / seg)))
    }
    if (s1 > b) break
    acc = s1
  }
  return out
}

/**
 * 관로 선 굵기(px) — 줌별.
 * - 축소(줌 17 = 축척 120m 이하로 넓게): 나란한 관로는 어차피 화면에서 1px 도 안 떨어져 떼어 볼 수 없으므로,
 *   흐름이 잘 보이게 기존 굵기 그대로.
 * - 확대(줌 20 = 축척 15m 부근): 1~2m 간격으로 나란한 관로가 화면에서 10px 안팎 벌어지는데,
 *   테두리 10px 이면 맞닿아 한 선처럼 보이므로 가늘게.
 * - 그 사이는 줌에 따라 부드럽게 바꾼다.
 */
/**
 * 관경 등급 — 축소했을 때 촘촘한 배수 지관이 한 덩어리(면)처럼 보이지 않게 본관과 강약을 나눈다.
 * (dev DB 기준 50~100mm 가 대부분, 200mm 이상 본관은 약 1천 건)
 * 관경이 없거나 0 이면 숨기지 않도록 중간으로 둔다.
 */
type PipeTier = 'main' | 'mid' | 'minor'
const PIPE_TIER_MAIN_MM = 200
const PIPE_TIER_MINOR_MAX_MM = 100

function pipeTier(dip: number | null | undefined): PipeTier {
  if (dip == null || !Number.isFinite(dip) || dip <= 0) return 'mid'
  if (dip >= PIPE_TIER_MAIN_MM) return 'main'
  if (dip <= PIPE_TIER_MINOR_MAX_MM) return 'minor'
  return 'mid'
}

/** 굵은 관이 가는 관 위에 오도록 그리기 층 순서 (zIndex = 순위 × 3 + 테두리0·하늘색1·대시2) */
const PIPE_TIER_RANK: Record<PipeTier, number> = { minor: 0, mid: 1, main: 2 }

type PipeLook = {
  casing: number
  flow: number
  dash: number
  /** 하늘색 선 불투명도 */
  flowAlpha: number
  /** 흰 대시 불투명도 (0 이면 그리지 않음) */
  dashAlpha: number
}

/**
 * 관로 선 모양(px) — 줌·관경 등급별.
 * - 축소(줌 17 = 축척 120m 이하로 넓게): 나란한 관로는 어차피 떼어 볼 수 없으므로 본관 위주로 또렷하게.
 *   본관은 굵게 + 흐름 대시, 가지(100mm 이하)는 가늘고 옅게 + 대시 없음 → 마을 배수관망이 면처럼 뭉치지 않음.
 *   테두리는 하늘색보다 조금만 굵게 해서 선끼리 붙어 덩어리지는 것을 줄인다.
 * - 확대(줌 20 = 축척 15m 부근): 모든 등급을 비슷하게 가늘게 + 대시 표시 (나란한 관로가 떨어져 보이게).
 * - 그 사이는 줌에 따라 부드럽게 바꾼다.
 */
const PIPE_LOOK_ZOOM_WIDE = 17
const PIPE_LOOK_ZOOM_CLOSE = 20
const PIPE_LOOK_WIDE: Record<PipeTier, PipeLook> = {
  // 흰 대시는 모든 등급에 투명도를 줘서 하늘색 선 위에서 은은하게 흐르게 한다 (본관 0.75 > 중간 0.7 > 가지 0.65)
  // (관로 선 자체는 불투명 유지: 반투명이면 분기점·겹침마다 진한 얼룩이 생기고 테두리가 비쳐 탁해짐)
  main: { casing: 8, flow: 6, dash: 3, flowAlpha: 1, dashAlpha: 0.75 },
  mid: { casing: 6, flow: 4, dash: 2, flowAlpha: 1, dashAlpha: 0.7 },
  // 가지: 축소 시에도 경로와 흐름이 보이도록 얇은 테두리(1px)·3.5px 선에 가는 대시(1.8px)를 둔다.
  // 본관(대시 3px)보다 가늘고 옅게 해서 강약은 유지
  minor: { casing: 5.5, flow: 3.5, dash: 1.8, flowAlpha: 0.85, dashAlpha: 0.65 },
}
const PIPE_LOOK_CLOSE: Record<PipeTier, PipeLook> = {
  // 확대해도 같은 대시 투명도를 유지해 등급 간 강약이 뒤바뀌지 않게 한다
  main: { casing: 7, flow: 4.5, dash: 2.5, flowAlpha: 1, dashAlpha: 0.75 },
  mid: { casing: 6.5, flow: 4, dash: 2.2, flowAlpha: 1, dashAlpha: 0.7 },
  minor: { casing: 5.5, flow: 3.5, dash: 2, flowAlpha: 1, dashAlpha: 0.65 },
}

function pipeLook(zoom: number | undefined, tier: PipeTier): PipeLook {
  const a = PIPE_LOOK_WIDE[tier]
  const b = PIPE_LOOK_CLOSE[tier]
  const t =
    zoom == null || !Number.isFinite(zoom)
      ? 0
      : Math.min(1, Math.max(0, (zoom - PIPE_LOOK_ZOOM_WIDE) / (PIPE_LOOK_ZOOM_CLOSE - PIPE_LOOK_ZOOM_WIDE)))
  const mix = (x: number, y: number) => x + (y - x) * t
  return {
    casing: mix(a.casing, b.casing),
    flow: mix(a.flow, b.flow),
    dash: mix(a.dash, b.dash),
    flowAlpha: mix(a.flowAlpha, b.flowAlpha),
    dashAlpha: mix(a.dashAlpha, b.dashAlpha),
  }
}

const FLOW_RGB = '56, 189, 248' // FLOW(#38bdf8)

/** 관로 테두리·하늘색 선 스타일 (굵기 0 이면 생략) */
function pipeBaseStyles(
  look: PipeLook,
  geometry: LineString | undefined,
  zBase: number | undefined,
  join: boolean
): Style[] {
  const out: Style[] = []
  if (look.casing >= 0.5) {
    out.push(
      new Style({
        geometry,
        zIndex: zBase,
        stroke: new Stroke({
          color: PIPE_CASING,
          width: look.casing,
          lineCap: 'round',
          ...(join ? { lineJoin: 'round' as const } : {}),
        }),
      })
    )
  }
  out.push(
    new Style({
      geometry,
      zIndex: zBase == null ? undefined : zBase + 1,
      stroke: new Stroke({
        color: look.flowAlpha >= 0.999 ? FLOW : `rgba(${FLOW_RGB}, ${look.flowAlpha})`,
        width: look.flow,
        lineCap: 'round',
        ...(join ? { lineJoin: 'round' as const } : {}),
      }),
    })
  )
  return out
}

/** 대시 패턴 위상(0 ~ period) */
function dashPhase(x: number, period: number = DASH_PERIOD): number {
  return ((x % period) + period) % period
}

/**
 * 줌에 맞춘 흰 대시 패턴 [대시, 간격](px).
 * spacingRes(축척 120m 해상도)보다 축소하면 간격을 해상도 비율만큼(최대 DASH_GAP_MAX_FACTOR 배) 넓힌다
 */
function dashPattern(resolution: number, spacingRes: number | undefined): number[] {
  const ratio = spacingRes && spacingRes > 0 ? resolution / spacingRes : 1
  const factor = Math.min(DASH_GAP_MAX_FACTOR, Math.max(1, ratio))
  return [DASH[0]!, DASH[1]! * factor]
}

/** 이어 붙일 때 앞 선의 끝과 다음 관로의 끝점이 같다고 보는 거리 (EPSG:3857) */
const JOIN_TOL = 3
/** 분기점에서 이어갈 갈래를 고를 때 «가장 먼 끝» 거리가 이 값 이내면 같다고 보고 각도로 비교 (EPSG:3857) */
const FAR_TIE = 5

/** 합친 선을 이루는 원본 관로와, 선 시작 기준 그 관로의 거리 구간 [a, b] */
type StrokeMember = { i: number; a: number; b: number }

/** 선 잇기 비교용 렌더 통계 */
export type WtlSupplyRenderStats = {
  /** 원본 관로 수 */
  pipes: number
  /** 지도에 실제로 그리는 선 수 */
  lines: number
  /** 최근 1초 평균 지도 1프레임 렌더 시간(ms). 아직 측정 전이면 null */
  frameMs: number | null
}

type Props = {
  active: boolean
  result: WtlSupplyPathResult | null
  /** 순차 재생 중 여부. true→false 로 바뀌었는데 재생이 안 끝났으면 «중지»(전체 보기로 복귀) */
  revealing: boolean
  /** 값이 바뀔 때마다 순차 재생을 처음부터 시작 (0 = 아직 시작 안 함) */
  replayToken: number
  /** 순차 재생이 끝까지 진행돼 자연 종료되면 호출 */
  onRevealDone?: () => void
  hiddenPipeIndexes?: number[]
  /**
   * 선 잇기: 분기점에서 한 갈래를 이어가며 관로들을 하나의 선으로 합쳐 그린다.
   * false 면 기존처럼 관로마다 따로 그린다 (비교용)
   */
  mergeLines?: boolean
  /** 선 개수·렌더 시간 통계 (약 1초마다) */
  onRenderStats?: (stats: WtlSupplyRenderStats) => void
}

export function useWtlSupplyPathMapLayer({
  active,
  result,
  revealing,
  replayToken,
  onRevealDone,
  hiddenPipeIndexes = [],
  mergeLines = true,
  onRenderStats,
}: Props) {
  const mapContext = useMapContext()
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null)
  /** 관로별 feature (계산 기준). 선 잇기를 켜면 지도에는 넣지 않고 합친 선만 넣는다 */
  const pipeFeaturesRef = useRef<(Feature | undefined)[]>([])
  /** 도착 배수지에 가장 가까운 끝을 가진 관로 인덱스 (분기점에서 배수지 쪽 갈래를 고를 때 사용) */
  const destPipeIdxRef = useRef<Set<number>>(new Set())
  const mergeLinesRef = useRef(mergeLines)
  mergeLinesRef.current = mergeLines
  const onRenderStatsRef = useRef(onRenderStats)
  onRenderStatsRef.current = onRenderStats
  const statsRef = useRef<WtlSupplyRenderStats>({ pipes: 0, lines: 0, frameMs: null })
  const offsetRef = useRef(0)
  const rafRef = useRef(0)
  const pulsePhaseRef = useRef(0)
  // --- 순차 재생 상태 ---
  /** 순차 재생 가능 여부 (parentIndex 가 있을 때) */
  const seqRef = useRef(false)
  /** 물이 도달한 시설 기준 누적 거리 (EPSG:3857 m) */
  const frontRef = useRef(0)
  const totalRef = useRef(0)
  const revealDoneRef = useRef(true)
  const lastTsRef = useRef(0)
  /** 이미 도착 강조를 시작한 배수지 id */
  const arrivedRef = useRef<Set<string>>(new Set())
  /** 배수지 id → 물이 닿는 누적 거리 (EPSG:3857) */
  const destDistRef = useRef<Map<string, number>>(new Map())
  const resultRef = useRef<WtlSupplyPathResult | null>(result)
  resultRef.current = result
  const onRevealDoneRef = useRef(onRevealDone)
  onRevealDoneRef.current = onRevealDone


  /** 도착 배수지 강조 링 전부 제거 + 도착 기록 초기화 */
  const clearArrival = () => {
    arrivedRef.current.clear()
    const source = layerRef.current?.getSource()
    if (!source) return
    for (const f of source.getFeatures()) {
      if (String(f.get('role')) === 'arrive') source.removeFeature(f)
    }
  }

  /** 물이 닿은 배수지마다(선택 여부와 무관) 도착 시점에 강조 링 펄스 시작 */
  const triggerArrivals = () => {
    const source = layerRef.current?.getSource()
    const r = resultRef.current
    if (!source || !r) return
    for (const d of r.destinations ?? []) {
      if (arrivedRef.current.has(d.id)) continue
      const dist = destDistRef.current.get(d.id)
      if (dist == null || frontRef.current < dist) continue
      arrivedRef.current.add(d.id)
      const f = new Feature({ geometry: new Point(to3857(d.point)) })
      f.set('role', 'arrive')
      f.set('isRadarPoint', true) // createDataQuerySelectionRowHighlightStyle 의 포인트 레이더 펄스
      f.set('at', performance.now())
      source.addFeature(f)
    }
  }

  /** 순차 재생을 처음부터 시작 (순차 재생이 불가능한 결과면 즉시 전체 표시 후 종료 알림) */
  const startReveal = () => {
    clearArrival()
    lastTsRef.current = 0
    if (!seqRef.current) {
      frontRef.current = totalRef.current
      revealDoneRef.current = true
      layerRef.current?.changed()
      onRevealDoneRef.current?.()
      return
    }
    frontRef.current = 0
    revealDoneRef.current = false
    layerRef.current?.changed()
  }

  /**
   * 선 잇기: parentIndex(나무 구조)로 관로를 이어 붙여 선(stroke)을 만든다.
   * 분기점에서는 갈래 하나만 이어가고 나머지는 새 선으로 시작한다.
   * 이어갈 갈래 우선순위: ① 도착 배수지로 이어지는 갈래 ② 관경 등급이 높은 갈래 ③ 하류로 가장 멀리 가는 갈래
   * ④ 가장 곧은 갈래. 관경 등급(본관·중간·가지)이 바뀌는 곳에서는 굵기가 달라지므로 선을 끊는다.
   */
  const buildStrokes = (): Feature[] => {
    const r = resultRef.current
    const pf = pipeFeaturesRef.current
    const parents = r?.parentIndex ?? []
    const n = parents.length
    const geomOf = (i: number) => pf[i]?.getGeometry() as LineString | undefined
    const lenOf = (i: number) => Number(pf[i]?.get('len') ?? 0)
    const sdOf = (i: number) => Number(pf[i]?.get('startDist') ?? 0)
    const tierOf = (i: number) => ((pf[i]?.get('tier') as PipeTier | undefined) ?? 'mid')
    const tierRankOf = (i: number) => PIPE_TIER_RANK[tierOf(i)]

    const children: number[][] = Array.from({ length: n }, () => [])
    const isChild = new Array<boolean>(n).fill(false)
    for (let i = 0; i < n; i++) {
      const p = parents[i]
      if (p == null || p < 0 || p >= n || p === i || !pf[i] || !pf[p]) continue
      children[p]!.push(i)
      isChild[i] = true
    }
    const roots: number[] = []
    for (let i = 0; i < n; i++) if (pf[i] && !isChild[i]) roots.push(i)

    // 전위 순회 순서 → 역순으로 처리하면 하위부터 계산된다
    const order: number[] = []
    const seen = new Array<boolean>(n).fill(false)
    for (const root of roots) {
      const stack = [root]
      while (stack.length > 0) {
        const i = stack.pop()!
        if (seen[i]) continue
        seen[i] = true
        order.push(i)
        for (const c of children[i]!) if (!seen[c]) stack.push(c)
      }
    }
    const far = new Array<number>(n).fill(0)
    const reach = new Array<boolean>(n).fill(false)
    for (let k = order.length - 1; k >= 0; k--) {
      const i = order[k]!
      far[i] = sdOf(i) + lenOf(i)
      reach[i] = destPipeIdxRef.current.has(i)
      for (const c of children[i]!) {
        if (far[c]! > far[i]!) far[i] = far[c]!
        if (reach[c]) reach[i] = true
      }
    }

    // 관로 끝 방향과 다음 관로 시작 방향 사이 꺾임 각도(라디안, 0 = 직진)
    const turnAngle = (i: number, c: number): number => {
      const a = geomOf(i)?.getCoordinates()
      const b = geomOf(c)?.getCoordinates()
      if (!a || !b || a.length < 2 || b.length < 2) return Math.PI
      const p0 = a[a.length - 2]!
      const p1 = a[a.length - 1]!
      const q0 = b[0]!
      const q1 = b[1]!
      const a1 = Math.atan2(p1[1]! - p0[1]!, p1[0]! - p0[0]!)
      const a2 = Math.atan2(q1[1]! - q0[1]!, q1[0]! - q0[0]!)
      let d = Math.abs(a1 - a2)
      if (d > Math.PI) d = 2 * Math.PI - d
      return d
    }
    const chosen = new Array<number | null>(n).fill(null)
    for (let i = 0; i < n; i++) {
      let best: number | null = null
      for (const c of children[i]!) {
        if (best == null) {
          best = c
          continue
        }
        if (reach[c] !== reach[best]) {
          if (reach[c]) best = c
          continue
        }
        // 관경 등급이 높은 갈래(본관)를 이어간다
        if (tierRankOf(c) !== tierRankOf(best)) {
          if (tierRankOf(c) > tierRankOf(best)) best = c
          continue
        }
        if (Math.abs(far[c]! - far[best]!) > FAR_TIE) {
          if (far[c]! > far[best]!) best = c
          continue
        }
        if (turnAngle(i, c) < turnAngle(i, best)) best = c
      }
      chosen[i] = best
    }

    const out: Feature[] = []
    const assigned = new Array<boolean>(n).fill(false)
    const makeStroke = (
      coords: number[][],
      startDist: number | null,
      members: StrokeMember[],
      tier: PipeTier
    ) => {
      const geom = new LineString(coords)
      const f = new Feature({ geometry: geom })
      f.set('role', 'stroke')
      f.set('tier', tier)
      if (startDist != null) f.set('startDist', startDist)
      f.set('len', geom.getLength())
      f.set('members', members)
      out.push(f)
    }
    const starts = [...roots]
    // 순환 등으로 뿌리에서 닿지 않은 관로도 빠짐없이 그린다
    for (let i = 0; i < n; i++) if (pf[i] && !seen[i]) starts.push(i)
    while (starts.length > 0) {
      const s = starts.shift()!
      if (assigned[s] || !geomOf(s)) continue
      assigned[s] = true
      const coords = geomOf(s)!.getCoordinates().map((c) => [c[0]!, c[1]!])
      const members: StrokeMember[] = [{ i: s, a: 0, b: lenOf(s) }]
      let acc = lenOf(s)
      for (const c of children[s]!) if (c !== chosen[s]) starts.push(c)
      let cur = s
      for (;;) {
        const nxt = chosen[cur]
        if (nxt == null || assigned[nxt]) break
        // 관경 등급이 바뀌면 굵기가 달라지므로 새 선으로 시작
        if (tierOf(nxt) !== tierOf(s)) {
          starts.push(nxt)
          break
        }
        const cc = geomOf(nxt)?.getCoordinates()
        if (!cc || cc.length < 2) break
        const last = coords[coords.length - 1]!
        const head = cc[0]!
        const tail = cc[cc.length - 1]!
        if (Math.hypot(head[0]! - last[0]!, head[1]! - last[1]!) <= JOIN_TOL) {
          for (const c of cc.slice(1)) coords.push([c[0]!, c[1]!])
        } else if (Math.hypot(tail[0]! - last[0]!, tail[1]! - last[1]!) <= JOIN_TOL) {
          for (const c of cc.slice(0, -1).reverse()) coords.push([c[0]!, c[1]!])
        } else {
          // 끝이 맞닿지 않으면(데이터 틈) 억지로 잇지 않고 새 선으로 시작
          starts.push(nxt)
          break
        }
        assigned[nxt] = true
        members.push({ i: nxt, a: acc, b: acc + lenOf(nxt) })
        acc += lenOf(nxt)
        for (const c of children[nxt]!) if (c !== chosen[nxt]) starts.push(c)
        cur = nxt
      }
      makeStroke(coords, sdOf(s), members, tierOf(s))
    }
    // 케이스 보정으로 덧붙은 관로(parentIndex 범위 밖)는 각각 따로, 처음부터 표시
    for (let i = n; i < pf.length; i++) {
      const g = geomOf(i)
      if (!g) continue
      makeStroke(g.getCoordinates(), null, [{ i, a: 0, b: g.getLength() }], tierOf(i))
    }
    return out
  }

  /** 합친 선 위에서 단수 관로와 겹쳐 흐름을 멈출 구간(선 시작 기준 거리)을 갱신 */
  const refreshStrokeStops = () => {
    const source = layerRef.current?.getSource()
    if (!source) return
    const pf = pipeFeaturesRef.current
    for (const f of source.getFeatures()) {
      if (f.get('role') !== 'stroke') continue
      const members = (f.get('members') ?? []) as StrokeMember[]
      const ranges: [number, number][] = []
      for (const m of members) {
        if (!pf[m.i]?.get('flowStopped')) continue
        const prev = ranges[ranges.length - 1]
        if (prev && m.a - prev[1] <= 0.01) prev[1] = m.b
        else ranges.push([m.a, m.b])
      }
      f.set('stops', ranges.length > 0 ? ranges : undefined)
    }
  }

  /** 지도에 그릴 관로 선을 다시 넣는다 (선 잇기 켬: 합친 선 / 끔: 관로별) */
  const renderLines = () => {
    const source = layerRef.current?.getSource()
    if (!source) return
    const old = source.getFeatures().filter((f) => {
      const role = f.get('role')
      return role === 'pipe' || role === 'stroke'
    })
    for (const f of old) source.removeFeature(f)
    const pipes = pipeFeaturesRef.current.filter((f): f is Feature => Boolean(f))
    let lines: Feature[]
    if (mergeLinesRef.current && seqRef.current) {
      lines = buildStrokes()
      source.addFeatures(lines)
      refreshStrokeStops()
    } else {
      lines = pipes
      source.addFeatures(lines)
    }
    statsRef.current = { ...statsRef.current, pipes: pipes.length, lines: lines.length }
    onRenderStatsRef.current?.(statsRef.current)
    layerRef.current?.changed()
  }

  /** 전체 경로를 한 번에 표시 (초기 상태·중지). 도착 펄스는 지운다 */
  const showFull = () => {
    clearArrival()
    frontRef.current = totalRef.current
    revealDoneRef.current = true
    layerRef.current?.changed()
  }

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady || !active) return

    const source = new VectorSource()
    const pulseStyle = createDataQuerySelectionRowHighlightStyle(() => pulsePhaseRef.current)
    /** 축척 120m(줌 17)의 해상도 — 이보다 축소하면 대시 간격을 넓힌다 */
    const dashSpacingRes = map.getView().getResolutionForZoom(DASH_SPACING_ZOOM)
    const layer = new VectorLayer({
      source,
      zIndex: 930,
      updateWhileAnimating: true,
      updateWhileInteracting: true,
      style: (feature, resolution) => {
        const role = String(feature.get('role') ?? '')
        if (role === 'source') {
          return new Style({
            image: new Circle({
              radius: 10,
              fill: new Fill({ color: SOURCE }),
              stroke: new Stroke({ color: '#ffffff', width: 2 }),
            }),
            text: new Text({
              text: String(feature.get('label') ?? ''),
              offsetY: -16,
              font: '12px sans-serif',
              fill: new Fill({ color: '#0c4a6e' }),
              stroke: new Stroke({ color: '#ffffff', width: 3 }),
            }),
          })
        }
        // 관로 선(선 잇기)은 zIndex 0~2 로 그리기 순서를 나누므로,
        // 단수구역·단수 관로·제수변·도착 강조는 그보다 위(10~)에 둔다
        const lift = (styles: Style | Style[] | void, z: number) => {
          if (!styles) return styles
          for (const s of Array.isArray(styles) ? styles : [styles]) s.setZIndex(z)
          return styles
        }
        // 도착 배수지 강조 링 (순차 재생 끝에 잠깐)
        // 프로젝트 기본 선택 강조(레이더 펄스)와 동일
        if (role === 'arrive') {
          return lift(pulseStyle(feature, resolution) as Style | Style[] | void, 13)
        }

        // --- 선 잇기: 합친 선 ---
        // 테두리(0) → 하늘색(1) → 흰 대시(2) 순서로 모든 선을 층별로 그려 이음매에서 대시가 가려지지 않게 하고,
        // 대시 위상을 정수장 기준 누적 거리에 맞춰 선이 바뀌어도 대시 간격이 이어지게 한다
        if (role === 'stroke') {
          const geom = feature.getGeometry() as LineString
          const coords = geom.getCoordinates()
          const strokeLen = Number(feature.get('len') ?? 0)
          const sdRaw = feature.get('startDist') as number | undefined
          let visLen = strokeLen
          if (seqRef.current && sdRaw != null && strokeLen > 0) {
            visLen = Math.min(strokeLen, Math.max(0, frontRef.current - sdRaw))
            if (visLen <= 0) return undefined
          }
          const partial = visLen < strokeLen ? new LineString(sliceLine(coords, visLen)) : undefined
          const startPx = (sdRaw ?? 0) / resolution
          const tier = (feature.get('tier') as PipeTier | undefined) ?? 'mid'
          const look = pipeLook(map.getView().getZoomForResolution(resolution), tier)
          const zBase = PIPE_TIER_RANK[tier] * 3
          const pattern = dashPattern(resolution, dashSpacingRes)
          const period = pattern[0]! + pattern[1]!
          const styles: Style[] = pipeBaseStyles(look, partial, zBase, true)
          // 가지 관로는 축소하면 흐름 대시를 그리지 않는다 (옅은 망으로만 보이게)
          if (look.dashAlpha < 0.05 || look.dash < 0.5) return styles
          const dashColor =
            look.dashAlpha >= 0.999 ? '#ffffff' : `rgba(255, 255, 255, ${look.dashAlpha})`
          const dash = (g: LineString | undefined, fromDist: number, moving: boolean) =>
            new Style({
              geometry: g,
              zIndex: zBase + 2,
              stroke: new Stroke({
                color: dashColor,
                width: look.dash,
                lineCap: 'round',
                lineJoin: 'round',
                lineDash: pattern,
                lineDashOffset: dashPhase(
                  startPx + fromDist / resolution - (moving ? offsetRef.current : 0),
                  period
                ),
              }),
            })
          const stops = feature.get('stops') as [number, number][] | undefined
          if (!stops) {
            styles.push(dash(partial, 0, true))
          } else {
            // 단수 관로와 겹친 구간만 대시를 멈추고, 나머지는 흐르게 구간별로 나눠 그린다
            let cursor = 0
            const piece = (a: number, b: number, moving: boolean) => {
              const lo = Math.max(0, a)
              const hi = Math.min(visLen, b)
              if (hi - lo <= 0.01) return
              const c = subLine(coords, lo, hi)
              if (c.length >= 2) styles.push(dash(new LineString(c), lo, moving))
            }
            for (const [a, b] of stops) {
              piece(cursor, a, true)
              piece(a, b, false)
              cursor = b
            }
            piece(cursor, visLen, true)
          }
          return styles
        }

        // --- 기존: 관로별로 그리기 (선 잇기 끔, 비교용) ---
        if (feature.get('hiddenPipe')) return undefined

        // 순차 재생: 물이 도달한 만큼만 그린다
        const startDist = feature.get('startDist') as number | undefined
        const pipeLen = feature.get('len') as number | undefined
        let progress = 1
        if (seqRef.current && startDist != null && pipeLen && pipeLen > 0) {
          progress = Math.min(1, Math.max(0, (frontRef.current - startDist) / pipeLen))
          if (progress <= 0) return undefined
        }
        // 뻗어나가는 중인 관로는 도달한 부분만 잘라 그리고, 그 위에도 바로 흐름 대시를 올린다
        // (lineDash 로 숨기면 흐름 대시와 겹칠 수 없어 도형 자체를 잘라서 그림)
        const partialGeom =
          progress < 1
            ? new LineString(
                sliceLine(
                  (feature.getGeometry() as LineString).getCoordinates(),
                  progress * pipeLen!
                )
              )
            : undefined
        // 굵기·관경 등급은 선 잇기와 같은 기준을 써서 켬/끔 비교가 «잇기» 차이만 보이게 한다
        // (그리기 순서는 기존 방식대로 관로마다 테두리·하늘색·대시를 함께 그림)
        const pipeTierValue = (feature.get('tier') as PipeTier | undefined) ?? 'mid'
        const pl = pipeLook(map.getView().getZoomForResolution(resolution), pipeTierValue)
        const pipeDash = dashPattern(resolution, dashSpacingRes)
        const pipeStyles = pipeBaseStyles(pl, partialGeom, undefined, false)
        if (pl.dashAlpha >= 0.05 && pl.dash >= 0.5) {
          // 위: 흰색 짧은 대시가 흐름
          pipeStyles.push(
            new Style({
              geometry: partialGeom,
              stroke: new Stroke({
                color: pl.dashAlpha >= 0.999 ? '#ffffff' : `rgba(255, 255, 255, ${pl.dashAlpha})`,
                width: pl.dash,
                lineCap: 'round',
                lineDash: pipeDash,
                // 단수 관로와 겹치는 구간은 흐름 정지
                lineDashOffset: feature.get('flowStopped')
                  ? 0
                  : dashPhase(-offsetRef.current, pipeDash[0]! + pipeDash[1]!),
              }),
            })
          )
        }
        return pipeStyles
      },
    })
    layer.set('wtlSupplyPath', true)
    map.addLayer(layer)
    layerRef.current = layer

    // 비교용 렌더 시간: 지도 한 프레임(모든 레이어 준비·그리기) 시간을 1초씩 평균 내 알린다
    let frameStart = 0
    let frameSum = 0
    let frameCount = 0
    let windowStart = performance.now()
    const onPreCompose = () => {
      frameStart = performance.now()
    }
    const onPostCompose = () => {
      if (!frameStart) return
      const now = performance.now()
      frameSum += now - frameStart
      frameCount += 1
      frameStart = 0
      if (now - windowStart < 1000) return
      if (resultRef.current && frameCount > 0) {
        statsRef.current = { ...statsRef.current, frameMs: frameSum / frameCount }
        onRenderStatsRef.current?.(statsRef.current)
      }
      frameSum = 0
      frameCount = 0
      windowStart = now
    }
    map.on('precompose', onPreCompose)
    map.on('postcompose', onPostCompose)

    const tick = () => {
      const now = performance.now()
      // 탭 비활성 등으로 프레임이 크게 벌어져도 한 번에 점프하지 않게 상한
      const dt = lastTsRef.current ? Math.min(now - lastTsRef.current, 100) : 0
      lastTsRef.current = now

      let animating = false
      // 흐름 대시는 결과가 있는 동안 항상 흐른다. 속도는 줌과 상관없이 화면 기준 일정.
      // 줌에 따라 대시 간격(패턴 주기)이 바뀌므로 이동량은 한 주기로 자르지 않고 누적하고,
      // 그릴 때 그 줌의 주기로 위상을 계산한다 (큰 값은 정밀도를 위해 넉넉한 주기로 되돌림)
      if (resultRef.current) {
        offsetRef.current = (offsetRef.current + (FLOW_DASH_PX_PER_S * dt) / 1000) % 1_000_000
        animating = true
      }

      // 순차 재생: 물 도달 거리를 일정 속도로 늘린다
      if (seqRef.current && !revealDoneRef.current) {
        // 거리는 EPSG:3857 단위(위도에 따라 실제보다 길게 나옴)라 cos(위도)로 실제 m 로 환산
        const lat = resultRef.current?.source.point[1] ?? 0
        const toReal = Math.cos((lat * Math.PI) / 180)
        const speed3857 = FLOW_SPEED_M_PER_S / toReal // 3857 단위/초
        const capSpeed = (totalRef.current / MAX_REVEAL_MS) * 1000 // 상한 시간 안에 끝나는 최소 속도
        frontRef.current = Math.min(
          totalRef.current,
          frontRef.current + (Math.max(speed3857, capSpeed) * dt) / 1000
        )
        const finished = frontRef.current >= totalRef.current
        if (finished) revealDoneRef.current = true
        triggerArrivals()
        animating = true
        if (finished) onRevealDoneRef.current?.()
      }

      // 도착 배수지 펄스: 다음 재생·중지·새 분석 전까지 유지
      if (source.getFeatures().some((f) => f.get('role') === 'arrive')) {
        pulsePhaseRef.current += DATA_QUERY_SELECTION_PULSE_STEP
        animating = true
      }
      if (animating) layer.changed()
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      map.un('precompose', onPreCompose)
      map.un('postcompose', onPostCompose)
      map.removeLayer(layer)
      layerRef.current = null
    }
  }, [active, mapContext?.mapReady, mapContext?.mapInstanceRef])

  /** 정수장·배수지 마커 — 관로(930)·단수구역보다 위(945) */
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady || !active) return

    // 기존 GeoServer SLD(스타일명 = 테이블명)로 정수장·배수지를 관로 위에 다시 그림
    // (면 도형 등 실제 형상. 제수변 열림/잠금 오버레이 위 표시는 아래 DOM 오버레이가 담당)
    const wms = new ImageLayer({
      zIndex: 944,
      source: new ImageWMS({
        url: `${getGeoServerBase()}/${WMS_WORKSPACE}/wms`,
        params: {
          LAYERS: FACILITY_WMS_LAYERS.join(','),
          STYLES: FACILITY_WMS_LAYERS.join(','),
          TRANSPARENT: true,
          EXCEPTIONS: 'application/vnd.ogc.se_xml',
        },
        serverType: 'geoserver',
        ratio: 1.5,
        imageLoadFunction: geoserverWmsImageLoadFunction,
        crossOrigin: 'anonymous',
      }),
    })
    wms.set('wtlSupplyFacilityWms', true)
    map.addLayer(wms)
    return () => {
      map.removeLayer(wms)
    }
  }, [active, mapContext?.mapReady, mapContext?.mapInstanceRef])

  /** 송수 관로·시설 표시 */
  useEffect(() => {
    const layer = layerRef.current
    const source = layer?.getSource()
    const map = mapContext?.mapInstanceRef?.current
    if (!source || !map) return

    source.clear()
    offsetRef.current = 0

    if (!result) {
      seqRef.current = false
      revealDoneRef.current = true
      arrivedRef.current.clear()
      destDistRef.current = new Map()
      layer?.changed()
      return
    }

    // 출발 시설 마커는 관로 위 별도 레이어(facilityLayer)에서 그림
    const center = to3857(result.source.point)

    // 관로별 feature 는 계산 기준으로 만들어 두고, 지도에 넣는 건 아래 renderLines() 가 맡는다
    // (선 잇기를 켜면 관로 대신 합친 선을 넣는다)
    const pipeFeatures: (Feature | undefined)[] = []
    for (let i = 0; i < result.pipes.length; i++) {
      const line = result.pipes[i]!
      if (line.length < 2) continue
      const f = new Feature({ geometry: new LineString(line.map(to3857)) })
      f.setId(`supply-pipe-${i}`)
      f.set('role', 'pipe')
      f.set('tier', pipeTier(result.pipeDiameters?.[i]))
      pipeFeatures[i] = f
    }
    pipeFeaturesRef.current = pipeFeatures
    destPipeIdxRef.current = new Set()

    // 순차 재생 준비: 관로별 길이와 시설 기준 시작 거리(누적)를 계산
    const parents = result.parentIndex
    seqRef.current = Boolean(parents && parents.length > 0)
    destDistRef.current = new Map()
    totalRef.current = 0
    if (seqRef.current && parents) {
      const lenOf = (i: number) =>
        (pipeFeatures[i]?.getGeometry() as LineString | undefined)?.getLength() ?? 0
      const startDist: (number | undefined)[] = []
      for (let i = 0; i < parents.length; i++) {
        // 이미 계산된 조상을 만날 때까지 거슬러 올라간 뒤, 위에서부터 누적
        const chain: number[] = []
        let j: number | null = i
        while (j != null && startDist[j] === undefined && chain.length < 100000) {
          chain.push(j)
          const next: number | null | undefined = parents[j]
          j = next == null || next === j ? null : next
        }
        let acc = 0
        if (j != null && startDist[j] !== undefined) {
          acc = startDist[j]! + lenOf(j)
        } else {
          // 상류가 없는 관로(시설에서 바로 시작): 시설에서 시작점까지의 직선거리만큼 늦게 도달.
          // (상류 정보가 잘못돼도 먼 관로가 처음부터 그려지지 않게 하는 안전장치)
          const top = chain[chain.length - 1]!
          const first = (pipeFeatures[top]?.getGeometry() as LineString | undefined)?.getFirstCoordinate()
          if (first) acc = Math.hypot(first[0]! - center[0], first[1]! - center[1])
        }
        for (let k = chain.length - 1; k >= 0; k--) {
          const idx = chain[k]!
          startDist[idx] = acc
          acc += lenOf(idx)
        }
      }
      for (let i = 0; i < parents.length; i++) {
        const f = pipeFeatures[i]
        if (!f) continue
        const len = lenOf(i)
        f.set('len', len)
        f.set('startDist', startDist[i] ?? 0)
        totalRef.current = Math.max(totalRef.current, (startDist[i] ?? 0) + len)
      }
      if (totalRef.current <= 0) seqRef.current = false

      // 도착 배수지: 그 배수지에 가장 가까운 관로 끝점에 물이 닿는 누적 거리
      for (const d of result.destinations ?? []) {
        const dp = to3857(d.point)
        let bestD = Number.POSITIVE_INFINITY
        let bestIdx = -1
        let reach = totalRef.current // 끝점을 못 찾으면 재생이 끝날 때 강조
        for (let i = 0; i < parents.length; i++) {
          const geom = pipeFeatures[i]?.getGeometry() as LineString | undefined
          if (!geom) continue
          const end = geom.getLastCoordinate()
          const dd = Math.hypot(end[0]! - dp[0], end[1]! - dp[1])
          if (dd < bestD) {
            bestD = dd
            bestIdx = i
            reach = (startDist[i] ?? 0) + lenOf(i)
          }
        }
        destDistRef.current.set(d.id, reach)
        if (bestIdx >= 0) destPipeIdxRef.current.add(bestIdx)
      }
    }

    // 결과 범위(관로 전체 + 출발 시설 + 도착 배수지)에 맞춰 지도를 맞춘다.
    // 왼쪽 패널 폭을 반영하는 공용 함수를 써서 경로가 패널에 가려지지 않게 하고,
    // 아주 작은 경로가 지나치게 확대되지 않게 최대 줌을 제한한다
    const fitExtent = createEmptyExtent()
    for (const f of pipeFeatures) {
      const g = f?.getGeometry()
      if (g) extendExtent(fitExtent, g.getExtent())
    }
    extendCoordinate(fitExtent, center)
    for (const d of result.destinations ?? []) extendCoordinate(fitExtent, to3857(d.point))
    if (isEmptyExtent(fitExtent)) {
      map.getView().animate({ center, zoom: VIEW_ZOOM, duration: 450 })
    } else {
      scheduleFitMapToExtent3857(map, fitExtent, {
        maxZoom: FIT_MAX_ZOOM,
        duration: 450,
        fitPadding: [60, 60, 60, 60],
        applyMapViewPadding: mapContext?.applyMapViewPaddingRef?.current,
      })
    }
    renderLines()
    // 새 분석 결과는 전체 경로를 한 번에 표시 (재생은 버튼을 눌렀을 때만)
    showFull()
  }, [result, mapContext?.mapInstanceRef])

  // 선 잇기 켬/끔 전환: 계산은 그대로 두고 지도에 그리는 선만 바꾼다 (재생 중이어도 이어서 진행)
  useEffect(() => {
    if (!resultRef.current) return
    renderLines()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergeLines])

  // 관로 숨김: 관로별로 그릴 때만 적용 (선 잇기 중에는 합친 선이라 개별 숨김을 적용하지 않음.
  // 패널에서 지금은 항상 빈 목록으로 넘긴다)
  useEffect(() => {
    const hidden = new Set(hiddenPipeIndexes)
    pipeFeaturesRef.current.forEach((feature, index) => {
      feature?.set('hiddenPipe', hidden.has(index))
    })
    layerRef.current?.changed()
  }, [hiddenPipeIndexes, result])

  // 중지: 재생이 끝나기 전에 revealing 이 꺼지면 전체 보기로 돌아간다.
  // (자연 종료는 revealDone 이 이미 true 라 건드리지 않아 도착 펄스가 유지된다)
  useEffect(() => {
    if (!revealing && !revealDoneRef.current) showFull()
  }, [revealing])

  // 경로 재생: 흐름 대시 위치를 0으로, 물 도달을 시설에서부터 처음부터
  useEffect(() => {
    if (replayToken === 0) return
    offsetRef.current = 0
    startReveal()
  }, [replayToken])
}
