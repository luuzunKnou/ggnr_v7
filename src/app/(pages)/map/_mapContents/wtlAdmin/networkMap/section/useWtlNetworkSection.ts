'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SpatialDrawSketchControl } from '../../../../_mapComponents/hooks/useSpatialDrawOnMap'
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
  pipeSpanAlongDepthM,
  projectDistAlongDepthM,
  projectDistAlongLineM,
  sectionCutRectRing3857,
  type Pt3857,
} from './wtlNetworkSectionGeom'
import type {
  SectionFeatureMark,
  SectionGroundPt,
  SectionSupplyAreaLine,
} from './wtlNetworkSectionSvg'
import {
  useWtlSectionRoadPreview,
  type SectionRoadPreviewTable,
} from './useWtlSectionRoadPreview'
import { useWtlSectionRoadChordPick } from './useWtlSectionRoadChordPick'

export type SectionTab = 'cross' | 'long' | 'crossChart' | 'longChart' | 'threejs'

/** 단면도 절단선 그리기 방식 */
export type SectionDrawMode = 'free' | 'roadWidth' | 'roadSeg'

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

/** ThreeJs 단면도 지형: 절단선 수직 ±2.5m — groundSection 과 동일 */
const SECTION_RECT_HALF_WIDTH_M = 2.5
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
  styleCode?: string
  fieldsTable?: string
}

export type SectionSupplyAreas = {
  zoneName: string | null
  subzoneName: string | null
  blockName: string | null
}

export type SectionSupplyBandSegment = {
  role: 'zone' | 'subzone' | 'block'
  name: string
  fromM: number
  toM: number
  color: string
}

export type SectionSupplyElevRow = {
  elevM: number
  role: 'zone' | 'subzone' | 'block'
  segs: { name: string; color: string; pct: number }[]
}

type SectionApi = {
  success?: boolean
  ground?: { distM: number; elevM: number; x3857: number; y3857: number }[]
  groundMin?: { distM: number; elevM: number; x3857: number; y3857: number }[]
  groundMax?: { distM: number; elevM: number; x3857: number; y3857: number }[]
  totalLengthM?: number
  pipes?: PipeRow[]
  points?: PointRow[]
  supplyAreas?: SectionSupplyAreas
  supplyAreaBands?: SectionSupplyBandSegment[]
  supplyElevComposition?: SectionSupplyElevRow[]
  error?: string
}

/** 종단 깊이축 halfWidth — ThreeJs 사각형과 동일 */
const LONG_HALF_WIDTH_M = SECTION_RECT_HALF_WIDTH_M
/** 횡단·기존 시설 버퍼 */
const CROSS_HALF_WIDTH_M = 3

function isLongProfileTab(tab: SectionTab): boolean {
  return tab === 'long' || tab === 'longChart'
}

function halfWidthForTab(tab: SectionTab): number {
  return isLongProfileTab(tab) ? LONG_HALF_WIDTH_M : CROSS_HALF_WIDTH_M
}

function profileAxisForTab(tab: SectionTab): 'along' | 'depth' {
  return isLongProfileTab(tab) ? 'depth' : 'along'
}

type SectionAxisCache = {
  ground: SectionGroundPt[]
  groundMin: SectionGroundPt[]
  groundMax: SectionGroundPt[]
  totalLengthM: number
  supplyAreasRaw: SectionSupplyAreas
  supplyAreaBands: SectionSupplyBandSegment[]
  supplyElevComposition: SectionSupplyElevRow[]
  pipes: PipeRow[]
  points: PointRow[]
}

function axisCacheKey(tab: SectionTab): 'cross' | 'long' {
  return isLongProfileTab(tab) ? 'long' : 'cross'
}

function mapGroundPts(
  rows: { distM: number; elevM: number }[] | undefined
): SectionGroundPt[] {
  return (rows ?? [])
    .filter((p) => Number.isFinite(p.elevM))
    .map((p) => ({ distM: p.distM, elevM: p.elevM }))
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
  wtl_pres_ps: '가압장',
  wtl_gain_ps: '취수장',
  wtl_serv_ps: '배수지',
  wtl_rsrv_ps: '저수조',
  wtl_pipe_ps: '상수관로 심도',
}

