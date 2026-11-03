'use client'

import { useMemo } from 'react'
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
} from 'chart.js'
import { Chart, Line } from 'react-chartjs-2'
import annotationPlugin from 'chartjs-plugin-annotation'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import type {
  SectionFeatureMark,
  SectionGroundPt,
  SectionSupplyBandSegment,
} from './wtlNetworkSectionSvg'
import { WtlNetworkLongSupplyElevCharts } from './wtlNetworkSectionLongSupplyCharts'

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
  point: 10,
  line: 20,
  ground: 30,
  polygon: 40,
} as const

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

/** 횡단 차트 X축 — 시설 위치별 라벨(거리 눈금 대신) */
function buildAxisMarks(features: SectionFeatureMark[]): AxisMark[] {
  const sorted = [...features]
    .map((f) => ({
      distM: f.distM,
      label: (f.label || f.layerKorName || '').trim(),
    }))
    .filter((m) => Number.isFinite(m.distM))
    .sort((a, b) => a.distM - b.distM)

  const out: AxisMark[] = []
  for (const m of sorted) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.distM - m.distM) < 0.05) {
      if (m.label && last.label !== m.label && !last.label.split('/').includes(m.label)) {
        last.label = last.label ? `${last.label}/${m.label}` : m.label
      }
      continue
    }
    out.push({ distM: m.distM, label: m.label || '' })
  }
  return out
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

/**
 * 급수구역·분구·블록 간트.
 * Chart.js bar floating은 다중 데이터셋 시 첫 행(구역) 두께·라벨이 깨져 HTML로 그림.
 * 상단 지형 차트 X축(0~totalLengthM)과 동일 비율.
 */
