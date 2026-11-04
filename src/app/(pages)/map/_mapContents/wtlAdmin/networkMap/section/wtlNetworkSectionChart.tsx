'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  ScatterController,
  BubbleController,
  Tooltip,
  Legend,
  Filler,
  type ChartData,
  type ChartOptions,
  type Plugin,
} from 'chart.js'
import { Chart, Line } from 'react-chartjs-2'
import annotationPlugin from 'chartjs-plugin-annotation'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import type {
  SectionFeatureMark,
  SectionGroundPt,
  SectionSupplyBandSegment,
} from './wtlNetworkSectionSvg'

ChartJS.register(
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  ScatterController,
  BubbleController,
  Tooltip,
  Legend,
  Filler,
  annotationPlugin,
  ChartDataLabels
)

const ROLE_ORDER: Array<{ role: SectionSupplyBandSegment['role']; label: string }> = [
  { role: 'zone', label: '구역' },
  { role: 'subzone', label: '분구' },
  { role: 'block', label: '블록' },
]

/**
 * Chart.js dataset `order`
 * - 정렬은 오름차순이지만, 그리기는 역순(큰 order 먼저 = 뒤).
 * - 따라서 **작을수록 위**. SHP: POINT > LINE > POLYGON
 */
const CHART_Z = {
  cut: 1,
  point: 10,
  line: 20,
  ground: 30,
  polygon: 40,
} as const

/** SVG SectionCutLine 과 동일 */
const SECTION_CUT_COLOR = '#FF9100'

function formatLenLabelM(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '0'
  if (m >= 100) return String(Math.round(m))
  if (m >= 10) return m.toFixed(0)
  return m.toFixed(1).replace(/\.0$/, '')
}

function layerLegendName(f: SectionFeatureMark): string {
  return String(f.layerKorName || f.label || '레이어').trim() || '레이어'
}

function groupFeaturesByLayer(features: SectionFeatureMark[]): Map<string, SectionFeatureMark[]> {
  const map = new Map<string, SectionFeatureMark[]>()
  for (const f of features) {
    const name = layerLegendName(f)
    const arr = map.get(name)
    if (arr) arr.push(f)
    else map.set(name, [f])
  }
  return map
}

type AxisMark = { distM: number; label: string }
type AxisLabelLine = { text: string; kind: 'pipe' | 'point' }
type AxisLabelStack = { distM: number; lines: AxisLabelLine[] }
type PlacedAxisStack = AxisLabelStack & { baseRow: number }

const AXIS_LABEL_LINE_H = 12
const AXIS_LABEL_TOP = 4
/** 정규화 X(0~1) 기준 — 이보다 가까우면 세로로 밀어 겹침 회피 */
const AXIS_LABEL_NEAR_FRAC = 0.07

/** 횡단 X축 — 같은 거리면 관로→시설 순으로 세로 나열 */
function buildAxisLabelStacks(features: SectionFeatureMark[]): AxisLabelStack[] {
  const sorted = [...features]
    .filter((f) => Number.isFinite(f.distM))
    .sort((a, b) => {
      if (a.distM !== b.distM) return a.distM - b.distM
      if (a.kind === b.kind) return 0
      return a.kind === 'pipe' ? -1 : 1
    })

  const stacks: AxisLabelStack[] = []
  for (const f of sorted) {
    const text = (f.label || f.layerKorName || '').trim()
    if (!text) continue
    const last = stacks[stacks.length - 1]
    if (last && Math.abs(last.distM - f.distM) < 0.05) {
      if (!last.lines.some((l) => l.text === text && l.kind === f.kind)) {
        last.lines.push({ text, kind: f.kind })
      }
      continue
    }
    stacks.push({ distM: f.distM, lines: [{ text, kind: f.kind }] })
  }
  for (const s of stacks) {
    s.lines.sort((a, b) => {
      if (a.kind === b.kind) return 0
      return a.kind === 'pipe' ? -1 : 1
    })
  }
  return stacks
}

/**
 * 가까운 위치(관로끼리 포함) 라벨이 가로로 겹치면 baseRow를 내려 세로 배치.
 * xmax로 dist→0~1 정규화해 차트 폭과 무관하게 동일 규칙 적용.
 */
