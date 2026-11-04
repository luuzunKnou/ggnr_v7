'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Chart as ChartJS,
  LinearScale,
  CategoryScale,
  PointElement,
  LineElement,
  LineController,
  ScatterController,
  BubbleController,
  BarElement,
  BarController,
  Tooltip,
  Legend,
  Filler,
  type ChartData,
  type ChartOptions,
  type Plugin,
} from 'chart.js'
import { Bar, Chart } from 'react-chartjs-2'
import annotationPlugin from 'chartjs-plugin-annotation'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import type {
  SectionFeatureMark,
  SectionGroundPt,
  SectionSupplyBandSegment,
} from './wtlNetworkSectionSvg'
import {
  pointRadiusFromMarkSize,
  strokeFillAlpha,
  styleForFeature,
} from './useWtlSectionLayerStyles'
import {
  legendLabelByFeatureId,
  SectionFeatureLegendPanel,
  useSectionFeatureLegend,
} from './wtlNetworkSectionLegend'
import { WtlNetworkLongSupplyElevCharts } from './wtlNetworkSectionLongSupplyCharts'

ChartJS.register(
  LinearScale,
  CategoryScale,
  PointElement,
  LineElement,
  LineController,
  ScatterController,
  BubbleController,
  BarElement,
  BarController,
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
  gap: 5,
  point: 10,
  line: 20,
  ground: 30,
  polygon: 40,
} as const

/** SVG SectionCutLine 과 동일 */
const SECTION_CUT_COLOR = '#FF9100'
/** 거리(시설 간) — 절단면과 동일 점선·끝캡 (밝은 회색) */
const FACILITY_GAP_COLOR = '#6b7280'
const GAP_LEGEND_LABEL = '거리'

function isGapDatasetLabel(label: string): boolean {
  return label === GAP_LEGEND_LABEL
}

type SectionTipRaw = {
  label?: string
  layerName?: string
  fill?: string
  stroke?: string
  legendSrc?: string
}

