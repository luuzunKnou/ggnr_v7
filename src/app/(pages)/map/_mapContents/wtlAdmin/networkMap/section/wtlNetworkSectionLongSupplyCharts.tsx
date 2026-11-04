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
import type { SectionSupplyElevRow } from './useWtlNetworkSection'

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
type ElevRoleRow = {
  elevM: number
  role: SectionSupplyBandSegment['role']
  roleLabel: string
  segs: ElevSeg[]
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

/** 표고 e 이상인 깊이 구간 (지반고가 e 이상인 x) — 서버 집계 없을 때 fallback */
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

function buildElevComposition(
  ground: SectionGroundPt[],
  bands: SectionSupplyBandSegment[],
  role: SectionSupplyBandSegment['role'],
  elevSteps: number[],
  len: number
): { elevM: number; segs: ElevSeg[] }[] {
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

/** 동일 레이어 색이어도 이름별로 구분되게 살짝 변조 */
function distinctColor(base: string, name: string, index: number): string {
  const hex = normalizeStroke(base)
  const n = [...name].reduce((s, ch) => s + (ch.codePointAt(0) ?? 0), 0) + index * 37
  const shift = ((n % 5) - 2) * 18
  const clamp = (v: number) => Math.max(30, Math.min(220, v))
  const r = clamp(parseInt(hex.slice(1, 3), 16) + shift)
  const g = clamp(parseInt(hex.slice(3, 5), 16) - shift)
  const b = clamp(parseInt(hex.slice(5, 7), 16) + Math.floor(shift / 2))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase()
}

function combinedStackedBarData(rows: ElevRoleRow[]): ChartData<'bar'> {
  const names = uniqueNamesFromRoleRows(rows)
  const labels = rows.map((r) => `${formatElev(r.elevM)}m · ${r.roleLabel}`)
  return {
    labels,
    datasets: names.map((name, i) => {
      const base = colorOfNameRole(rows, name)
      const color = distinctColor(base, name, i)
      return {
        label: name,
        data: rows.map((r) => r.segs.find((s) => s.name === name)?.pct ?? 0),
        backgroundColor: `${color}99`,
        borderColor: color,
        borderWidth: 1,
        barThickness: 12,
      }
    }),
  }
}

function CombinedStackedBarChart({ rows }: { rows: ElevRoleRow[] }) {
  const data = useMemo(() => combinedStackedBarData(rows), [rows])
  const options = useMemo(
    (): ChartOptions<'bar'> => ({
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { top: 2, bottom: 2, left: 0, right: 4 } },
      plugins: {
        legend: { display: false },
        datalabels: {
          color: '#1e293b',
          font: { size: 9, weight: 600 },
          clamp: true,
          formatter: (v, ctx) => {
            if (!(Number(v) >= 8)) return ''
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
    }),
    []
  )
  const h = Math.max(44, rows.length * 20 + 8)
  return (
    <div
      className="mt-0.5 overflow-hidden bg-transparent"
      style={{ height: h }}
      role="img"
      aria-label="표고별 구역·분구·블록 구성 비율"
    >
      <Bar data={data} options={options} />
    </div>
  )
}

function roleLabelOf(role: SectionSupplyBandSegment['role']): string {
  return ROLE_ORDER.find((r) => r.role === role)?.label ?? role
}

/**
 * 옆면 최저~최고 지반고 사이 표고마다 구역·분구·블록 누적 가로막대.
 * 서버 2D 띠 격자 집계(supplyElevComposition) 우선 — 절단선 방향 복수 블록 반영.
 */
export function WtlNetworkLongSupplyElevCharts({
  ground,
  groundMin = [],
  groundMax = [],
  supplyAreaBands,
  supplyElevComposition = [],
  totalLengthM,
}: {
  ground: SectionGroundPt[]
  groundMin?: SectionGroundPt[]
  groundMax?: SectionGroundPt[]
  supplyAreaBands: SectionSupplyBandSegment[]
  supplyElevComposition?: SectionSupplyElevRow[]
  totalLengthM: number
}) {
  const len = Math.max(totalLengthM, ground[ground.length - 1]?.distM ?? 0, 0.01)

  const { elevMin, elevMax } = useMemo(() => {
    const mins = (groundMin.length ? groundMin : ground).map((g) => g.elevM)
    const maxs = (groundMax.length ? groundMax : ground).map((g) => g.elevM)
    const elevMin = mins.length ? Math.min(...mins) : 0
    const elevMax = maxs.length ? Math.max(...maxs) : elevMin + 1
    return {
      elevMin: Math.min(elevMin, elevMax),
      elevMax: Math.max(elevMin, elevMax),
    }
  }, [ground, groundMin, groundMax])

  const steps = useMemo(() => elevStepsOf(elevMin, elevMax), [elevMin, elevMax])

  const combinedRows = useMemo((): ElevRoleRow[] => {
    if (supplyElevComposition.length > 0) {
      const out: ElevRoleRow[] = []
      const byElev = new Map<number, SectionSupplyElevRow[]>()
      for (const row of supplyElevComposition) {
        if (!row.segs?.length) continue
        const list = byElev.get(row.elevM) ?? []
        list.push(row)
        byElev.set(row.elevM, list)
      }
      const elevs = [...byElev.keys()].sort((a, b) => a - b)
      for (const elevM of elevs) {
        const rows = byElev.get(elevM) ?? []
        for (const role of ROLE_ORDER) {
          const hit = rows.find((r) => r.role === role.role)
          if (!hit?.segs.length) continue
          out.push({
            elevM,
            role: role.role,
            roleLabel: role.label,
            segs: hit.segs.map((s) => ({
              name: s.name,
              color: normalizeStroke(s.color),
              pct: s.pct,
            })),
          })
        }
      }
      return out
    }

    // fallback: 1D 밴드 ∩ 표고 (서버 집계 없을 때)
    const out: ElevRoleRow[] = []
    for (const elevM of steps) {
      for (const role of ROLE_ORDER) {
        if (!supplyAreaBands.some((b) => b.role === role.role)) continue
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
          roleLabel: roleLabelOf(role.role),
          segs: row.segs,
        })
      }
    }
    return out
  }, [supplyElevComposition, ground, supplyAreaBands, steps, len])

  if (!combinedRows.length) return null

  return <CombinedStackedBarChart rows={combinedRows} />
}