function layoutAxisStacksAvoidOverlap(
  stacks: AxisLabelStack[],
  xmax: number
): { placed: PlacedAxisStack[]; maxRows: number } {
  const span = Math.max(xmax, 0.01)
  const halfNear = AXIS_LABEL_NEAR_FRAC / 2
  const rowOcc: { n1: number; n2: number }[][] = []
  const placed: PlacedAxisStack[] = []

  for (const stack of stacks) {
    const nx = stack.distM / span
    const charExtra = Math.max(0, Math.max(...stack.lines.map((l) => l.text.length), 1) - 4) * 0.004
    const half = halfNear + charExtra
    const n1 = nx - half
    const n2 = nx + half

    let baseRow = 0
    for (;;) {
      let ok = true
      for (let i = 0; i < stack.lines.length; i++) {
        const occ = rowOcc[baseRow + i] ?? []
        if (occ.some((o) => !(n2 <= o.n1 || n1 >= o.n2))) {
          ok = false
          break
        }
      }
      if (ok || baseRow > 48) break
      baseRow++
    }
    for (let i = 0; i < stack.lines.length; i++) {
      const r = baseRow + i
      if (!rowOcc[r]) rowOcc[r] = []
      rowOcc[r]!.push({ n1, n2 })
    }
    placed.push({ ...stack, baseRow })
  }

  const maxRows = Math.max(1, ...placed.map((p) => p.baseRow + p.lines.length), 1)
  return { placed, maxRows }
}

function crossFooterBottomPad(maxLines: number): number {
  // 라벨 스택 + 간격 + 절단면 선·끝캡·라벨
  return AXIS_LABEL_TOP + Math.max(1, maxLines) * AXIS_LABEL_LINE_H + 8 + 5 + 14
}