function escapeHtmlTip(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Canvas 툴팁은 SVG Image pointStyle·투명색을 못 그림 → HTML 외부 툴팁 */
function sectionChartExternalTooltip(context: {
  chart: ChartJS
  tooltip: {
    opacity: number
    caretX: number
    caretY: number
    body?: { lines: string[] }[]
    dataPoints?: { raw?: unknown; dataset: { borderColor?: unknown; backgroundColor?: unknown } }[]
  }
}) {
  const { chart, tooltip } = context
  const parent = chart.canvas.parentNode as HTMLElement | null
  if (!parent) return
  if (getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative'
  }

  let el = parent.querySelector(':scope > .wtl-sec-tip') as HTMLDivElement | null
  if (!el) {
    el = document.createElement('div')
    el.className = 'wtl-sec-tip'
    el.setAttribute('role', 'tooltip')
    el.style.cssText = [
      'position:absolute',
      'pointer-events:none',
      'z-index:30',
      'opacity:0',
      'transition:opacity .08s ease',
      'background:rgba(15,23,42,0.92)',
      'color:#f8fafc',
      'border-radius:4px',
      'padding:6px 8px',
      'font:11px/1.35 sans-serif',
      'max-width:260px',
      'box-shadow:0 4px 12px rgba(0,0,0,0.18)',
      'white-space:nowrap',
    ].join(';')
    parent.appendChild(el)
  }

  if (tooltip.opacity === 0 || !tooltip.body?.length) {
    el.style.opacity = '0'
    return
  }

  const dp = tooltip.dataPoints?.[0]
  const raw = (dp?.raw ?? {}) as SectionTipRaw
  const bodyText = (tooltip.body ?? [])
    .flatMap((b) => b.lines)
    .map(escapeHtmlTip)
    .join('<br/>')

  let swatch = ''
  const src = String(raw.legendSrc ?? '').trim()
  if (src) {
    swatch = `<img src="${escapeHtmlTip(src)}" alt="" width="16" height="16" style="display:block;width:16px;height:16px;object-fit:contain;background:#fff;border-radius:2px;flex-shrink:0" />`
  } else {
    const fromDs = (v: unknown): string =>
      typeof v === 'string' && v && !v.startsWith('rgba(0,0,0,0)') ? v : ''
    const c =
      String(raw.stroke || raw.fill || '').trim() ||
      fromDs(dp?.dataset.borderColor) ||
      fromDs(dp?.dataset.backgroundColor) ||
      '#94a3b8'
    swatch = `<span style="display:block;width:10px;height:10px;margin:3px 0;border-radius:9999px;background:${escapeHtmlTip(c)};flex-shrink:0"></span>`
  }

  el.innerHTML = `<div style="display:flex;align-items:flex-start;gap:6px">${swatch}<div>${bodyText}</div></div>`
  el.style.opacity = '1'
  el.style.left = `${tooltip.caretX}px`
  el.style.top = `${tooltip.caretY}px`
  el.style.transform = 'translate(-50%, calc(-100% - 10px))'
}

/**
 * 거리 가로선은 단일 line dataset.
 * 끝캡(|)·구간 라벨은 플러그인으로 그려 애니메이션이 갈라지지 않게 함.
 */
function createGapDecorPlugin(
  pts: { distM: number }[],
  gapY: number,
  tickHData: number
): Plugin {
  return {
    id: 'wtlGapDecor',
    afterDatasetsDraw(chart) {
      const gapIdx = chart.data.datasets.findIndex(
        (d) => String(d.label || '') === GAP_LEGEND_LABEL
      )
      if (gapIdx < 0 || !chart.isDatasetVisible(gapIdx)) return
      if (pts.length < 2) return
      const xScale = chart.scales.x
      const yScale = chart.scales.y
      if (!xScale || !yScale) return

      const ctx = chart.ctx
      const y = yScale.getPixelForValue(gapY)
      const tickPx = Math.max(
        3,
        Math.abs(yScale.getPixelForValue(gapY + tickHData) - y)
      )

      ctx.save()
      ctx.strokeStyle = FACILITY_GAP_COLOR
      ctx.lineWidth = 1.5
      ctx.lineCap = 'square'
      ctx.setLineDash([])
      for (const p of pts) {
        const x = xScale.getPixelForValue(p.distM)
        if (!Number.isFinite(x)) continue
        ctx.beginPath()
        ctx.moveTo(x, y - tickPx)
        ctx.lineTo(x, y + tickPx)
        ctx.stroke()
      }

      ctx.font = '600 9px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!
        const b = pts[i]!
        const gap = b.distM - a.distM
        if (!(gap > 0.01)) continue
        const mx = xScale.getPixelForValue((a.distM + b.distM) / 2)
        if (!Number.isFinite(mx)) continue
        const text = `${formatLenLabelM(gap)} m`
        const tw = ctx.measureText(text).width
        const padX = 3
        const boxH = 12
        const ty = y - 4
        ctx.fillStyle = 'rgba(255,255,255,0.92)'
        ctx.fillRect(mx - tw / 2 - padX, ty - boxH + 2, tw + padX * 2, boxH)
        ctx.fillStyle = FACILITY_GAP_COLOR
        ctx.fillText(text, mx, ty)
      }
      ctx.restore()
    },
  }
}

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
const AXIS_LABEL_NEAR_FRAC = 0.12

/** 한글·전각을 넓게 잡아 X축 라벨 충돌 폭 추정 */
function axisLabelDisplayUnits(text: string): number {
  let w = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    w +=
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xff00 && c <= 0xffef)
        ? 2
        : 1
  }
  return w
}

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
    const maxUnits = Math.max(
      ...stack.lines.map((l) => axisLabelDisplayUnits(l.text)),
      2
    )
    // 표시 폭 단위당 ~0.9% — 한글 라벨이 이웃과 겹치지 않게
    const half = Math.max(halfNear, maxUnits * 0.009)
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
  // 라벨 스택 + 간격 + 절단면 선·끝캡·라벨 (잘림 방지 여유)
  return AXIS_LABEL_TOP + Math.max(1, maxLines) * AXIS_LABEL_LINE_H + 8 + 5 + 22
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
        t === GAP_LEGEND_LABEL ||
        t.startsWith('옆면') ||
        t.startsWith('격자')
      ) {
        return { ...item, pointStyle: 'line' as const }
      }
      return item
    })
}

type CrossAxisFooterState = {
  /** 표시 중인 피처만 — 범례 숨김 반영 */
  placed: PlacedAxisStack[]
  /** 높이 고정용 (전체 기준 행 수) */
  maxRows: number
  cutLen: string
}

