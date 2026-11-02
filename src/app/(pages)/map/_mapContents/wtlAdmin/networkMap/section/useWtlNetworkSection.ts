'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Feature from 'ol/Feature'
import LineString from 'ol/geom/LineString'
import Point from 'ol/geom/Point'
import Polygon from 'ol/geom/Polygon'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style'
import { transform } from 'ol/proj'
import type { FeatureLike } from 'ol/Feature'
import { call } from '@/lib/api'
import { useMapContext } from '../../../../_mapComponents/MapContext'
import { canStartMapDrawInteraction } from '../../../../_mapComponents/mapDrawInteraction'
import {
  isWtlLineLayerKind,
  isWtlPointLayerKind,
} from '@/lib/wtlLayerShapeDefs'
import {
  getWtlNetLayerDef,
  type WtlNetLayerKey,
} from '../wtlNetworkLayerCatalog'
import {
  distToLineM,
  lineLengthM,
  parseLineWkt5181,
  pipeCutIntersect3857,
  pipeSpanAlongLineM,
  projectDistAlongLineM,
  sectionCutRectRing3857,
  type Pt3857,
} from './wtlNetworkSectionGeom'
import type {
  SectionFeatureMark,
  SectionGroundPt,
  SectionSupplyAreaLine,
} from './wtlNetworkSectionSvg'

export type SectionTab = 'cross' | 'long' | 'prev' | 'threejs'

/** 단면도 절단선 — 우측 «거리 측정»(#3388ff)과 동일 */
const SECTION_CUT_LINE_STROKE = new Style({
  stroke: new Stroke({ color: '#3388ff', width: 2 }),
})
const SECTION_CUT_VERTEX = new CircleStyle({
  radius: 5,
  fill: new Fill({ color: '#3388ff' }),
  stroke: new Stroke({ color: '#fff', width: 2 }),
})

function sectionCutLineStyle(feature: FeatureLike): Style[] {
  const geom = feature.getGeometry()
  const styles: Style[] = [SECTION_CUT_LINE_STROKE]
  if (geom instanceof LineString) {
    for (const c of geom.getCoordinates()) {
      styles.push(
        new Style({
          geometry: new Point(c),
          image: SECTION_CUT_VERTEX,
        })
      )
    }
  }
  return styles
}

/** ThreeJs 단면도 지형 깊이(m) — groundSection SECTION_DEFAULT_HALF_WIDTH_M 과 동일 */
const SECTION_RECT_HALF_WIDTH_M = 5
/** 절단선 밑변 × 깊이 사각형 — ThreeJs 지형 격자와 동일 범위 */
const SECTION_RECT_STROKE = new Style({
  stroke: new Stroke({ color: '#22c55e', width: 2 }),
  fill: new Fill({ color: 'rgba(34, 197, 94, 0.08)' }),
})

type PipeRow = {
  id: string
  label?: string
  saaCde?: string
  color?: string
  coords3857: [number, number][]
  diameterM: number
  depthM: number
  surfaceElevM?: number
}

type PointRow = {
  id: string
  label?: string
  color?: string
  x3857: number
  y3857: number
  diameterM: number
  depthM: number
  surfaceElevM?: number
}

export type SectionSupplyAreas = {
  zoneName: string | null
  subzoneName: string | null
  blockName: string | null
}

type SectionApi = {
  success?: boolean
  ground?: { distM: number; elevM: number; x3857: number; y3857: number }[]
  totalLengthM?: number
  pipes?: PipeRow[]
  points?: PointRow[]
  supplyAreas?: SectionSupplyAreas
  error?: string
}

const EMPTY_SUPPLY_AREAS: SectionSupplyAreas = {
  zoneName: null,
  subzoneName: null,
  blockName: null,
}