function normalizeStroke(stroke?: string | null): string {
  if (!stroke) return '#888888'
  const value = String(stroke).trim()
  if (!value || value === '#' || value.toLowerCase() === 'undefined') return '#888888'
  const withHash = value.startsWith('#') ? value : `#${value}`
  if (!/^#[0-9A-Fa-f]{6}$/.test(withHash)) return '#888888'
  return withHash.toUpperCase()
}

function groundElevAt(ground: SectionGroundPt[], distM: number): number | null {
  if (!ground.length) return null
  if (distM <= ground[0]!.distM) return ground[0]!.elevM
  const last = ground[ground.length - 1]!
  if (distM >= last.distM) return last.elevM
  for (let i = 1; i < ground.length; i++) {
    const a = ground[i - 1]!
    const b = ground[i]!
    if (distM <= b.distM) {
      const t = (distM - a.distM) / Math.max(1e-6, b.distM - a.distM)
      return a.elevM + t * (b.elevM - a.elevM)
    }
  }
  return last.elevM
}

function bubbleRadiusPx(diameterM: number): number {
  const mm = Math.max(0, diameterM * 1000)
  if (!Number.isFinite(mm) || mm <= 0) return 3
  const r = 1.5 + Math.log10(mm + 1) * 1.6
  return Math.min(8, Math.max(2, r))
}

/** 범례: 관로=원, 선·시설은 데이터셋 스타일 유지 */
function buildSectionLegendLabels(
  chart: ChartJS,
  opts: {
    pipeLabels: Set<string>
    hide?: (text: string) => boolean
  }
) {
  const base = ChartJS.defaults.plugins.legend.labels.generateLabels!(chart)
  return base
    .filter((item) => {
      const t = String(item.text || '')
      if (!t) return false
      return opts.hide ? !opts.hide(t) : true
    })
    .map((item) => {
      const t = String(item.text || '')
      const ds = chart.data.datasets[item.datasetIndex ?? -1] as
        | { type?: string; pointStyle?: string }
        | undefined
      if (opts.pipeLabels.has(t) || ds?.type === 'bubble') {
        return { ...item, pointStyle: 'circle' as const }
      }
      if (ds?.pointStyle === 'rectRot') {
        return { ...item, pointStyle: 'rectRot' as const }
      }
      if (
        t === '지반고' ||
        t === '절단면' ||
        t.startsWith('옆면') ||
        t.startsWith('격자')
      ) {
        return { ...item, pointStyle: 'line' as const }
      }
      return item
    })
}

/**
 * 횡단 X축 바깥 하단:
 * 1) 위치별 라벨(겹치면 세로 이동, 스택 내 관로→시설)
 * 2) 그 아래 절단면 점선
 */
function createCrossAxisFooterPlugin(
  placed: PlacedAxisStack[],
  maxRows: number,
  cutLen: string
): Plugin {
  return {
    id: 'wtlCrossAxisFooter',
    afterDraw(chart) {
      const xScale = chart.scales.x
      if (!xScale) return
      const { ctx, chartArea } = chart
      const x1 = xScale.getPixelForValue(xScale.min ?? 0)
      const x2 = xScale.getPixelForValue(xScale.max ?? 0)
      if (!Number.isFinite(x1) || !Number.isFinite(x2)) return

      ctx.save()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      for (const stack of placed) {
        const x = xScale.getPixelForValue(stack.distM)
        if (!Number.isFinite(x)) continue
        stack.lines.forEach((line, i) => {
          const row = stack.baseRow + i
          ctx.fillStyle = line.kind === 'pipe' ? '#1e293b' : '#64748b'
          ctx.font =
            line.kind === 'pipe' ? '600 10px sans-serif' : '400 10px sans-serif'
          ctx.fillText(
            line.text,
            x,
            chartArea.bottom + AXIS_LABEL_TOP + row * AXIS_LABEL_LINE_H
          )
        })
      }

      const cutY = chartArea.bottom + AXIS_LABEL_TOP + maxRows * AXIS_LABEL_LINE_H + 8
      const tick = 5
      ctx.strokeStyle = SECTION_CUT_COLOR
      ctx.fillStyle = '#c2410c'
      ctx.lineWidth = 2
      ctx.lineCap = 'square'
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.moveTo(x1, cutY)
      ctx.lineTo(x2, cutY)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(x1, cutY - tick)
      ctx.lineTo(x1, cutY + tick)
      ctx.moveTo(x2, cutY - tick)
      ctx.lineTo(x2, cutY + tick)
      ctx.stroke()
      ctx.font = '600 10px sans-serif'
      ctx.fillText(`절단면(${cutLen}m)`, (x1 + x2) / 2, cutY + tick + 3)
      ctx.restore()
    },
  }
}

type LongPipeLegendItem = { key: string; label: string; color: string }
type LongPipeLegendGroup = { layerName: string; items: LongPipeLegendItem[] }

function buildLongPipeLegendGroups(pipes: SectionFeatureMark[]): LongPipeLegendGroup[] {
  const used = new Map<string, number>()
  const byLayer = new Map<string, LongPipeLegendItem[]>()
  for (const p of pipes) {
    const layerName = layerLegendName(p)
    const baseName = (p.label || layerName).trim() || layerName
    const n = (used.get(baseName) ?? 0) + 1
    used.set(baseName, n)
    const label = n === 1 ? baseName : `${baseName} (${n})`
    const arr = byLayer.get(layerName)
    const item = { key: p.id || `${layerName}-${label}`, label, color: normalizeStroke(p.color) }
    if (arr) arr.push(item)
    else byLayer.set(layerName, [item])
  }
  return [...byLayer.entries()].map(([layerName, items]) => ({ layerName, items }))
}

type PlotInset = { left: number; right: number }

const DEFAULT_PLOT_INSET: PlotInset = { left: 48, right: 10 }

/** 단면도 chartArea 좌·우 여백 → 구역·분구·블록 X축 정렬 */
function createPlotInsetSyncPlugin(
  onInset: (inset: PlotInset) => void
): Plugin {
  let lastL = -1
  let lastR = -1
  return {
    id: 'wtlPlotInsetSync',
    afterLayout(chart) {
      const left = Math.round(chart.chartArea.left)
      const right = Math.round(Math.max(0, chart.width - chart.chartArea.right))
      if (left === lastL && right === lastR) return
      lastL = left
      lastR = right
      onInset({ left, right })
    },
  }
}

/**
 * 급수구역·분구·블록 간트 (종단 SVG·차트형태 공통 느낌).
 * plotInset = 상단 단면도 chartArea와 동일 X 길이.
 */
function SupplyAreaGanttChart({
  bands,
  totalLengthM,
  plotInset = DEFAULT_PLOT_INSET,
}: {
  bands: SectionSupplyBandSegment[]
  totalLengthM: number
  plotInset?: PlotInset
}) {
  const roles = useMemo(
    () => ROLE_ORDER.filter((r) => bands.some((b) => b.role === r.role)),
    [bands]
  )
  if (!roles.length) return null

  const len = Math.max(totalLengthM, 0.01)
  const pct = (m: number) => `${(Math.min(len, Math.max(0, m)) / len) * 100}%`
  const labelW = Math.max(36, plotInset.left)

  return (
    <div className="mt-1 flex pt-1" role="img" aria-label="급수구역·분구·블록">
      <div className="shrink-0" style={{ width: labelW }}>
        {roles.map((row) => (
          <div
            key={row.role}
            className="flex h-[22px] items-center justify-end pr-1.5 text-[10px] font-semibold text-[#3d5560]"
          >
            {row.label}
          </div>
        ))}
      </div>
      <div
        className="min-w-0 flex-1 overflow-hidden rounded border border-[#e2e8f0] bg-[#f8fafc]"
        style={{ marginRight: plotInset.right }}
      >
        {roles.map((row, ri) => {
          const segs = bands
            .filter((b) => b.role === row.role)
            .slice()
            .sort((a, b) => a.fromM - b.fromM || a.toM - b.toM)
          return (
            <div
              key={row.role}
              className={
                ri < roles.length - 1
                  ? 'relative h-[22px] border-b border-[#e2e8f0]'
                  : 'relative h-[22px]'
              }
            >
              {segs.map((seg, si) => {
                const color = normalizeStroke(seg.color)
                const left = pct(Math.min(seg.fromM, seg.toM))
                const widthPct =
                  ((Math.min(len, Math.max(seg.fromM, seg.toM)) -
                    Math.max(0, Math.min(seg.fromM, seg.toM))) /
                    len) *
                  100
                const width = `${Math.max(0.4, widthPct)}%`
                const showName = widthPct >= 4
                return (
                  <div
                    key={`${row.role}-${si}-${seg.name}`}
                    className="absolute top-[3px] flex h-[16px] items-center justify-center overflow-hidden rounded-sm border px-0.5"
                    style={{
                      left,
                      width,
                      backgroundColor: `${color}59`,
                      borderColor: color,
                    }}
                    title={`${seg.name} (${seg.fromM.toFixed(1)}~${seg.toM.toFixed(1)}m)`}
                  >
                    {showName ? (
                      <span className="truncate text-[9px] font-semibold text-[#1e293b]">
                        {seg.name}
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function usePlotInsetSync(): {
  plotInset: PlotInset
  insetSyncPlugin: Plugin
} {
  const [plotInset, setPlotInset] = useState<PlotInset>(DEFAULT_PLOT_INSET)
  const insetRef = useRef(plotInset)
  const onInset = useCallback((inset: PlotInset) => {
    if (
      inset.left === insetRef.current.left &&
      inset.right === insetRef.current.right
    ) {
      return
    }
    insetRef.current = inset
    setPlotInset(inset)
  }, [])
  const insetSyncPlugin = useMemo(
    () => createPlotInsetSyncPlugin(onInset),
    [onInset]
  )
  return { plotInset, insetSyncPlugin }
}

function CrossSectionChart({
  ground,
  features,
  totalLengthM,
  supplyAreaBands,
}: {
  ground: SectionGroundPt[]
  features: SectionFeatureMark[]
  totalLengthM: number
  supplyAreaBands: SectionSupplyBandSegment[]
}) {
  const pipes = features.filter((f) => f.kind === 'pipe')
  const points = features.filter((f) => f.kind === 'point')
  const { plotInset, insetSyncPlugin } = usePlotInsetSync()
  const axisStacks = useMemo(() => buildAxisLabelStacks(features), [features])
  const xmaxForLayout = Math.max(
    totalLengthM,
    ground[ground.length - 1]?.distM ?? 0,
    0.01
  )
  const axisLayout = useMemo(
    () => layoutAxisStacksAvoidOverlap(axisStacks, xmaxForLayout),
    [axisStacks, xmaxForLayout]
  )
  const axisMarks = useMemo(
    (): AxisMark[] =>
      axisLayout.placed.map((s) => ({
        distM: s.distM,
        label: s.lines.map((l) => l.text).join('/'),
      })),
    [axisLayout]
  )

  const pipeLabels = useMemo(
    () => new Set([...groupFeaturesByLayer(pipes).keys()]),
    [pipes]
  )

  const elevBounds = useMemo(() => {
    const elevs = ground.map((g) => g.elevM)
    for (const p of pipes) {
      const surf = p.surfaceElevM ?? groundElevAt(ground, p.distM)
      if (surf != null) elevs.push(surf - (Number(p.depthM) || 0), surf)
    }
    for (const p of points) {
      const surf = p.surfaceElevM ?? groundElevAt(ground, p.distM)
      if (surf != null) elevs.push(surf)
    }
    const dataMin = elevs.length ? Math.min(...elevs) : 0
    const dataMax = elevs.length ? Math.max(...elevs) : 10
    const span = Math.max(0.5, dataMax - dataMin)
    const ymin = dataMin - 0.5
    const ymax = dataMax + 0.5
    const xmax = xmaxForLayout
    return {
      ymin,
      ymax,
      xmax,
      span,
      tickH: Math.max(0.08, span * 0.03),
      cutLen: formatLenLabelM(xmax),
      bottomPad: crossFooterBottomPad(axisLayout.maxRows),
    }
  }, [ground, pipes, points, xmaxForLayout, axisLayout.maxRows])

  const axisFooterPlugin = useMemo(
    () =>
      createCrossAxisFooterPlugin(
        axisLayout.placed,
        axisLayout.maxRows,
        elevBounds.cutLen
      ),
    [axisLayout, elevBounds.cutLen]
  )

  const chartData = useMemo((): ChartData => {
    const groundPts = ground.map((g) => ({ x: g.distM, y: g.elevM }))
    const datasets: ChartData['datasets'] = [
      {
        type: 'line' as const,
        label: '지반고',
        data: groundPts,
        borderColor: '#787878',
        backgroundColor: 'rgba(180, 180, 180, 0.2)',
        fill: false,
        pointRadius: 0,
        tension: 0.15,
        borderWidth: 1.5,
        order: CHART_Z.ground,
      },
    ]

    // LINE(관) — 범례 = 레이어명 (order 작을수록 위)
    for (const [layerName, group] of groupFeaturesByLayer(pipes)) {
      const pipePts = group.map((p) => {
        const surf = p.surfaceElevM ?? groundElevAt(ground, p.distM) ?? 0
        const elev = surf - (Number(p.depthM) || 0)
        return {
          x: p.distM,
          y: elev,
          r: bubbleRadiusPx(p.diameterM),
          label: p.label || layerName,
          color: normalizeStroke(p.color),
        }
      })
      datasets.push({
        type: 'bubble' as const,
        label: layerName,
        data: pipePts,
        backgroundColor: pipePts.map((p) => `${p.color}99`),
        borderColor: pipePts.map((p) => p.color),
        borderWidth: 1.5,
        pointStyle: 'circle',
        order: CHART_Z.line,
      })
    }

    // POINT(시설) — 범례 = 레이어명 (최상단)
    for (const [layerName, group] of groupFeaturesByLayer(points)) {
      const pointPts = group.map((p) => {
        const surf = p.surfaceElevM ?? groundElevAt(ground, p.distM) ?? 0
        return {
          x: p.distM,
          y: surf,
          label: p.label || layerName,
          color: normalizeStroke(p.color),
        }
      })
      datasets.push({
        type: 'scatter' as const,
        label: layerName,
        data: pointPts,
        backgroundColor: pointPts.map((p) => p.color),
        borderColor: '#ffffff',
        borderWidth: 1,
        pointRadius: 5,
        pointStyle: 'rectRot' as const,
        order: CHART_Z.point,
      })
    }

    return { datasets }
  }, [ground, pipes, points])

  const options = useMemo((): ChartOptions => {
    const { ymin, ymax, xmax, span, tickH, bottomPad } = elevBounds

    type MarkPt = { label?: string; color?: string; x?: number; y?: number }
    const markAt = (ctx: { dataset: { type?: string; data: unknown[] }; dataIndex: number }) =>
      ctx.dataset.data[ctx.dataIndex] as MarkPt | undefined

    // 시설간 거리 — 그래프 내부(하단)
    const gapY = ymin + Math.max(0.1, span * 0.05)
    const annotations: Record<string, object> = {}
    for (let i = 1; i < axisMarks.length; i++) {
      const a = axisMarks[i - 1]!
      const b = axisMarks[i]!
      const gap = b.distM - a.distM
      if (!(gap > 0.01)) continue
      const mid = (a.distM + b.distM) / 2
      const gapTxt = formatLenLabelM(gap)
      annotations[`gapLine${i}`] = {
        type: 'line',
        xMin: a.distM,
        xMax: b.distM,
        yMin: gapY,
        yMax: gapY,
        borderColor: '#64748b',
        borderWidth: 1.2,
        drawTime: 'afterDatasets',
        clip: false,
      }
      annotations[`gapTickL${i}`] = {
        type: 'line',
        xMin: a.distM,
        xMax: a.distM,
        yMin: gapY - tickH,
        yMax: gapY + tickH,
        borderColor: '#64748b',
        borderWidth: 1.5,
        drawTime: 'afterDatasets',
        clip: false,
      }
      annotations[`gapTickR${i}`] = {
        type: 'line',
        xMin: b.distM,
        xMax: b.distM,
        yMin: gapY - tickH,
        yMax: gapY + tickH,
        borderColor: '#64748b',
        borderWidth: 1.5,
        drawTime: 'afterDatasets',
        clip: false,
      }
      annotations[`gapLbl${i}`] = {
        type: 'label',
        xValue: mid,
        yValue: gapY,
        content: `|--- ${gapTxt} m ---|`,
        color: '#475569',
        font: { size: 9, weight: '600' },
        backgroundColor: 'rgba(255,255,255,0.95)',
        padding: { top: 1, bottom: 1, left: 2, right: 2 },
        borderRadius: 2,
        position: { x: 'center', y: 'center' },
        yAdjust: -12,
        drawTime: 'afterDatasets',
        clip: false,
      }
    }

    return {
      responsive: true,
      maintainAspectRatio: false,
      // 하단 여백: X축 바깥 라벨 스택 + 절단면
      layout: {
        padding: { top: 8, bottom: bottomPad },
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            font: { size: 11 },
            boxWidth: 12,
            usePointStyle: true,
            generateLabels: (chart) =>
              buildSectionLegendLabels(chart, { pipeLabels }),
          },
        },
        datalabels: {
          display: false,
          formatter: (_v, ctx) => {
            if (ctx.dataset.type === 'line') return ''
            return markAt(ctx)?.label || ''
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const raw = ctx.raw as MarkPt | undefined
              const name = raw?.label || ctx.dataset.label
              return `${name}: ${Number(raw?.x ?? ctx.parsed.x).toFixed(1)}m / EL ${Number(raw?.y ?? ctx.parsed.y).toFixed(2)}`
            },
          },
        },
        annotation: {
          clip: false,
          annotations,
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: 0,
          max: xmax,
          title: { display: false },
          afterBuildTicks: (axis) => {
            axis.ticks = axisMarks.map((m) => ({ value: m.distM }))
          },
          ticks: {
            // 라벨은 footer 플러그인이 관로→시설 세로 스택으로 그림
            display: false,
          },
          grid: { color: '#e2e8f0' },
        },
        y: {
          type: 'linear',
          min: ymin,
          max: ymax,
          title: { display: true, text: '표고 (m)', font: { size: 11 } },
          ticks: { font: { size: 10 } },
          grid: { color: '#e2e8f0' },
        },
      },
    }
  }, [elevBounds, axisMarks, pipeLabels])

  if (!ground.length) {
    return (
      <p className="py-10 text-center text-[12px] text-muted-foreground">
        등고 지반고를 읽지 못했습니다. 절단선을 다시 그려 주세요.
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded border-2 border-[#787878] bg-white p-2">
      <div className="relative z-[2]" style={{ height: 320 + elevBounds.bottomPad }}>
        <Chart
          type="scatter"
          data={chartData}
          options={options}
          plugins={[axisFooterPlugin, insetSyncPlugin]}
        />
      </div>
      <div className="relative z-[1]">
        <SupplyAreaGanttChart
          bands={supplyAreaBands}
          totalLengthM={xmaxForLayout}
          plotInset={plotInset}
        />
      </div>
    </div>
  )
}

function LongSectionChart({
  ground,
  groundMin,
  groundMax,
  features,
  totalLengthM,
  supplyAreaBands,
}: {
  ground: SectionGroundPt[]
  groundMin: SectionGroundPt[]
  groundMax: SectionGroundPt[]
  features: SectionFeatureMark[]
  totalLengthM: number
  supplyAreaBands: SectionSupplyBandSegment[]
}) {
  const pipes = features.filter((f) => f.kind === 'pipe')
  const len = Math.max(totalLengthM, ground[ground.length - 1]?.distM ?? 0, 0.01)
  const { plotInset, insetSyncPlugin } = usePlotInsetSync()
  const rolesPresent = useMemo(
    () => ROLE_ORDER.filter((r) => supplyAreaBands.some((b) => b.role === r.role)),
    [supplyAreaBands]
  )

  const elevRange = useMemo(() => {
    const elevs = ground.map((g) => g.elevM)
    for (const g of groundMin) elevs.push(g.elevM)
    for (const g of groundMax) elevs.push(g.elevM)
    for (const p of pipes) {
      const dep = Number(p.depthM) || 0
      for (const g of ground) {
        const from = p.spanFromM ?? p.distM
        const to = p.spanToM ?? p.distM
        if (g.distM < from - 0.01 || g.distM > to + 0.01) continue
        elevs.push(g.elevM - dep)
      }
    }
    const dataMin = elevs.length ? Math.min(...elevs) : 0
    const dataMax = elevs.length ? Math.max(...elevs) : 10
    return {
      ymin: dataMin - 0.35,
      ymax: dataMax + 0.35,
      dataMin,
    }
  }, [ground, groundMin, groundMax, pipes])

  const chartData = useMemo((): ChartData<'line'> => {
    const { ymin, ymax } = elevRange
    const cutX = len / 2
    const datasets: ChartData<'line'>['datasets'] = [
      {
        label: '지반고',
        data: ground.map((g) => ({ x: g.distM, y: g.elevM })),
        borderColor: '#787878',
        backgroundColor: 'rgba(180, 180, 180, 0.12)',
        fill: false,
        pointRadius: 0,
        tension: 0.12,
        borderWidth: 1.8,
        order: CHART_Z.ground,
      },
      // 절단면 = 깊이축 중심 수직선 (SVG long 과 동일)
      {
        label: '절단면',
        data: [
          { x: cutX, y: ymin },
          { x: cutX, y: ymax },
        ],
        borderColor: SECTION_CUT_COLOR,
        borderDash: [6, 4],
        borderWidth: 1.8,
        pointRadius: 0,
        fill: false,
        tension: 0,
        order: CHART_Z.cut,
      },
    ]
    if (groundMax.length) {
      datasets.push({
        label: '옆면 최고 지반고',
        data: groundMax.map((g) => ({ x: g.distM, y: g.elevM })),
        borderColor: '#94a3b8',
        borderDash: [4, 3],
        pointRadius: 0,
        fill: false,
        borderWidth: 1,
        order: CHART_Z.polygon,
      })
    }
    if (groundMin.length) {
      datasets.push({
        label: '옆면 최저 지반고',
        data: groundMin.map((g) => ({ x: g.distM, y: g.elevM })),
        borderColor: '#cbd5e1',
        borderDash: [4, 3],
        pointRadius: 0,
        fill: false,
        borderWidth: 1,
        order: CHART_Z.polygon,
      })
    }
    // 관로 — 차트선은 유지, 범례는 우측 HTML 섹션
    const usedLegendNames = new Map<string, number>()
    for (const p of pipes) {
      const layerName = layerLegendName(p)
      const baseName = (p.label || layerName).trim() || layerName
      const n = (usedLegendNames.get(baseName) ?? 0) + 1
      usedLegendNames.set(baseName, n)
      const legendName = n === 1 ? baseName : `${baseName} (${n})`
      const from = Math.max(0, p.spanFromM ?? p.distM - 0.5)
      const to = Math.min(len, p.spanToM ?? p.distM + 0.5)
      const dep = Number(p.depthM) || 0
      const pts: { x: number; y: number }[] = []
      for (const g of ground) {
        if (g.distM < from - 0.01 || g.distM > to + 0.01) continue
        pts.push({ x: g.distM, y: g.elevM - dep })
      }
      if (pts.length < 2) {
        const s0 = groundElevAt(ground, from) ?? 0
        const s1 = groundElevAt(ground, to) ?? 0
        pts.push({ x: from, y: s0 - dep }, { x: to, y: s1 - dep })
      }
      datasets.push({
        label: legendName,
        data: pts,
        borderColor: normalizeStroke(p.color),
        backgroundColor: normalizeStroke(p.color),
        pointRadius: 0,
        pointStyle: 'circle',
        borderWidth: 2.2,
        fill: false,
        order: CHART_Z.line,
      })
    }
    return { datasets }
  }, [ground, groundMin, groundMax, pipes, len, elevRange])

  const pipeLegendGroups = useMemo(() => buildLongPipeLegendGroups(pipes), [pipes])
  const pipeLegendLabels = useMemo(() => {
    const set = new Set<string>()
    for (const g of pipeLegendGroups) {
      for (const it of g.items) set.add(it.label)
    }
    return set
  }, [pipeLegendGroups])

  const options = useMemo((): ChartOptions<'line'> => {
    const { ymin, ymax } = elevRange
    const cutLen = formatLenLabelM(len)
    const cutX = len / 2
    return {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { left: 8, top: 22 } },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            font: { size: 10 },
            boxWidth: 10,
            usePointStyle: true,
            generateLabels: (chart) => {
              const items = buildSectionLegendLabels(chart, {
                pipeLabels: pipeLegendLabels,
                hide: (t) => pipeLegendLabels.has(t),
              })
              const seenMeta = new Set<string>()
              return items.filter((item) => {
                const t = String(item.text || '')
                if (t === '지반고' || t === '절단면' || t.startsWith('옆면')) {
                  if (seenMeta.has(t)) return false
                  seenMeta.add(t)
                  return true
                }
                return false
              })
            },
          },
        },
        datalabels: { display: false },
        tooltip: {
          filter: (item) => String(item.dataset.label || '') !== '절단면',
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: ${Number(ctx.parsed.x).toFixed(2)}m / EL ${Number(ctx.parsed.y).toFixed(2)}`,
          },
        },
        annotation: {
          clip: false,
          annotations: {
            cutCenterLabel: {
              type: 'label',
              xValue: cutX,
              yValue: ymax,
              content: `절단면(${cutLen}m)`,
              color: '#c2410c',
              font: { size: 10, weight: '600' },
              backgroundColor: 'rgba(255,255,255,0.92)',
              padding: { top: 2, bottom: 2, left: 4, right: 4 },
              borderRadius: 2,
              position: { x: 'center', y: 'start' },
              yAdjust: -4,
              drawTime: 'afterDatasets',
              clip: false,
            },
          } as Record<string, object>,
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: 0,
          max: len,
          title: { display: true, text: '깊이축 (m)', font: { size: 11 } },
          ticks: { font: { size: 10 } },
          grid: { color: '#e2e8f0' },
        },
        y: {
          type: 'linear',
          min: ymin,
          max: ymax,
          title: { display: true, text: '표고 (m)', font: { size: 11 } },
          ticks: { font: { size: 10 } },
          grid: { color: '#e2e8f0' },
        },
      },
    }
  }, [elevRange, len, pipeLegendLabels])

  if (!ground.length) {
    return (
      <p className="py-10 text-center text-[12px] text-muted-foreground">
        등고 지반고를 읽지 못했습니다. 절단선을 다시 그려 주세요.
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded border-2 border-[#787878] bg-white p-2">
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <div style={{ height: 300 }}>
            <Line
              data={chartData}
              options={options}
              plugins={[insetSyncPlugin]}
            />
          </div>
          {rolesPresent.length > 0 ? (
            <SupplyAreaGanttChart
              bands={supplyAreaBands}
              totalLengthM={len}
              plotInset={plotInset}
            />
          ) : null}
        </div>
        {pipeLegendGroups.length > 0 ? (
          <div
            className="w-[148px] shrink-0 overflow-y-auto rounded border border-[#cbd5e1] bg-[#f8fafc] p-1.5"
            style={{ maxHeight: 300 }}
            title="관로 범례"
          >
            <div className="space-y-2">
              {pipeLegendGroups.map((g) => (
                <div key={g.layerName}>
                  <div
                    className="truncate text-[10px] font-semibold text-[#334155]"
                    title={g.layerName}
                  >
                    {g.layerName}
                  </div>
                  <ul className="mt-0.5 space-y-0.5">
                    {g.items.map((it) => (
                      <li
                        key={it.key}
                        className="flex min-w-0 items-center gap-1 text-[10px] text-[#334155]"
                        title={it.label}
                      >
                        <span
                          className="inline-block h-2 w-2 shrink-0 rounded-full border border-white"
                          style={{ backgroundColor: it.color }}
                          aria-hidden
                        />
                        <span className="truncate">{it.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function WtlNetworkSectionChart({
  mode,
  ground = [],
  groundMin = [],
  groundMax = [],
  features,
  totalLengthM,
  supplyAreaBands = [],
}: {
  mode: 'crossChart' | 'longChart'
  ground?: SectionGroundPt[]
  groundMin?: SectionGroundPt[]
  groundMax?: SectionGroundPt[]
  features: SectionFeatureMark[]
  totalLengthM: number
  supplyAreaBands?: SectionSupplyBandSegment[]
}) {
  if (mode === 'crossChart') {
    return (
      <CrossSectionChart
        ground={ground}
        features={features}
        totalLengthM={totalLengthM}
        supplyAreaBands={supplyAreaBands}
      />
    )
  }
  return (
    <LongSectionChart
      ground={ground}
      groundMin={groundMin}
      groundMax={groundMax}
      features={features}
      totalLengthM={totalLengthM}
      supplyAreaBands={supplyAreaBands}
    />
  )
}