/**
 * 횡단 X축 바깥 하단:
 * 1) 위치별 라벨(겹치면 세로 이동, 스택 내 관로→시설)
 * 2) 그 아래 절단면 점선
 * stateRef로 최신 placed를 읽어, 플러그인 재등록 없이도 범례 숨김이 반영됨.
 */
function createCrossAxisFooterPlugin(
  stateRef: { current: CrossAxisFooterState }
): Plugin {
  return {
    id: 'wtlCrossAxisFooter',
    afterDraw(chart) {
      const { placed, maxRows, cutLen } = stateRef.current
      const xScale = chart.scales.x
      if (!xScale) return
      const { ctx, chartArea } = chart
      const x1 = xScale.getPixelForValue(xScale.min ?? 0)
      const x2 = xScale.getPixelForValue(xScale.max ?? 0)
      if (!Number.isFinite(x1) || !Number.isFinite(x2)) return

      ctx.save()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = '#1e293b'
      ctx.font = '600 10px sans-serif'
      for (const stack of placed) {
        const x = xScale.getPixelForValue(stack.distM)
        if (!Number.isFinite(x)) continue
        stack.lines.forEach((line, i) => {
          const row = stack.baseRow + i
          ctx.fillText(
            line.text,
            x,
            chartArea.bottom + AXIS_LABEL_TOP + row * AXIS_LABEL_LINE_H
          )
        })
      }

      const cutY =
        chartArea.bottom + AXIS_LABEL_TOP + maxRows * AXIS_LABEL_LINE_H + 8
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
 * 급수구역·분구·블록 — Chart.js 가로 누적 막대.
 * 행별 구성 비율(합=100%)로 쌓아 끝 공백·중간 갭 없이 표시.
 * plotInset으로 상단 단면도 plot 영역과 막대 시작을 맞춤.
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

  const len = Math.max(totalLengthM, 0.01)

  const { data } = useMemo((): {
    data: ChartData<'bar'>
  } => {
    if (!roles.length) {
      return { data: { labels: [], datasets: [] } }
    }
    const labels = roles.map((r) => r.label)
    type StackSeg = {
      name: string
      color: string
      role: SectionSupplyBandSegment['role']
      lengthM: number
    }
    const stackSegs: StackSeg[] = []
    const roleSum = new Map<SectionSupplyBandSegment['role'], number>()
    for (const row of roles) {
      const segs = bands
        .filter((b) => b.role === row.role)
        .slice()
        .sort((a, b) => a.fromM - b.fromM || a.toM - b.toM)
      let sum = 0
      segs.forEach((seg) => {
        const lengthM = Math.max(
          0,
          Math.min(len, Math.max(seg.fromM, seg.toM)) -
            Math.max(0, Math.min(seg.fromM, seg.toM))
        )
        if (!(lengthM > 0.01)) return
        sum += lengthM
        stackSegs.push({
          name: seg.name,
          color: normalizeStroke(seg.color),
          role: row.role,
          lengthM,
        })
      })
      roleSum.set(row.role, sum)
    }
    return {
      data: {
        labels,
        datasets: stackSegs.map((seg) => {
          const sum = roleSum.get(seg.role) || 0
          const pct = sum > 0 ? (seg.lengthM / sum) * 100 : 0
          return {
            label: seg.name,
            data: roles.map((r) => (r.role === seg.role ? pct : 0)),
            backgroundColor: `${seg.color}8c`,
            borderColor: seg.color,
            borderWidth: 1,
            barThickness: 14,
            stack: 'supply',
          }
        }),
      },
    }
  }, [bands, roles, len])

  const options = useMemo((): ChartOptions<'bar'> => {
    const yLabelW = 36
    return {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: {
        padding: {
          left: Math.max(0, plotInset.left - yLabelW),
          right: 0,
          top: 2,
          bottom: 2,
        },
      },
      datasets: {
        bar: {
          categoryPercentage: 1,
          barPercentage: 0.92,
        },
      },
      plugins: {
        legend: { display: false },
        datalabels: {
          color: '#1e293b',
          font: { size: 9, weight: 600 },
          clamp: true,
          formatter: (v, ctx) => {
            const n = Number(v)
            if (!(n >= 4)) return ''
            return String(ctx.dataset.label || '')
          },
        },
        tooltip: { enabled: false },
      },
      scales: {
        x: {
          stacked: true,
          min: 0,
          max: 100,
          display: false,
          grid: { display: false },
          border: { display: false },
        },
        y: {
          stacked: true,
          grid: { display: false },
          border: { display: false },
          ticks: {
            font: { size: 10, weight: 'bold' },
            color: '#3d5560',
            padding: 4,
          },
        },
      },
    }
  }, [plotInset.left])

  if (!roles.length) return null

  const height = Math.max(44, roles.length * 22 + 8)

  return (
    <div
      className="mt-0.5 overflow-hidden bg-transparent"
      style={{ height, marginRight: plotInset.right }}
      role="img"
      aria-label="급수구역·분구·블록"
    >
      <Bar data={data} options={options} />
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
  const { plotInset, insetSyncPlugin } = usePlotInsetSync()
  const {
    stylesByKey,
    styleRevision,
    hiddenKeys,
    featureLegendGroups,
    visibleFeatures,
    toggleLegendItem,
    toggleLegendLayer,
  } = useSectionFeatureLegend(features)
  const pipes = visibleFeatures.filter((f) => f.kind === 'pipe')
  const points = visibleFeatures.filter((f) => f.kind === 'point')
  /** 높이 고정용 — 전체 feature 기준 (체크 토글과 무관) */
  const allPipes = useMemo(
    () => features.filter((f) => f.kind === 'pipe'),
    [features]
  )
  const allPoints = useMemo(
    () => features.filter((f) => f.kind === 'point'),
    [features]
  )
  const xmaxForLayout = Math.max(
    totalLengthM,
    ground[ground.length - 1]?.distM ?? 0,
    0.01
  )
  const fullAxisLayout = useMemo(
    () =>
      layoutAxisStacksAvoidOverlap(
        buildAxisLabelStacks(features),
        xmaxForLayout
      ),
    [features, xmaxForLayout]
  )
  const axisLayout = useMemo(
    () =>
      layoutAxisStacksAvoidOverlap(
        buildAxisLabelStacks(visibleFeatures),
        xmaxForLayout
      ),
    [visibleFeatures, xmaxForLayout]
  )
  const axisMarks = useMemo(
    (): AxisMark[] =>
      axisLayout.placed.map((s) => ({
        distM: s.distM,
        label: s.lines.map((l) => l.text).join('/'),
      })),
    [axisLayout]
  )

  const featureLayerNames = useMemo(
    () => new Set([...groupFeaturesByLayer(features).keys()]),
    [features]
  )

  const elevBounds = useMemo(() => {
    // 표고·하단 패딩은 전체 데이터 기준 → 체크 토글 시 박스 높이/축 흔들림 방지
    const elevs = ground.map((g) => g.elevM)
    for (const p of allPipes) {
      const surf = p.surfaceElevM ?? groundElevAt(ground, p.distM)
      if (surf != null) elevs.push(surf - (Number(p.depthM) || 0), surf)
    }
    for (const p of allPoints) {
      const surf = p.surfaceElevM ?? groundElevAt(ground, p.distM)
      if (surf != null) elevs.push(surf)
    }
    const dataMin = elevs.length ? Math.min(...elevs) : 0
    const dataMax = elevs.length ? Math.max(...elevs) : 10
    const span = Math.max(0.5, dataMax - dataMin)
    // 상단: 거리 라인(지반고 위) 여유 / 하단은 관 심도만
    const gapPad = Math.max(0.55, span * 0.12)
    const ymin = dataMin - 0.5
    const ymax = dataMax + gapPad
    const xmax = xmaxForLayout
    const gapY = dataMax + gapPad * 0.45
    return {
      ymin,
      ymax,
      xmax,
      span: ymax - ymin,
      gapY,
      tickH: Math.max(0.08, (ymax - ymin) * 0.025),
      cutLen: formatLenLabelM(xmax),
      bottomPad: crossFooterBottomPad(fullAxisLayout.maxRows),
      footerRows: fullAxisLayout.maxRows,
    }
  }, [ground, allPipes, allPoints, xmaxForLayout, fullAxisLayout.maxRows])

  const axisFooterStateRef = useRef<CrossAxisFooterState>({
    placed: [],
    maxRows: 1,
    cutLen: '',
  })
  axisFooterStateRef.current = {
    placed: axisLayout.placed,
    maxRows: elevBounds.footerRows,
    cutLen: elevBounds.cutLen,
  }
  const axisFooterPlugin = useMemo(
    () => createCrossAxisFooterPlugin(axisFooterStateRef),
    []
  )

  /** 그래프상 point(관·시설) 전부 — 거리순 (동일 거리 병합) */
  const facilityGapPts = useMemo(() => {
    const sorted = [...pipes, ...points]
      .filter((p) => Number.isFinite(p.distM))
      .sort((a, b) => a.distM - b.distM)
    const out: { distM: number }[] = []
    for (const p of sorted) {
      const last = out[out.length - 1]
      if (last && Math.abs(last.distM - p.distM) < 0.05) continue
      out.push({ distM: p.distM })
    }
    return out
  }, [pipes, points])

  const gapTickH = Math.max(0.03, elevBounds.span * 0.01)
  const gapDecorPlugin = useMemo(
    () => createGapDecorPlugin(facilityGapPts, elevBounds.gapY, gapTickH),
    [facilityGapPts, elevBounds.gapY, gapTickH]
  )

  const chartData = useMemo((): ChartData => {
    const { gapY } = elevBounds
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
        pointHoverRadius: 4,
        pointHitRadius: 12,
        tension: 0.15,
        borderWidth: 1.5,
        order: CHART_Z.ground,
      },
    ]

    // LINE(관) — SLD는 색만, 크기(관경)·두께는 기존
    for (const [layerName, group] of groupFeaturesByLayer(pipes)) {
      const pipePts = group.map((p) => {
        const surf = p.surfaceElevM ?? groundElevAt(ground, p.distM) ?? 0
        const elev = surf - (Number(p.depthM) || 0)
        const st = styleForFeature(stylesByKey, p)
        const color = st?.strokeColor ?? normalizeStroke(p.color)
        return {
          x: p.distM,
          y: elev,
          r: bubbleRadiusPx(p.diameterM),
          label: (p.label || '').trim(),
          color,
          fill: color,
          stroke: color,
        }
      })
      datasets.push({
        type: 'bubble' as const,
        label: layerName,
        data: pipePts,
        backgroundColor: pipePts.map((p) => strokeFillAlpha(p.color)),
        borderColor: pipePts.map((p) => p.color),
        borderWidth: 1.5,
        pointStyle: 'circle',
        order: CHART_Z.line,
      })
    }

    // POINT(시설) — 피처별 styleCode 조건 SVG / 없으면 Mark 채움·테두리
    for (const [layerName, group] of groupFeaturesByLayer(points)) {
      const pointPts = group.map((p) => {
        const surf = p.surfaceElevM ?? groundElevAt(ground, p.distM) ?? 0
        const st = styleForFeature(stylesByKey, p)
        return {
          x: p.distM,
          y: surf,
          label: (p.label || '').trim(),
          fill: st?.fillColor ?? normalizeStroke(p.color),
          stroke: st?.strokeColor ?? normalizeStroke(p.color),
          legendSrc: st?.legendSrc || '',
          symbolImg: st?.symbolImg ?? null,
          markSize: st?.markSize,
          strokeWidth: st?.strokeWidth ?? 1.5,
        }
      })
      datasets.push({
        type: 'scatter' as const,
        label: layerName,
        data: pointPts,
        backgroundColor: pointPts.map((p) =>
          p.symbolImg ? 'rgba(0,0,0,0)' : p.fill
        ),
        borderColor: pointPts.map((p) =>
          p.symbolImg ? 'rgba(0,0,0,0)' : p.stroke
        ),
        borderWidth: pointPts.map((p) => (p.symbolImg ? 0 : p.strokeWidth)),
        pointRadius: pointPts.map((p) =>
          p.symbolImg ? pointRadiusFromMarkSize(p.markSize) : 5
        ),
        pointHoverRadius: pointPts.map((p) =>
          p.symbolImg ? pointRadiusFromMarkSize(p.markSize) + 1 : 6
        ),
        pointHitRadius: 12,
        pointStyle: pointPts.map((p) => p.symbolImg ?? ('circle' as const)),
        order: CHART_Z.point,
      })
    }

    // 거리 — 단일 line (끝캡·구간라벨은 gapDecorPlugin)
    if (facilityGapPts.length >= 2) {
      datasets.push({
        type: 'line' as const,
        label: GAP_LEGEND_LABEL,
        data: facilityGapPts.map((p) => ({ x: p.distM, y: gapY })),
        borderColor: FACILITY_GAP_COLOR,
        backgroundColor: FACILITY_GAP_COLOR,
        borderDash: [6, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 0,
        pointHitRadius: 8,
        fill: false,
        tension: 0,
        order: CHART_Z.gap,
      })
    }

    return { datasets }
  }, [ground, pipes, points, elevBounds, facilityGapPts, stylesByKey, styleRevision])

  const options = useMemo((): ChartOptions => {
    const { ymin, ymax, xmax, bottomPad } = elevBounds

    type MarkPt = { label?: string; color?: string; x?: number; y?: number }

    return {
      responsive: true,
      maintainAspectRatio: false,
      // 체크박스 토글 시 거리 선·끝캡이 따로 출렁이지 않도록
      animation: false,
      layout: {
        padding: { top: 8, bottom: bottomPad },
      },
      interaction: {
        mode: 'nearest',
        intersect: false,
        axis: 'xy',
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            font: { size: 11 },
            boxWidth: 12,
            usePointStyle: true,
            generateLabels: (chart) =>
              buildSectionLegendLabels(chart, {
                pipeLabels: featureLayerNames,
                hide: (t) => featureLayerNames.has(t),
              }),
          },
        },
        datalabels: {
          display: false,
        },
        tooltip: {
          enabled: false,
          external: sectionChartExternalTooltip,
          mode: 'nearest',
          intersect: false,
          filter: (item) => !isGapDatasetLabel(String(item.dataset.label || '')),
          callbacks: {
            title: () => '',
            label: (ctx) => {
              const raw = ctx.raw as MarkPt | undefined
              const legend = String(ctx.dataset.label || '')
              if (legend === '지반고') return ['범례: 지반고']
              const featureLabel = String(raw?.label ?? '').trim() || '—'
              return [`범례: ${legend}`, `라벨: ${featureLabel}`]
            },
          },
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
  }, [elevBounds, axisMarks, featureLayerNames])

  if (!ground.length) {
    return (
      <p className="py-10 text-center text-[12px] text-muted-foreground">
        등고 지반고를 읽지 못했습니다. 절단선을 다시 그려 주세요.
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded border-2 border-[#b0bcc8] bg-white p-2">
      <div className="flex items-stretch gap-2">
        <div className="min-w-0 flex-1">
          <div
            className="relative z-[2]"
            style={{
              height: 420 + elevBounds.bottomPad,
              minHeight: 420 + elevBounds.bottomPad,
            }}
          >
            <Chart
              type="scatter"
              data={chartData}
              options={options}
              plugins={[axisFooterPlugin, gapDecorPlugin, insetSyncPlugin]}
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
        <SectionFeatureLegendPanel
          groups={featureLegendGroups}
          stylesByKey={stylesByKey}
          hiddenKeys={hiddenKeys}
          onToggleItem={toggleLegendItem}
          onToggleLayer={toggleLegendLayer}
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
  supplyElevComposition = [],
}: {
  ground: SectionGroundPt[]
  groundMin: SectionGroundPt[]
  groundMax: SectionGroundPt[]
  features: SectionFeatureMark[]
  totalLengthM: number
  supplyAreaBands: SectionSupplyBandSegment[]
  supplyElevComposition?: import('./useWtlNetworkSection').SectionSupplyElevRow[]
}) {
  const {
    stylesByKey,
    styleRevision,
    hiddenKeys,
    featureLegendGroups,
    visibleFeatures,
    toggleLegendItem,
    toggleLegendLayer,
  } = useSectionFeatureLegend(features)
  const labelById = useMemo(
    () => legendLabelByFeatureId(featureLegendGroups),
    [featureLegendGroups]
  )
  const featureLegendLabels = useMemo(() => {
    const set = new Set<string>()
    for (const g of featureLegendGroups) {
      for (const it of g.items) set.add(it.label)
    }
    return set
  }, [featureLegendGroups])
  const pipes = useMemo(
    () => visibleFeatures.filter((f) => f.kind === 'pipe'),
    [visibleFeatures]
  )
  const points = useMemo(
    () => visibleFeatures.filter((f) => f.kind === 'point'),
    [visibleFeatures]
  )
  const len = Math.max(totalLengthM, ground[ground.length - 1]?.distM ?? 0, 0.01)

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
    for (const p of points) {
      const surf = p.surfaceElevM ?? groundElevAt(ground, p.distM)
      if (surf != null) elevs.push(surf)
    }
    const dataMin = elevs.length ? Math.min(...elevs) : 0
    const dataMax = elevs.length ? Math.max(...elevs) : 10
    return {
      ymin: dataMin - 0.35,
      ymax: dataMax + 0.35,
      dataMin,
    }
  }, [ground, groundMin, groundMax, pipes, points])

  const chartData = useMemo((): ChartData => {
    const { ymin, ymax } = elevRange
    const cutX = len / 2
    const datasets: ChartData['datasets'] = [
      {
        type: 'line' as const,
        label: '지반고',
        data: ground.map((g) => ({ x: g.distM, y: g.elevM })),
        borderColor: '#787878',
        backgroundColor: 'rgba(180, 180, 180, 0.12)',
        fill: false,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 12,
        tension: 0.12,
        borderWidth: 1.8,
        order: CHART_Z.ground,
      },
      // 절단면 = 깊이축 중심 수직선 (SVG long 과 동일)
      {
        type: 'line' as const,
        label: '절단면',
        data: [
          { x: cutX, y: ymin },
          { x: cutX, y: ymax },
        ],
        borderColor: SECTION_CUT_COLOR,
        borderDash: [6, 4],
        borderWidth: 1.8,
        pointRadius: 0,
        pointHitRadius: 0,
        fill: false,
        tension: 0,
        order: CHART_Z.cut,
      },
    ]
    if (groundMax.length) {
      datasets.push({
        type: 'line' as const,
        label: '옆면 최고 지반고',
        data: groundMax.map((g) => ({ x: g.distM, y: g.elevM })),
        borderColor: '#94a3b8',
        borderDash: [4, 3],
        pointRadius: 0,
        pointHoverRadius: 3,
        pointHitRadius: 10,
        fill: false,
        borderWidth: 1,
        order: CHART_Z.polygon,
      })
    }
    if (groundMin.length) {
      datasets.push({
        type: 'line' as const,
        label: '옆면 최저 지반고',
        data: groundMin.map((g) => ({ x: g.distM, y: g.elevM })),
        borderColor: '#cbd5e1',
        borderDash: [4, 3],
        pointRadius: 0,
        pointHoverRadius: 3,
        pointHitRadius: 10,
        fill: false,
        borderWidth: 1,
        order: CHART_Z.polygon,
      })
    }
    // 관로·점시설 — 켜진 레이어 전부 (범례는 우측 HTML)
    for (const p of pipes) {
      const legendName = labelById.get(p.id) || layerLegendName(p)
      const layerName = layerLegendName(p)
      const featureLabel = (p.label || '').trim() || legendName
      const st = styleForFeature(stylesByKey, p)
      const color = st?.strokeColor ?? normalizeStroke(p.color)
      const from = Math.max(0, p.spanFromM ?? p.distM - 0.5)
      const to = Math.min(len, p.spanToM ?? p.distM + 0.5)
      const dep = Number(p.depthM) || 0
      type LongMarkPt = {
        x: number
        y: number
        label?: string
        layerName?: string
        fill?: string
        stroke?: string
      }
      const pts: LongMarkPt[] = []
      for (const g of ground) {
        if (g.distM < from - 0.01 || g.distM > to + 0.01) continue
        pts.push({
          x: g.distM,
          y: g.elevM - dep,
          label: featureLabel,
          layerName,
          fill: color,
          stroke: color,
        })
      }
      if (pts.length < 2) {
        const s0 = groundElevAt(ground, from) ?? 0
        const s1 = groundElevAt(ground, to) ?? 0
        pts.push(
          {
            x: from,
            y: s0 - dep,
            label: featureLabel,
            layerName,
            fill: color,
            stroke: color,
          },
          {
            x: to,
            y: s1 - dep,
            label: featureLabel,
            layerName,
            fill: color,
            stroke: color,
          }
        )
      }
      datasets.push({
        type: 'line' as const,
        label: legendName,
        data: pts,
        borderColor: color,
        backgroundColor: color,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 12,
        borderWidth: 2.2,
        fill: false,
        order: CHART_Z.line,
      })
    }
    for (const p of points) {
      const legendName = labelById.get(p.id) || layerLegendName(p)
      const layerName = layerLegendName(p)
      const st = styleForFeature(stylesByKey, p)
      const symbolImg = st?.symbolImg ?? null
      const fill = st?.fillColor ?? normalizeStroke(p.color)
      const stroke = st?.strokeColor ?? normalizeStroke(p.color)
      const surf = p.surfaceElevM ?? groundElevAt(ground, p.distM) ?? 0
      datasets.push({
        type: 'scatter' as const,
        label: legendName,
        data: [
          {
            x: p.distM,
            y: surf,
            label: (p.label || '').trim(),
            layerName,
            fill,
            stroke,
            legendSrc: st?.legendSrc || '',
          } as {
            x: number
            y: number
            label?: string
            layerName?: string
            fill?: string
            stroke?: string
            legendSrc?: string
          },
        ],
        backgroundColor: symbolImg ? 'rgba(0,0,0,0)' : fill,
        borderColor: symbolImg ? 'rgba(0,0,0,0)' : stroke,
        borderWidth: symbolImg ? 0 : st?.strokeWidth ?? 1.5,
        pointRadius: symbolImg ? pointRadiusFromMarkSize(st?.markSize) : 5,
        pointHoverRadius: symbolImg
          ? pointRadiusFromMarkSize(st?.markSize) + 1
          : 6,
        pointHitRadius: 12,
        pointStyle: symbolImg ?? ('circle' as const),
        order: CHART_Z.point,
      })
    }
    return { datasets }
  }, [
    ground,
    groundMin,
    groundMax,
    pipes,
    points,
    len,
    elevRange,
    stylesByKey,
    styleRevision,
    labelById,
  ])

  const options = useMemo((): ChartOptions => {
    const { ymin, ymax } = elevRange
    const cutLen = formatLenLabelM(len)
    const cutX = len / 2
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { left: 8, top: 22 } },
      interaction: {
        mode: 'nearest',
        intersect: false,
        axis: 'x',
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            font: { size: 10 },
            boxWidth: 10,
            usePointStyle: true,
            generateLabels: (chart) => {
              const items = buildSectionLegendLabels(chart, {
                pipeLabels: featureLegendLabels,
                hide: (t) => featureLegendLabels.has(t),
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
          enabled: false,
          external: sectionChartExternalTooltip,
          mode: 'nearest',
          intersect: false,
          filter: (item) => String(item.dataset.label || '') !== '절단면',
          callbacks: {
            title: () => '',
            label: (ctx) => {
              const name = String(ctx.dataset.label || '')
              const y = Number(ctx.parsed.y)
              if (name === '지반고') return ['범례: 지반고']
              if (name.startsWith('옆면')) return [`범례: ${name}`]
              if (featureLegendLabels.has(name)) {
                const raw = ctx.raw as
                  | { label?: string; layerName?: string }
                  | undefined
                const layerName = String(raw?.layerName ?? '').trim() || name
                const featureLabel = String(raw?.label ?? '').trim() || name
                return [`범례: ${layerName}`, `라벨: ${featureLabel}`]
              }
              return `${name}  EL ${y.toFixed(2)} m`
            },
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
  }, [elevRange, len, featureLegendLabels])

  if (!ground.length) {
    return (
      <p className="py-10 text-center text-[12px] text-muted-foreground">
        등고 지반고를 읽지 못했습니다. 절단선을 다시 그려 주세요.
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded border-2 border-[#b0bcc8] bg-white p-2">
      <div className="flex items-stretch gap-2">
        <div className="min-w-0 flex-1">
          <div
            className="relative z-[2]"
            style={{ height: 420, minHeight: 420 }}
          >
            <Chart type="scatter" data={chartData} options={options} />
          </div>
          <WtlNetworkLongSupplyElevCharts
            ground={ground}
            groundMin={groundMin}
            groundMax={groundMax}
            supplyAreaBands={supplyAreaBands}
            supplyElevComposition={supplyElevComposition}
            totalLengthM={len}
          />
        </div>
        <SectionFeatureLegendPanel
          groups={featureLegendGroups}
          stylesByKey={stylesByKey}
          hiddenKeys={hiddenKeys}
          onToggleItem={toggleLegendItem}
          onToggleLayer={toggleLegendLayer}
        />
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
  supplyElevComposition = [],
}: {
  mode: 'crossChart' | 'longChart'
  ground?: SectionGroundPt[]
  groundMin?: SectionGroundPt[]
  groundMax?: SectionGroundPt[]
  features: SectionFeatureMark[]
  totalLengthM: number
  supplyAreaBands?: SectionSupplyBandSegment[]
  supplyElevComposition?: import('./useWtlNetworkSection').SectionSupplyElevRow[]
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
      supplyElevComposition={supplyElevComposition}
    />
  )
}