function groundAtDist(ground: SectionGroundPt[], distM: number): number | null {
  if (!ground.length) return null
  if (distM <= ground[0]!.distM) return ground[0]!.elevM
  const last = ground[ground.length - 1]!
  if (distM >= last.distM) return last.elevM
  for (let i = 1; i < ground.length; i++) {
    const a = ground[i - 1]!
    const b = ground[i]!
    if (distM <= b.distM) {
      const t = (distM - a.distM) / Math.max(1e-6, b.distM - a.distM)
      return a.elevM + (b.elevM - a.elevM) * t
    }
  }
  return last.elevM
}

function resolveTables(enabledKeys: Iterable<string>) {
  const lineTables = new Set<string>()
  const pointTables = new Set<string>()
  const supplyAreaTables = new Set<string>()
  for (const key of enabledKeys) {
    const def = getWtlNetLayerDef(key as WtlNetLayerKey)
    if (!def?.table) continue
    if (def.geomKind === 'line' && isWtlLineLayerKind(def.table)) {
      lineTables.add(def.table)
    } else if (def.geomKind === 'point' && isWtlPointLayerKind(def.table)) {
      pointTables.add(def.table)
    } else if (def.geomKind === 'area') {
      const t = def.table.toLowerCase()
      if (
        t === 'wtl_wtsa_as' ||
        t.endsWith('_wtl_wtsa_as') ||
        t === 'wtl_wtssa_as' ||
        t.endsWith('_wtl_wtssa_as') ||
        t === 'wtl_wtsba_as' ||
        t.endsWith('_wtl_wtsba_as')
      ) {
        supplyAreaTables.add(def.table)
      }
    }
  }
  return {
    lineTables: [...lineTables],
    pointTables: [...pointTables],
    supplyAreaTables: [...supplyAreaTables],
  }
}

/** 켜진 급수구역·분구·블록만 횡단 좌측 표기 줄로 */
export function buildSupplyAreaLines(
  areas: SectionSupplyAreas | null | undefined,
  enabledKeys: Iterable<string>
): SectionSupplyAreaLine[] {
  const keys = new Set(
    [...enabledKeys].map((k) => String(k).trim().toLowerCase()).filter(Boolean)
  )
  const has = (base: string) =>
    keys.has(base) || [...keys].some((k) => k === base || k.endsWith(`_${base}`))
  const lines: SectionSupplyAreaLine[] = []
  if (has('wtl_wtsa_as')) {
    lines.push({ label: '급수구역', name: areas?.zoneName?.trim() || '—' })
  }
  if (has('wtl_wtssa_as')) {
    lines.push({ label: '급수분구', name: areas?.subzoneName?.trim() || '—' })
  }
  if (has('wtl_wtsba_as')) {
    lines.push({ label: '급수블록', name: areas?.blockName?.trim() || '—' })
  }
  return lines
}

function pipeTableOf(pipe: PipeRow): string {
  // getWtlLineLayerInExtent: `{table}-{n}` / getWtlPipesInExtent: `pipe-{n}`
  if (pipe.id.startsWith('pipe-')) return 'wtl_pipe_lm'
  const m = /^(wtl_[a-z0-9_]+)-\d+$/i.exec(pipe.id)
  return m?.[1]?.toLowerCase() ?? 'wtl_pipe_lm'
}

const LAYER_KOR: Record<string, string> = {
  wtl_pipe_lm_saa003: '송수관로',
  wtl_pipe_lm_saa004: '배수관로',
  wtl_pipe_lm_etc: '상수관로(기타)',
  wtl_pipe_lm: '상수관로',
  wtl_sply_ls: '급수관로',
  wtl_manh_ps: '상수맨홀',
  wtl_valv_ps: '변류시설',
  wtl_fire_ps: '소방시설',
  wtl_flow_ps: '유량계',
  wtl_prga_ps: '수압계',
  wtl_meta_ps: '급수전계량기',
  wtl_leak_ps: '누수지점 및 복구내역',
}