function SupplyAreaGanttChart({
  bands,
  totalLengthM,
  nested = false,
}: {
  bands: SectionSupplyBandSegment[]
  totalLengthM: number
  nested?: boolean
}) {
  const roles = useMemo(
    () => ROLE_ORDER.filter((r) => bands.some((b) => b.role === r.role)),
    [bands]
  )
  if (!roles.length) return null

  const len = Math.max(totalLengthM, 0.01)
  const pct = (m: number) => `${(Math.min(len, Math.max(0, m)) / len) * 100}%`

  return (
    <div
      className={
        nested
          ? 'mt-1 border-t border-[#e2e8f0] pt-2'
          : 'mt-2 rounded border border-[#c8c8c8] bg-white p-2'
      }
      role="img"
      aria-label="급수구역·분구·블록"
    >
      <div className="space-y-1">
        {roles.map((row) => {
          const segs = bands
            .filter((b) => b.role === row.role)
            .slice()
            .sort((a, b) => a.fromM - b.fromM || a.toM - b.toM)
          return (
            <div key={row.role} className="flex items-center gap-2">
              <div className="w-8 shrink-0 text-right text-[10px] font-semibold text-[#3d5560]">
                {row.label}
              </div>
              <div className="relative h-[18px] min-w-0 flex-1 rounded bg-[#f8fafc] ring-1 ring-[#e2e8f0]">
                {segs.map((seg, si) => {
                  const color = normalizeStroke(seg.color)
                  const left = pct(seg.fromM)
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
                      className="absolute top-[2px] flex h-[14px] items-center justify-center overflow-hidden rounded-sm border px-0.5"
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
            </div>
          )
        })}
      </div>
      {!nested ? (
        <div className="mt-1 flex justify-between pl-10 text-[10px] text-[#64748b]">
          <span>0</span>
          <span>{len.toFixed(0)} m</span>
        </div>
      ) : null}
    </div>
  )
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
  const axisMarks = useMemo(() => buildAxisMarks(features), [features])

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
    const elevs = ground.map((g) => g.elevM)
    for (const p of pipes) {
      const surf = p.surfaceElevM ?? groundElevAt(ground, p.distM)
      if (surf != null) elevs.push(surf - (Number(p.depthM) || 0), surf)
    }
    for (const p of points) {
      const surf = p.surfaceElevM ?? groundElevAt(ground, p.distM)
      if (surf != null) elevs.push(surf)
    }
    const ymin = elevs.length ? Math.min(...elevs) - 0.5 : 0
    const ymax = elevs.length ? Math.max(...elevs) + 0.5 : 10
    const xmax = Math.max(totalLengthM, ground[ground.length - 1]?.distM ?? 0, 0.01)
    const tickH = Math.max(0.08, (ymax - ymin) * 0.03)
    const cutLen = formatLenLabelM(xmax)

    type MarkPt = { label?: string; color?: string; x?: number; y?: number }
    const markAt = (ctx: { dataset: { type?: string; data: unknown[] }; dataIndex: number }) =>
      ctx.dataset.data[ctx.dataIndex] as MarkPt | undefined

    // 절단면·시설간 거리 — clip:false (차트 영역 밖 잘림 방지)
    const cutY = ymax - Math.max(0.05, (ymax - ymin) * 0.02)
    const gapY = ymin + Math.max(0.05, (ymax - ymin) * 0.04)
    const annotations: Record<string, object> = {
      cutPlane: {
        type: 'line',
        xMin: 0,
        xMax: xmax,
        yMin: cutY,
        yMax: cutY,
        borderColor: '#FF9100',
        borderWidth: 2,
        borderDash: [6, 4],
        drawTime: 'afterDatasets',
        clip: false,
        label: {
          display: true,
          content: `절단면(${cutLen}m)`,
          position: 'start',
          backgroundColor: 'rgba(255,145,0,0.18)',
          color: '#c2410c',
          font: { size: 10, weight: '600' },
          padding: { top: 2, bottom: 2, left: 4, right: 4 },
        },
      },
    }
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
      layout: {
        padding: { top: 22, bottom: axisMarks.length > 1 ? 18 : 4 },
      },
      plugins: {
        legend: {
          position: 'top',
          labels: { font: { size: 11 }, boxWidth: 12 },
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
            autoSkip: false,
            maxRotation: 40,
            minRotation: 0,
            font: { size: 10 },
            callback: (value) => {
              const v = typeof value === 'string' ? Number(value) : value
              const mark = axisMarks.find((m) => Math.abs(m.distM - v) < 0.05)
              return mark?.label || ''
            },
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
  }, [ground, pipes, points, totalLengthM, axisMarks])

  const cutLen = formatLenLabelM(
    Math.max(totalLengthM, ground[ground.length - 1]?.distM ?? 0, 0.01)
  )
  const gapRows = useMemo(() => {
    const rows: { key: string; text: string; leftPct: number; widthPct: number }[] = []
    const xmax = Math.max(totalLengthM, ground[ground.length - 1]?.distM ?? 0, 0.01)
    for (let i = 1; i < axisMarks.length; i++) {
      const a = axisMarks[i - 1]!
      const b = axisMarks[i]!
      const gap = b.distM - a.distM
      if (!(gap > 0.01)) continue
      rows.push({
        key: `g${i}`,
        text: `|--- ${formatLenLabelM(gap)} m ---|`,
        leftPct: (a.distM / xmax) * 100,
        widthPct: (gap / xmax) * 100,
      })
    }
    return rows
  }, [axisMarks, totalLengthM, ground])

  if (!ground.length) {
    return (
      <p className="py-10 text-center text-[12px] text-muted-foreground">
        등고 지반고를 읽지 못했습니다. 절단선을 다시 그려 주세요.
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded border-2 border-[#787878] bg-white p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold text-[#c2410c]">
          절단면({cutLen}m)
          <span className="ml-2 font-normal text-[#fb923c]">----</span>
        </div>
      </div>
      <div className="relative z-[2]" style={{ height: 320 }}>
        <Chart type="scatter" data={chartData} options={options} />
      </div>
      {gapRows.length > 0 ? (
        <div className="relative mt-1 h-5 border-t border-dashed border-[#cbd5e1]">
          {gapRows.map((g) => (
            <div
              key={g.key}
              className="absolute top-0 flex h-5 items-center justify-center overflow-hidden text-[9px] font-semibold text-[#475569]"
              style={{ left: `${g.leftPct}%`, width: `${g.widthPct}%` }}
              title={g.text}
            >
              {g.text}
            </div>
          ))}
        </div>
      ) : null}
      <div className="relative z-[1]">
        <SupplyAreaGanttChart bands={supplyAreaBands} totalLengthM={totalLengthM} nested />
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
    ]
    if (groundMax.length) {
      datasets.push({
        label: '격자 최대',
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
        label: '격자 최소',
        data: groundMin.map((g) => ({ x: g.distM, y: g.elevM })),
        borderColor: '#cbd5e1',
        borderDash: [4, 3],
        pointRadius: 0,
        fill: false,
        borderWidth: 1,
        order: CHART_Z.polygon,
      })
    }
    for (const [layerName, group] of groupFeaturesByLayer(pipes)) {
      for (const p of group) {
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
          label: layerName,
          data: pts,
          borderColor: normalizeStroke(p.color),
          backgroundColor: normalizeStroke(p.color),
          pointRadius: 0,
          borderWidth: 2.2,
          fill: false,
          order: CHART_Z.line,
        })
      }
    }
    return { datasets }
  }, [ground, groundMin, groundMax, pipes, len])

  const options = useMemo((): ChartOptions<'line'> => {
    const { ymin, ymax } = elevRange
    const cutLen = formatLenLabelM(len)
    return {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { left: 8, top: 18 } },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            font: { size: 10 },
            boxWidth: 10,
            filter: (item, data) => {
              const t = String(item.text || '')
              if (!t) return false
              if (t === '지반고' || t.startsWith('격자')) return true
              const firstIdx = data.datasets.findIndex(
                (d: { label?: string }) => String(d.label || '') === t
              )
              return item.datasetIndex === firstIdx
            },
          },
        },
        datalabels: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: ${Number(ctx.parsed.x).toFixed(2)}m / EL ${Number(ctx.parsed.y).toFixed(2)}`,
          },
        },
        annotation: {
          clip: false,
          annotations: {
            cutCenter: {
              type: 'line',
              xMin: len / 2,
              xMax: len / 2,
              borderColor: '#FF9100',
              borderWidth: 1.5,
              borderDash: [6, 4],
              drawTime: 'afterDatasets',
              clip: false,
              label: {
                display: true,
                content: `절단면(${cutLen}m)`,
                position: 'start',
                backgroundColor: 'rgba(255,145,0,0.12)',
                color: '#c2410c',
                font: { size: 10 },
              },
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
  }, [elevRange, len])

  if (!ground.length) {
    return (
      <p className="py-10 text-center text-[12px] text-muted-foreground">
        등고 지반고를 읽지 못했습니다. 절단선을 다시 그려 주세요.
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded border-2 border-[#787878] bg-white p-2">
      <div className="mb-1 text-[11px] font-semibold text-[#c2410c]">
        절단면({formatLenLabelM(len)}m)
      </div>
      <div style={{ height: 300 }}>
        <Line data={chartData} options={options} />
      </div>
      {rolesPresent.length > 0 ? (
        <WtlNetworkLongSupplyElevCharts
          ground={ground}
          supplyAreaBands={supplyAreaBands}
          totalLengthM={len}
          elevMin={elevRange.dataMin}
          elevMax={elevRange.ymax - 0.35}
        />
      ) : null}
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
