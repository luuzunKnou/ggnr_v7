'use client'

import { useMemo } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  Tooltip,
  Legend,
  type ChartData,
  type ChartOptions,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import type { SectionGroundPt, SectionSupplyBandSegment } from './wtlNetworkSectionSvg'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  Tooltip,
  Legend,
  ChartDataLabels
)

const ROLE_ORDER: Array<{ role: SectionSupplyBandSegment['role']; label: string }> = [
  { role: 'zone', label: '구역' },
  { role: 'subzone', label: '분구' },
  { role: 'block', label: '블록' },
]

type ElevSeg = { name: string; color: string; pct: number }
type ElevRow = { elevM: number; segs: ElevSeg[] }
type ElevRoleRow = ElevRow & {
  role: SectionSupplyBandSegment['role']
  roleLabel: string
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

/** 표고 e 이상인 깊이 구간 (지반고가 e 이상인 x) */
function activeDepthIntervals(
  ground: SectionGroundPt[],
  elevM: number,
  len: number
): Array<[number, number]> {
  const n = Math.max(40, Math.min(200, Math.ceil(len * 8) || 40))
  const xs: number[] = []
  for (let i = 0; i <= n; i++) xs.push((i / n) * len)
  const on = xs.map((x) => {
    const e = groundElevAt(ground, x)
    return e != null && e >= elevM - 1e-6
  })
  const out: Array<[number, number]> = []
  let start: number | null = null
  for (let i = 0; i < xs.length; i++) {
    if (on[i] && start == null) start = xs[i]!
    if ((!on[i] || i === xs.length - 1) && start != null) {
      const end = on[i] && i === xs.length - 1 ? xs[i]! : xs[Math.max(0, i - 1)]!
      if (end > start) out.push([start, end])
      start = null
    }
  }
  return out
}

function intersectLen(a0: number, a1: number, b0: number, b1: number): number {
  const lo = Math.max(a0, b0)
  const hi = Math.min(a1, b1)
  return Math.max(0, hi - lo)
}

/**
 * 표고별 구성 비율 — 해당 표고에서 지반이 남는 깊이 구간 ∩ 급수 밴드
 * (표고가 올라갈수록 남는 폭·비율이 달라짐)
 */
function buildElevComposition(
  ground: SectionGroundPt[],
  bands: SectionSupplyBandSegment[],
  role: SectionSupplyBandSegment['role'],
  elevSteps: number[],
  len: number
): ElevRow[] {
  const roleBands = bands.filter((b) => b.role === role)
  return elevSteps.map((elevM) => {
    const active = activeDepthIntervals(ground, elevM, len)
    const activeLen = active.reduce((s, [a, b]) => s + (b - a), 0)
    if (activeLen < 1e-6 || !roleBands.length) {
      return { elevM, segs: [] }
    }
    const acc = new Map<string, { name: string; color: string; len: number }>()
    for (const band of roleBands) {
      const b0 = Math.min(band.fromM, band.toM)
      const b1 = Math.max(band.fromM, band.toM)
      let L = 0
      for (const [a0, a1] of active) L += intersectLen(a0, a1, b0, b1)
      if (L < 1e-9) continue
      const key = band.name || '(무명)'
      const prev = acc.get(key)
      if (prev) prev.len += L
      else acc.set(key, { name: key, color: normalizeStroke(band.color), len: L })
    }
    const total = [...acc.values()].reduce((s, v) => s + v.len, 0)
    if (total < 1e-9) return { elevM, segs: [] }
    const segs = [...acc.values()].map((v) => ({
      name: v.name,
      color: v.color,
      pct: (v.len / total) * 100,
    }))
    return { elevM, segs }
  })
}

function elevStepsOf(ymin: number, ymax: number): number[] {
  const span = Math.max(ymax - ymin, 1)
  const step = span > 40 ? 10 : span > 20 ? 5 : span > 10 ? 2 : 1
  const start = Math.ceil(ymin / step) * step
  const out: number[] = []
  for (let e = start; e <= ymax + 1e-6; e += step) out.push(Number(e.toFixed(4)))
  if (!out.length) {
    out.push(Number(ymin.toFixed(2)), Number(ymax.toFixed(2)))
  }
  return out
}

function formatElev(e: number): string {
  return Number.isInteger(e) ? String(e) : e.toFixed(1)
}

function uniqueNamesFromRoleRows(rows: ElevRoleRow[]): string[] {
  const set = new Set<string>()
  for (const r of rows) for (const s of r.segs) set.add(s.name)
  return [...set]
}

function colorOfNameRole(rows: ElevRoleRow[], name: string): string {
  for (const r of rows) {
    const hit = r.segs.find((s) => s.name === name)
    if (hit) return hit.color
  }
  return '#888888'
}

/** 구역·분구·블록을 표고별로 한 누적 가로막대에 합침 */
function combinedStackedBarData(rows: ElevRoleRow[]): ChartData<'bar'> {
  const names = uniqueNamesFromRoleRows(rows)
  const labels = rows.map((r) => `${formatElev(r.elevM)}m · ${r.roleLabel}`)
  return {
    labels,
    datasets: names.map((name) => ({
      label: name,
      data: rows.map((r) => r.segs.find((s) => s.name === name)?.pct ?? 0),
      backgroundColor: `${colorOfNameRole(rows, name)}99`,
      borderColor: colorOfNameRole(rows, name),
      borderWidth: 1,
      barThickness: 12,
    })),
  }
}

function CombinedStackedBarChart({ rows }: { rows: ElevRoleRow[] }) {
  const data = useMemo(() => combinedStackedBarData(rows), [rows])
  const options = useMemo(
    (): ChartOptions<'bar'> => ({
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 10 } },
        datalabels: {
          color: '#1e293b',
          font: { size: 9, weight: 600 },
          formatter: (v) => (Number(v) >= 10 ? `${Math.round(Number(v))}` : ''),
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.raw).toFixed(1)}%`,
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          min: 0,
          max: 100,
          title: { display: true, text: '구성 비율 (%)', font: { size: 10 } },
          ticks: { font: { size: 9 } },
        },
        y: {
          stacked: true,
          title: { display: true, text: '표고 · 레이어', font: { size: 10 } },
          ticks: { font: { size: 9 } },
        },
      },
    }),
    []
  )
  const h = Math.max(200, rows.length * 20 + 90)
  return (
    <div style={{ height: h }}>
      <Bar data={data} options={options} />
    </div>
  )
}

export function WtlNetworkLongSupplyElevCharts({
  ground,
  supplyAreaBands,
  totalLengthM,
  elevMin,
  elevMax,
}: {
  ground: SectionGroundPt[]
  supplyAreaBands: SectionSupplyBandSegment[]
  totalLengthM: number
  elevMin: number
  elevMax: number
}) {
  const len = Math.max(totalLengthM, ground[ground.length - 1]?.distM ?? 0, 0.01)
  const steps = useMemo(() => elevStepsOf(elevMin, elevMax), [elevMin, elevMax])

  /** 표고 오름차순 → 각 표고에서 구역·분구·블록 순으로 합침 */
  const combinedRows = useMemo((): ElevRoleRow[] => {
    const out: ElevRoleRow[] = []
    for (const elevM of steps) {
      for (const role of ROLE_ORDER) {
        const [row] = buildElevComposition(
          ground,
          supplyAreaBands,
          role.role,
          [elevM],
          len
        )
        if (!row || !row.segs.length) continue
        out.push({
          elevM,
          role: role.role,
          roleLabel: role.label,
          segs: row.segs,
        })
      }
    }
    return out
  }, [ground, supplyAreaBands, steps, len])

  if (!combinedRows.length) return null

  return (
    <div className="mt-3 space-y-2 border-t border-[#e2e8f0] pt-3">
      <div className="text-[12px] font-semibold text-foreground">구역·분구·블록</div>
      <div className="rounded border border-[#e2e8f0] bg-white p-2">
        <CombinedStackedBarChart rows={combinedRows} />
      </div>
    </div>
  )
}