/** 선택 레이어 키·한글명 (관망조회 켜진 키만) */
function resolvePipeLayerMeta(
  table: string,
  saaCde: string | undefined,
  enabledKeys: Set<string>
): { key: string; kor: string } | null {
  if (table === 'wtl_pipe_lm') {
    const code = String(saaCde ?? '').toUpperCase()
    if (code === 'SAA003') {
      if (!enabledKeys.has('wtl_pipe_lm_saa003')) return null
      return { key: 'wtl_pipe_lm_saa003', kor: LAYER_KOR.wtl_pipe_lm_saa003! }
    }
    if (code === 'SAA004') {
      if (!enabledKeys.has('wtl_pipe_lm_saa004')) return null
      return { key: 'wtl_pipe_lm_saa004', kor: LAYER_KOR.wtl_pipe_lm_saa004! }
    }
    if (!enabledKeys.has('wtl_pipe_lm_etc')) return null
    return { key: 'wtl_pipe_lm_etc', kor: LAYER_KOR.wtl_pipe_lm_etc! }
  }
  const keyHit = [...enabledKeys].find((k) => {
    const def = getWtlNetLayerDef(k as WtlNetLayerKey)
    return def?.table === table || k === table
  })
  if (!keyHit) return null
  return { key: keyHit, kor: LAYER_KOR[keyHit] || LAYER_KOR[table] || keyHit }
}

function buildFeatures(
  mode: SectionTab,
  line3857: Pt3857[],
  ground: SectionGroundPt[],
  pipes: PipeRow[],
  points: PointRow[],
  enabledKeys: Set<string>
): SectionFeatureMark[] {
  const out: SectionFeatureMark[] = []
  const enabledTables = new Set<string>()
  for (const key of enabledKeys) {
    const def = getWtlNetLayerDef(key as WtlNetLayerKey)
    if (def?.table) enabledTables.add(def.table)
  }

  for (const pipe of pipes) {
    const table = pipeTableOf(pipe)
    if (!enabledTables.has(table)) continue
    const meta = resolvePipeLayerMeta(table, pipe.saaCde, enabledKeys)
    if (!meta) continue

    const label = String(pipe.label ?? '').trim() || `${Math.round(pipe.diameterM * 1000)}mm`
    const depthM = Number.isFinite(pipe.depthM) ? pipe.depthM : 0

    if (mode === 'cross' || mode === 'prev') {
      // 횡단·기존: 절단선 교차 관만
      const cut = pipeCutIntersect3857(line3857, pipe.coords3857)
      if (!cut) continue
      let surface = pipe.surfaceElevM
      if (surface == null) surface = groundAtDist(ground, cut.distM) ?? undefined
      out.push({
        id: `pipe:${pipe.id}:${cut.distM.toFixed(2)}`,
        distM: cut.distM,
        depthM,
        diameterM: pipe.diameterM,
        label,
        layerKorName: meta.kor,
        color: pipe.color || '#7A7A7A',
        kind: 'pipe',
        surfaceElevM: surface,
      })
      continue
    }

    // 종단: 버퍼 안 관 → 거리 구간(측면)
    const span = pipeSpanAlongLineM(line3857, pipe.coords3857)
    if (!span) continue
    let surface = pipe.surfaceElevM
    if (surface == null) surface = groundAtDist(ground, span.midM) ?? undefined
    out.push({
      id: `pipe:${pipe.id}:${span.midM.toFixed(2)}`,
      distM: span.midM,
      spanFromM: span.fromM,
      spanToM: span.toM,
      depthM,
      diameterM: pipe.diameterM,
      label,
      layerKorName: meta.kor,
      color: pipe.color || '#7A7A7A',
      kind: 'pipe',
      surfaceElevM: surface,
    })
  }

  for (const pt of points) {
    const table = pt.id.replace(/-\d+$/, '').toLowerCase()
    if (table && !enabledTables.has(table)) continue
    if (!enabledKeys.has(table) && ![...enabledKeys].some((k) => getWtlNetLayerDef(k as WtlNetLayerKey)?.table === table)) {
      continue
    }
    if ((mode === 'cross' || mode === 'prev') && distToLineM(line3857, pt.x3857, pt.y3857) > 2) {
      continue
    }

    const distM = projectDistAlongLineM(line3857, pt.x3857, pt.y3857)
    // 관로가 아닌 점형(변류·맨홀 등)은 단면 지표에 둔다.
    // API surfaceElevM(IDW)이 등고와 어긋나면 심도처럼 깊게 보이므로 절단선 등고만 사용.
    const surface = groundAtDist(ground, distM) ?? undefined
    out.push({
      id: `pt:${pt.id}`,
      distM,
      depthM: 0,
      diameterM: Math.max(0.05, Math.min(0.4, pt.diameterM)),
      label: String(pt.label ?? '').trim() || table,
      layerKorName: LAYER_KOR[table] || table,
      color: pt.color || '#7A7A7A',
      kind: 'point',
      surfaceElevM: surface,
    })
  }

  return out
}