function pointTableOf(pt: PointRow): string {
  const fromFields = String(pt.fieldsTable ?? '')
    .trim()
    .toLowerCase()
  if (fromFields) return fromFields
  const prefix = pt.id.replace(/-\d+$/, '').toLowerCase()
  if (prefix === 'manh') return 'wtl_manh_ps'
  return prefix
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

    const crossLike = mode === 'cross' || mode === 'crossChart'
    if (crossLike) {
      // 횡단·차트횡단·기존: 절단선 교차 관만
      const cut = pipeCutIntersect3857(line3857, pipe.coords3857)
      if (!cut) continue
      // 관 중점 IDW(surfaceElevM) 금지 — 절단선 등고만 사용(점시설·CAD와 동일).
      // 중점 지표가 교차점 등고보다 높으면 심도를 빼도 지형선 위에 뜸.
      const surface = groundAtDist(ground, cut.distM) ?? undefined
      // 범례·GeoServer 스타일: 부모(wtl_pipe_lm)가 아니라 define_table_name(meta.key)
      const styleLayerKey =
        getWtlNetLayerDef(meta.key as WtlNetLayerKey)?.defineTable ?? meta.key
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
        layerKey: styleLayerKey,
      })
      continue
    }

    // 종단·차트종단: 사각형 안 관 → 깊이축(옆면) 구간
    const span = pipeSpanAlongDepthM(line3857, pipe.coords3857, LONG_HALF_WIDTH_M)
    if (!span) continue
    // 종단 도면도 깊이축 등고 기준(중점 IDW 미사용)
    const surface = groundAtDist(ground, span.midM) ?? undefined
    const styleLayerKey =
      getWtlNetLayerDef(meta.key as WtlNetLayerKey)?.defineTable ?? meta.key
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
      layerKey: styleLayerKey,
    })
  }

  for (const pt of points) {
    const table = pointTableOf(pt)
    if (table && !enabledTables.has(table)) continue
    if (
      !enabledKeys.has(table) &&
      ![...enabledKeys].some(
        (k) => getWtlNetLayerDef(k as WtlNetLayerKey)?.table === table
      )
    ) {
      continue
    }
    const crossLike = mode === 'cross' || mode === 'crossChart'
    if (crossLike && distToLineM(line3857, pt.x3857, pt.y3857) > 2) {
      continue
    }

    let distM: number
    if (isLongProfileTab(mode)) {
      const d = projectDistAlongDepthM(line3857, pt.x3857, pt.y3857, LONG_HALF_WIDTH_M)
      if (d == null) continue
      distM = d
    } else {
      distM = projectDistAlongLineM(line3857, pt.x3857, pt.y3857)
    }
    // 관로가 아닌 점형(변류·맨홀 등)은 단면 지표에 둔다.
    // API surfaceElevM(IDW)이 등고와 어긋나면 심도처럼 깊게 보이므로 절단선 등고만 사용.
    const surface = groundAtDist(ground, distM) ?? undefined
    const keyHit =
      [...enabledKeys].find((k) => {
        const def = getWtlNetLayerDef(k as WtlNetLayerKey)
        return def?.table === table || k === table
      }) ?? table
    const styleLayerKey =
      getWtlNetLayerDef(keyHit as WtlNetLayerKey)?.defineTable ?? keyHit
    out.push({
      id: `pt:${pt.id}`,
      distM,
      depthM: 0,
      diameterM: Math.max(0.05, Math.min(0.4, pt.diameterM)),
      label: String(pt.label ?? '').trim() || table,
      layerKorName: LAYER_KOR[keyHit] || LAYER_KOR[table] || table,
      color: pt.color || '#7A7A7A',
      kind: 'point',
      surfaceElevM: surface,
      styleCode: pt.styleCode
        ? String(pt.styleCode).trim().toUpperCase()
        : undefined,
      layerKey: styleLayerKey,
    })
  }

  return out
}