export function useWtlNetworkSection(enabledLayerKeys: string[]) {
  const mapContext = useMapContext()
  const [drawing, setDrawing] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [tab, setTab] = useState<SectionTab>('cross')
  const [line3857, setLine3857] = useState<Pt3857[] | null>(null)
  const [ground, setGround] = useState<SectionGroundPt[]>([])
  const [features, setFeatures] = useState<SectionFeatureMark[]>([])
  const [supplyAreasRaw, setSupplyAreasRaw] = useState<SectionSupplyAreas>(EMPTY_SUPPLY_AREAS)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [totalLengthM, setTotalLengthM] = useState(0)
  const rawRef = useRef<{ pipes: PipeRow[]; points: PointRow[] }>({ pipes: [], points: [] })
  const keysRef = useRef(enabledLayerKeys)
  keysRef.current = enabledLayerKeys
  const tabRef = useRef(tab)
  tabRef.current = tab
  const cutLineSourceRef = useRef<VectorSource | null>(null)
  const sectionRectSourceRef = useRef<VectorSource | null>(null)

  const supplyAreaLines = useMemo(
    () => buildSupplyAreaLines(supplyAreasRaw, enabledLayerKeys),
    [supplyAreasRaw, enabledLayerKeys]
  )

  const setSpatialDrawRequest = mapContext?.setSpatialDrawRequest

  /** 그린 절단선 + 지형 사각형(초록 테두리)을 지도에 유지 */
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (!map || !mapContext?.mapReady) return
    const cutSource = new VectorSource()
    const cutLayer = new VectorLayer({
      source: cutSource,
      style: sectionCutLineStyle,
      zIndex: 930,
    })
    cutLayer.set('wtlNetworkSectionCutLine', true)
    cutLayer.set('mapSplitNoMirror', true)
    map.addLayer(cutLayer)
    cutLineSourceRef.current = cutSource

    const rectSource = new VectorSource()
    const rectLayer = new VectorLayer({
      source: rectSource,
      style: SECTION_RECT_STROKE,
      zIndex: 925,
    })
    rectLayer.set('wtlNetworkSectionRect', true)
    rectLayer.set('mapSplitNoMirror', true)
    map.addLayer(rectLayer)
    sectionRectSourceRef.current = rectSource

    return () => {
      map.removeLayer(cutLayer)
      map.removeLayer(rectLayer)
      cutLineSourceRef.current = null
      sectionRectSourceRef.current = null
    }
  }, [mapContext?.mapInstanceRef, mapContext?.mapReady])

  useEffect(() => {
    const cutSource = cutLineSourceRef.current
    const rectSource = sectionRectSourceRef.current
    if (!cutSource || !rectSource) return
    cutSource.clear()
    rectSource.clear()
    if (!line3857 || line3857.length < 2) return
    cutSource.addFeature(new Feature({ geometry: new LineString(line3857) }))

    const start = line3857[0]!
    const end = line3857[line3857.length - 1]!
    const ring = sectionCutRectRing3857(start, end, SECTION_RECT_HALF_WIDTH_M)
    rectSource.addFeature(new Feature({ geometry: new Polygon([ring]) }))
  }, [line3857, mapContext?.mapReady])

  const cancelDraw = useCallback(() => {
    setDrawing(false)
    setSpatialDrawRequest?.(null)
  }, [setSpatialDrawRequest])

  const closePanel = useCallback(() => {
    setPanelOpen(false)
    setLine3857(null)
    setGround([])
    setFeatures([])
    setSupplyAreasRaw(EMPTY_SUPPLY_AREAS)
    setError('')
    setDrawing(false)
    setSpatialDrawRequest?.(null)
  }, [setSpatialDrawRequest])

  const loadSection = useCallback(
    async (coords: Pt3857[], halfWidthM: number) => {
      setLoading(true)
      setError('')
      try {
        const { lineTables, pointTables, supplyAreaTables } = resolveTables(
          keysRef.current
        )
        const res = await call('', 'POST', {
          service: 'elevationService',
          action: 'getWtlNetworkSectionData',
          params: {
            coords3857: coords,
            halfWidthM,
            sampleCount: 28,
            lineTables,
            pointTables,
            supplyAreaTables,
          },
        })
        const data = (res?.data ?? res) as SectionApi
        if (!data?.success) {
          setError(data?.error ?? '단면도 조회 실패')
          setGround([])
          setFeatures([])
          setSupplyAreasRaw(EMPTY_SUPPLY_AREAS)
          return
        }
        const g: SectionGroundPt[] = (data.ground ?? [])
          .filter((p) => Number.isFinite(p.elevM))
          .map((p) => ({ distM: p.distM, elevM: p.elevM }))
        rawRef.current = {
          pipes: data.pipes ?? [],
          points: data.points ?? [],
        }
        setSupplyAreasRaw(data.supplyAreas ?? EMPTY_SUPPLY_AREAS)
        setGround(g)
        setTotalLengthM(
          Number(data.totalLengthM) ||
            g[g.length - 1]?.distM ||
            lineLengthM(coords) ||
            0
        )
        setFeatures(
          buildFeatures(
            tabRef.current,
            coords,
            g,
            rawRef.current.pipes,
            rawRef.current.points,
            new Set(keysRef.current)
          )
        )
      } catch (e) {
        setError(e instanceof Error ? e.message : '단면도 조회 오류')
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const rebuildFeatures = useCallback(
    (mode: SectionTab, coords: Pt3857[], g: SectionGroundPt[]) => {
      setFeatures(
        buildFeatures(
          mode,
          coords,
          g,
          rawRef.current.pipes,
          rawRef.current.points,
          new Set(keysRef.current)
        )
      )
    },
    []
  )

  // 켜진 레이어만 바뀌면 표시 재필터 (버퍼 재조회는 탭/다시그리기)
  useEffect(() => {
    if (!line3857 || !ground.length) return
    rebuildFeatures(tab, line3857, ground)
  }, [enabledLayerKeys, line3857, ground, tab, rebuildFeatures])

  /**
   * 구역설정(polygon)과 동일 — spatialDrawRequest → useSpatialDrawOnMap.
   * 모달은 라인 완료 후에만 연다.
   */
  const beginLineDraw = useCallback(() => {
    if (!setSpatialDrawRequest) return
    if (!canStartMapDrawInteraction(mapContext, 'spatialSearch')) return

    setError('')
    setGround([])
    setFeatures([])
    setLine3857(null)
    setPanelOpen(false)
    setDrawing(true)

    setSpatialDrawRequest({
      // 구역설정과 동일 spatialDrawRequest 경로 · 두 점 직선(LineString maxPoints:2)
      type: 'line',
      onComplete: (wkt5181: string) => {
        const w = String(wkt5181 ?? '').trim()
        setDrawing(false)
        if (!w) return
        const pts5181 = parseLineWkt5181(w)
        if (pts5181.length < 2) {
          setError('라인을 두 점 이상 그려 주세요')
          setPanelOpen(true)
          return
        }
        const coords3857: Pt3857[] = pts5181.map((p) => {
          const [x, y] = transform(p, 'EPSG:5181', 'EPSG:3857')
          return [x, y]
        })
        setLine3857(coords3857)
        setPanelOpen(true)
        const half = tabRef.current === 'long' ? 8 : 3
        void loadSection(coords3857, half)
      },
    })
  }, [mapContext, setSpatialDrawRequest, loadSection])

  /** 도구 버튼 — 그리는 중이면 취소, 아니면 라인 그리기 시작(모달은 완료 후) */
  const startSection = useCallback(() => {
    if (drawing) {
      setDrawing(false)
      setSpatialDrawRequest?.(null)
      return
    }
    // 패널이 열린 채로 다시 누르면 패널 닫고 재그리기
    if (panelOpen) {
      setPanelOpen(false)
      setLine3857(null)
      setGround([])
      setFeatures([])
      setSupplyAreasRaw(EMPTY_SUPPLY_AREAS)
      setError('')
    }
    beginLineDraw()
  }, [drawing, panelOpen, setSpatialDrawRequest, beginLineDraw])

  /** 패널 «다시 그리기» — 모달 닫고 라인부터 다시 */
  const redrawSection = useCallback(() => {
    setPanelOpen(false)
    setLine3857(null)
    setGround([])
    setFeatures([])
    setSupplyAreasRaw(EMPTY_SUPPLY_AREAS)
    setError('')
    setDrawing(false)
    setSpatialDrawRequest?.(null)
    beginLineDraw()
  }, [setSpatialDrawRequest, beginLineDraw])

  /** 급수구역·분구·블록 레이어 ON/OFF 시 위치 명칭 재조회 */
  const supplyAreaKeysSig = useMemo(
    () => resolveTables(enabledLayerKeys).supplyAreaTables.slice().sort().join('\u0001'),
    [enabledLayerKeys]
  )
  const supplyAreaKeysSigRef = useRef(supplyAreaKeysSig)
  useEffect(() => {
    if (supplyAreaKeysSigRef.current === supplyAreaKeysSig) return
    supplyAreaKeysSigRef.current = supplyAreaKeysSig
    if (!line3857 || line3857.length < 2) return
    void loadSection(line3857, tab === 'long' ? 8 : 3)
  }, [supplyAreaKeysSig, line3857, tab, loadSection])

  const setTabAndReload = useCallback(
    (next: SectionTab) => {
      setTab(next)
      if (!line3857) return
      // ThreeJs 탭은 자체 지형·레이어 조회 — 기존 단면 재조회 생략
      if (next === 'threejs') {
        rebuildFeatures('cross', line3857, ground)
        return
      }
      void loadSection(line3857, next === 'long' ? 8 : 3)
    },
    [line3857, loadSection, rebuildFeatures, ground]
  )

  const lineLonLat = useMemo((): [number, number][] | null => {
    if (!line3857 || line3857.length < 2) return null
    return line3857.map(([x, y]) => {
      const [lon, lat] = transform([x, y], 'EPSG:3857', 'EPSG:4326')
      return [lon, lat] as [number, number]
    })
  }, [line3857])

  return {
    drawing,
    panelOpen,
    tab,
    setTab: setTabAndReload,
    ground,
    features,
    supplyAreaLines,
    loading,
    error,
    totalLengthM,
    lineLonLat,
    line3857,
    enabledKeys: enabledLayerKeys,
    lineReady: line3857 != null && line3857.length >= 2,
    startSection,
    redrawSection,
    closePanel,
    cancelDraw,
  }
}