export function useWtlNetworkSection(enabledLayerKeys: string[]) {
  const mapContext = useMapContext()
  const [drawing, setDrawing] = useState(false)
  const [modePickerOpen, setModePickerOpen] = useState(false)
  const [drawMode, setDrawMode] = useState<SectionDrawMode | null>(null)
  const [guideMessage, setGuideMessage] = useState('')
  /** 절단선 초안 — 적용 전(사유지분석 «적용»과 동일) */
  const [pendingLine3857, setPendingLine3857] = useState<Pt3857[] | null>(null)
  const [sketchPointCount, setSketchPointCount] = useState(0)
  const sketchControlRef = useRef<SpatialDrawSketchControl | null>(null)
  const [roadPreviewTable, setRoadPreviewTable] =
    useState<SectionRoadPreviewTable>(null)
  const [roadChordActive, setRoadChordActive] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [tab, setTab] = useState<SectionTab>('crossChart')
  const [line3857, setLine3857] = useState<Pt3857[] | null>(null)
  const [ground, setGround] = useState<SectionGroundPt[]>([])
  const [groundMin, setGroundMin] = useState<SectionGroundPt[]>([])
  const [groundMax, setGroundMax] = useState<SectionGroundPt[]>([])
  const [features, setFeatures] = useState<SectionFeatureMark[]>([])
  const [supplyAreasRaw, setSupplyAreasRaw] = useState<SectionSupplyAreas>(EMPTY_SUPPLY_AREAS)
  const [supplyAreaBands, setSupplyAreaBands] = useState<SectionSupplyBandSegment[]>([])
  const [supplyElevComposition, setSupplyElevComposition] = useState<
    SectionSupplyElevRow[]
  >([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [totalLengthM, setTotalLengthM] = useState(0)
  const rawRef = useRef<{ pipes: PipeRow[]; points: PointRow[] }>({ pipes: [], points: [] })
  /** 지도에서 현재 켜진 키 — 조회 시작 시에만 스냅샷으로 복사 */
  const liveKeysRef = useRef(enabledLayerKeys)
  liveKeysRef.current = enabledLayerKeys
  /** 모달 내용 고정용 — loadSection 시점 레이어 키 */
  const frozenKeysRef = useRef<string[]>([])
  const [frozenKeys, setFrozenKeys] = useState<string[]>([])
  const tabRef = useRef(tab)
  tabRef.current = tab
  const cutLineSourceRef = useRef<VectorSource | null>(null)
  const sectionRectSourceRef = useRef<VectorSource | null>(null)
  /** 횡·종단 조회 결과 캐시 — 탭 전환 시 재조회 없음 */
  const viewCacheRef = useRef<{
    cross: SectionAxisCache | null
    long: SectionAxisCache | null
  }>({ cross: null, long: null })

  const setMapDrawInputSuspended = mapContext?.setMapDrawInputSuspended

  useWtlSectionRoadPreview(
    mapContext?.mapInstanceRef,
    Boolean(mapContext?.mapReady),
    roadPreviewTable
  )

  useEffect(() => {
    if (!roadChordActive) return
    setMapDrawInputSuspended?.(true)
    return () => setMapDrawInputSuspended?.(false)
  }, [roadChordActive, setMapDrawInputSuspended])

  const supplyAreaLines = useMemo(
    () => buildSupplyAreaLines(supplyAreasRaw, frozenKeys),
    [supplyAreasRaw, frozenKeys]
  )

  /** 조회 당시 켜진 급수구역·분구·블록만 하단 밴드에 표시 */
  const supplyAreaBandsFiltered = useMemo(() => {
    const keys = new Set(
      frozenKeys.map((k) => String(k).trim().toLowerCase()).filter(Boolean)
    )
    const has = (base: string) =>
      keys.has(base) || [...keys].some((k) => k === base || k.endsWith(`_${base}`))
    return supplyAreaBands.filter((s) => {
      if (s.role === 'zone') return has('wtl_wtsa_as')
      if (s.role === 'subzone') return has('wtl_wtssa_as')
      return has('wtl_wtsba_as')
    })
  }, [supplyAreaBands, frozenKeys])

  const supplyElevCompositionFiltered = useMemo(() => {
    const keys = new Set(
      frozenKeys.map((k) => String(k).trim().toLowerCase()).filter(Boolean)
    )
    const has = (base: string) =>
      keys.has(base) || [...keys].some((k) => k === base || k.endsWith(`_${base}`))
    return supplyElevComposition.filter((s) => {
      if (s.role === 'zone') return has('wtl_wtsa_as')
      if (s.role === 'subzone') return has('wtl_wtssa_as')
      return has('wtl_wtsba_as')
    })
  }, [supplyElevComposition, frozenKeys])

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
    const preview =
      pendingLine3857 && pendingLine3857.length >= 2
        ? pendingLine3857
        : line3857
    if (!preview || preview.length < 2) return
    cutSource.addFeature(new Feature({ geometry: new LineString(preview) }))

    const start = preview[0]!
    const end = preview[preview.length - 1]!
    const ring = sectionCutRectRing3857(start, end, SECTION_RECT_HALF_WIDTH_M)
    rectSource.addFeature(new Feature({ geometry: new Polygon([ring]) }))
  }, [line3857, pendingLine3857, mapContext?.mapReady])

  const clearRoadPreview = useCallback(() => {
    setRoadPreviewTable(null)
  }, [])

  const stopDrawingSession = useCallback(() => {
    setDrawing(false)
    setRoadChordActive(false)
    setSpatialDrawRequest?.(null)
    clearRoadPreview()
    setDrawMode(null)
    setGuideMessage('')
    setPendingLine3857(null)
    setSketchPointCount(0)
    sketchControlRef.current = null
    // 확정·취소 직후 singleclick이 레이어 선택을 타지 않게
    const suppress = mapContext?.suppressMapIdentifyUntilRef
    if (suppress) suppress.current = Date.now() + 500
    setMapDrawInputSuspended?.(false)
  }, [
    setSpatialDrawRequest,
    clearRoadPreview,
    setMapDrawInputSuspended,
    mapContext?.suppressMapIdentifyUntilRef,
  ])

  const cancelDraw = useCallback(() => {
    stopDrawingSession()
    setModePickerOpen(false)
  }, [stopDrawingSession])

  const clearSectionData = useCallback(() => {
    setLine3857(null)
    setPendingLine3857(null)
    setGround([])
    setGroundMin([])
    setGroundMax([])
    setFeatures([])
    setSupplyAreasRaw(EMPTY_SUPPLY_AREAS)
    setSupplyAreaBands([])
    setSupplyElevComposition([])
    frozenKeysRef.current = []
    setFrozenKeys([])
    setError('')
    viewCacheRef.current = { cross: null, long: null }
    rawRef.current = { pipes: [], points: [] }
  }, [])

  const closeModePicker = useCallback(() => {
    setModePickerOpen(false)
    setDrawMode(null)
    setGuideMessage('')
    setPendingLine3857(null)
    setSketchPointCount(0)
  }, [])

  const closePanel = useCallback(() => {
    setPanelOpen(false)
    clearSectionData()
    stopDrawingSession()
    setModePickerOpen(false)
    setTab('crossChart')
  }, [clearSectionData, stopDrawingSession])

  const applyAxisCache = useCallback(
    (tab: SectionTab, coords: Pt3857[]) => {
      const cached = viewCacheRef.current[axisCacheKey(tab)]
      if (!cached) return false
      rawRef.current = { pipes: cached.pipes, points: cached.points }
      setGround(cached.ground)
      setGroundMin(cached.groundMin)
      setGroundMax(cached.groundMax)
      setTotalLengthM(cached.totalLengthM)
      setSupplyAreasRaw(cached.supplyAreasRaw)
      setSupplyAreaBands(cached.supplyAreaBands)
      setSupplyElevComposition(cached.supplyElevComposition)
      setFeatures(
        buildFeatures(
          tab,
          coords,
          cached.ground,
          cached.pipes,
          cached.points,
          new Set(frozenKeysRef.current)
        )
      )
      setError('')
      return true
    },
    []
  )

  const fetchAxisCache = useCallback(
    async (
      coords: Pt3857[],
      tab: SectionTab,
      keysAtLoad: string[]
    ): Promise<SectionAxisCache | null> => {
      const { lineTables, pointTables, supplyAreaTables } =
        resolveTables(keysAtLoad)
      const res = await call('', 'POST', {
        service: 'elevationService',
        action: 'getWtlNetworkSectionData',
        params: {
          coords3857: coords,
          halfWidthM: halfWidthForTab(tab),
          profileAxis: profileAxisForTab(tab),
          sampleCount: 28,
          lineTables,
          pointTables,
          supplyAreaTables,
        },
      })
      const data = (res?.data ?? res) as SectionApi
      if (!data?.success) return null
      const g = mapGroundPts(data.ground)
      const pipes = data.pipes ?? []
      const points = data.points ?? []
      return {
        ground: g,
        groundMin: mapGroundPts(data.groundMin),
        groundMax: mapGroundPts(data.groundMax),
        totalLengthM:
          Number(data.totalLengthM) ||
          g[g.length - 1]?.distM ||
          (isLongProfileTab(tab) ? LONG_HALF_WIDTH_M * 2 : lineLengthM(coords)) ||
          0,
        supplyAreasRaw: data.supplyAreas ?? EMPTY_SUPPLY_AREAS,
        supplyAreaBands: Array.isArray(data.supplyAreaBands)
          ? data.supplyAreaBands
          : [],
        supplyElevComposition: Array.isArray(data.supplyElevComposition)
          ? data.supplyElevComposition
          : [],
        pipes,
        points,
      }
    },
    []
  )

  /** 절단선 확정 시 횡·종단을 한 번만 조회해 캐시 */
  const loadSectionBoth = useCallback(
    async (coords: Pt3857[], activeTab: SectionTab, keysOverride?: string[]) => {
      setLoading(true)
      setError('')
      const keysAtLoad = [
        ...(keysOverride?.length ? keysOverride : liveKeysRef.current),
      ]
      frozenKeysRef.current = keysAtLoad
      setFrozenKeys(keysAtLoad)
      viewCacheRef.current = { cross: null, long: null }
      try {
        const [crossCache, longCache] = await Promise.all([
          fetchAxisCache(coords, 'crossChart', keysAtLoad),
          fetchAxisCache(coords, 'longChart', keysAtLoad),
        ])
        if (!crossCache && !longCache) {
          setError('단면도 조회 실패')
          setGround([])
          setGroundMin([])
          setGroundMax([])
          setFeatures([])
          setSupplyAreasRaw(EMPTY_SUPPLY_AREAS)
          setSupplyAreaBands([])
          setSupplyElevComposition([])
          return
        }
        viewCacheRef.current = {
          cross: crossCache,
          long: longCache,
        }
        const showTab =
          activeTab === 'threejs' ? 'crossChart' : activeTab
        if (!applyAxisCache(showTab, coords)) {
          const fallback = crossCache ?? longCache
          if (fallback) {
            viewCacheRef.current[axisCacheKey(showTab)] = fallback
            applyAxisCache(showTab, coords)
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '단면도 조회 오류')
      } finally {
        setLoading(false)
      }
    },
    [fetchAxisCache, applyAxisCache]
  )

  const finishWithLine3857 = useCallback(
    (coords3857: Pt3857[]) => {
      stopDrawingSession()
      setModePickerOpen(false)
      if (coords3857.length < 2) {
        setError('라인을 두 점 이상 그려 주세요')
        setPanelOpen(true)
        return
      }
      setLine3857(coords3857)
      setPanelOpen(true)
      void loadSectionBoth(coords3857, tabRef.current)
    },
    [stopDrawingSession, loadSectionBoth]
  )

  /** 그리기 완료 → 초안만 보관(적용 전). 패널·조회는 적용 시 */
  const acceptDraftLine3857 = useCallback(
    (coords3857: Pt3857[]) => {
      if (coords3857.length < 2) {
        setGuideMessage('라인을 두 점 이상 그려 주세요')
        return
      }
      setSpatialDrawRequest?.(null)
      setRoadChordActive(false)
      setDrawing(false)
      setSketchPointCount(0)
      sketchControlRef.current = null
      clearRoadPreview()
      setMapDrawInputSuspended?.(false)
      setPendingLine3857(coords3857)
      setGuideMessage('')
      const suppress = mapContext?.suppressMapIdentifyUntilRef
      if (suppress) suppress.current = Date.now() + 500
    },
    [
      setSpatialDrawRequest,
      clearRoadPreview,
      setMapDrawInputSuspended,
      mapContext?.suppressMapIdentifyUntilRef,
    ]
  )

  const flashGuideRef = useRef<(msg: string) => void>(() => undefined)

  useWtlSectionRoadChordPick({
    mapRef: mapContext?.mapInstanceRef,
    mapReady: Boolean(mapContext?.mapReady),
    active: roadChordActive && !pendingLine3857,
    onComplete: acceptDraftLine3857,
    onFlash: (msg) => flashGuideRef.current(msg),
    suppressMapIdentifyUntilRef: mapContext?.suppressMapIdentifyUntilRef,
  })

  /** 직선·도로구간 — spatialDrawRequest 두 점. 실폭도로는 가로지르기 한 번 찍기. */
  const beginLineDraw = useCallback(
    (mode: SectionDrawMode) => {
      if (!canStartMapDrawInteraction(mapContext, 'spatialSearch')) return

      clearSectionData()
      setPanelOpen(false)
      setGuideMessage('')
      setPendingLine3857(null)
      setSketchPointCount(0)
      setDrawMode(mode)
      setModePickerOpen(true)
      setDrawing(true)
      setSpatialDrawRequest?.(null)
      setRoadChordActive(false)

      if (mode === 'roadWidth') {
        setRoadPreviewTable(null)
        setRoadChordActive(true)
        setMapDrawInputSuspended?.(true)
        return
      }

      setMapDrawInputSuspended?.(false)

      if (!setSpatialDrawRequest) return
      setRoadPreviewTable(mode === 'roadSeg' ? 'tl_sprd_manage' : null)

      setSpatialDrawRequest({
        type: 'line',
        snapLayerName: mode === 'roadSeg' ? 'tl_sprd_manage' : undefined,
        sketchControlRef,
        onSketchPointCount: setSketchPointCount,
        onComplete: (wkt5181: string) => {
          const w = String(wkt5181 ?? '').trim()
          if (!w) {
            setDrawing(false)
            setSketchPointCount(0)
            return
          }
          const pts5181 = parseLineWkt5181(w)
          const coords3857: Pt3857[] = pts5181.map((p) => {
            const [x, y] = transform(p, 'EPSG:5181', 'EPSG:3857')
            return [x, y]
          })
          acceptDraftLine3857(coords3857)
        },
      })
    },
    [
      mapContext,
      setSpatialDrawRequest,
      clearSectionData,
      acceptDraftLine3857,
      setMapDrawInputSuspended,
    ]
  )

  const chooseDrawMode = useCallback(
    (mode: SectionDrawMode) => {
      beginLineDraw(mode)
    },
    [beginLineDraw]
  )

  const flashGuide = useCallback((msg: string) => {
    setGuideMessage(msg)
    window.setTimeout(() => {
      setGuideMessage((cur) => (cur === msg ? '' : cur))
    }, 2500)
  }, [])
  flashGuideRef.current = flashGuide

  /** 적용 — 초안 절단선으로 단면도 조회 */
  const applyPendingLine = useCallback(() => {
    if (!pendingLine3857 || pendingLine3857.length < 2) return
    const coords = pendingLine3857
    setPendingLine3857(null)
    finishWithLine3857(coords)
  }, [pendingLine3857, finishWithLine3857])

  /** 선 되돌리기 — 초안이면 다시 그리기, 스케치 중이면 마지막 점 제거 */
  const undoLastVertex = useCallback(() => {
    if (pendingLine3857) {
      const mode = drawMode
      setPendingLine3857(null)
      if (mode) beginLineDraw(mode)
      return
    }
    if (sketchPointCount > 0) {
      sketchControlRef.current?.removeLastPoint()
    }
  }, [pendingLine3857, drawMode, beginLineDraw, sketchPointCount])

  /** 다시 지정 — 방식 선택부터 */
  const respecifyCutLine = useCallback(() => {
    setPendingLine3857(null)
    setSketchPointCount(0)
    setSpatialDrawRequest?.(null)
    setRoadChordActive(false)
    setDrawing(false)
    setDrawMode(null)
    clearRoadPreview()
    setMapDrawInputSuspended?.(false)
    setGuideMessage('')
    setModePickerOpen(true)
  }, [
    setSpatialDrawRequest,
    clearRoadPreview,
    setMapDrawInputSuspended,
  ])

  /** 도구 버튼 — 그리는 중·초안이면 취소, 선택 중이면 닫기, 아니면 방식 선택 */
  const startSection = useCallback(() => {
    if (drawing || roadChordActive || pendingLine3857) {
      cancelDraw()
      return
    }
    if (modePickerOpen) {
      closeModePicker()
      return
    }
    if (panelOpen) {
      setPanelOpen(false)
      clearSectionData()
    }
    setDrawMode(null)
    setGuideMessage('')
    setModePickerOpen(true)
  }, [
    drawing,
    roadChordActive,
    pendingLine3857,
    modePickerOpen,
    panelOpen,
    cancelDraw,
    closeModePicker,
    clearSectionData,
  ])

  /** 패널 «다시 그리기» — 방식 선택부터 */
  const redrawSection = useCallback(() => {
    setPanelOpen(false)
    clearSectionData()
    stopDrawingSession()
    setModePickerOpen(true)
  }, [clearSectionData, stopDrawingSession])

  const setTabAndReload = useCallback(
    (next: SectionTab) => {
      setTab(next)
      if (!line3857) return
      // ThreeJs는 자체 조회 — 차트 캐시는 그대로 둠
      if (next === 'threejs') return
      if (applyAxisCache(next, line3857)) return
      void loadSectionBoth(
        line3857,
        next,
        frozenKeysRef.current.length ? frozenKeysRef.current : undefined
      )
    },
    [line3857, applyAxisCache, loadSectionBoth]
  )

  const lineLonLat = useMemo((): [number, number][] | null => {
    if (!line3857 || line3857.length < 2) return null
    return line3857.map(([x, y]) => {
      const [lon, lat] = transform([x, y], 'EPSG:3857', 'EPSG:4326')
      return [lon, lat] as [number, number]
    })
  }, [line3857])

  const pendingReady =
    pendingLine3857 != null && pendingLine3857.length >= 2
  const canUndoLast =
    pendingReady || sketchPointCount > 0

  return {
    drawing: drawing || roadChordActive || pendingReady,
    modePickerOpen,
    drawMode,
    guideMessage,
    pendingReady,
    canUndoLast,
    panelOpen,
    tab,
    setTab: setTabAndReload,
    ground,
    groundMin,
    groundMax,
    features,
    supplyAreaLines,
    supplyAreaBands: supplyAreaBandsFiltered,
    supplyElevComposition: supplyElevCompositionFiltered,
    loading,
    error,
    totalLengthM,
    lineLonLat,
    line3857,
    enabledKeys: frozenKeys,
    lineReady: line3857 != null && line3857.length >= 2,
    startSection,
    chooseDrawMode,
    closeModePicker,
    redrawSection,
    closePanel,
    cancelDraw,
    applyPendingLine,
    undoLastVertex,
    respecifyCutLine,
  }
}
