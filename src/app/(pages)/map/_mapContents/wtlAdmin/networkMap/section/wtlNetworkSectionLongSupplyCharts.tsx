'use client'

import { useMemo } from 'react'
import type { SectionGroundPt, SectionSupplyBandSegment } from './wtlNetworkSectionSvg'
import type { SectionSupplyElevRow } from './useWtlNetworkSection'

const ROLE_ORDER: Array<{ role: SectionSupplyBandSegment['role']; label: string }> = [
  { role: 'zone', label: '구역' },
  { role: 'subzone', label: '분구' },
  { role: 'block', label: '블록' },
]

/** 비율 → colspan 합산 단위 (셀 병합 그래프) */
const COLSPAN_UNITS = 20

type ElevSeg = { name: string; color: string; pct: number }
type ElevRoleRow = {
  elevM: number
  role: SectionSupplyBandSegment['role']
  roleLabel: string
  segs: ElevSeg[]
}

type ElevGroup = {
  elevM: number
  roles: Array<{
    role: SectionSupplyBandSegment['role']
    roleLabel: string
    segs: ElevSeg[]
  }>
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

function roleLabelOf(role: SectionSupplyBandSegment['role']): string {
  return ROLE_ORDER.find((r) => r.role === role)?.label ?? role
}

/** pct → colspan, 합이 COLSPAN_UNITS 가 되도록 보정 */
function segsToColspans(segs: ElevSeg[]): Array<ElevSeg & { span: number }> {
  const sorted = segs
    .slice()
    .filter((s) => s.pct > 0.5)
    .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name, 'ko'))
  if (!sorted.length) {
    return [{ name: '—', color: '#e2e8f0', pct: 100, span: COLSPAN_UNITS }]
  }
  const raw = sorted.map((s) => ({
    ...s,
    span: Math.max(1, Math.round((s.pct / 100) * COLSPAN_UNITS)),
  }))
  let sum = raw.reduce((s, x) => s + x.span, 0)
  while (sum > COLSPAN_UNITS) {
    const hit = raw.reduce((a, b) => (a.span >= b.span ? a : b))
    if (hit.span <= 1) break
    hit.span -= 1
    sum -= 1
  }
  while (sum < COLSPAN_UNITS) {
    const hit = raw.reduce((a, b) => (a.pct >= b.pct ? a : b))
    hit.span += 1
    sum += 1
  }
  return raw
}

function toElevGroups(rows: ElevRoleRow[]): ElevGroup[] {
  const elevs: number[] = []
  for (const r of rows) {
    if (!elevs.some((e) => Math.abs(e - r.elevM) < 1e-6)) elevs.push(r.elevM)
  }
  elevs.sort((a, b) => a - b)
  return elevs.map((elevM) => {
    const at = rows.filter((r) => Math.abs(r.elevM - elevM) < 1e-6)
    const roles = ROLE_ORDER.map((role) => {
      const hit = at.find((r) => r.role === role.role)
      return {
        role: role.role,
        roleLabel: role.label,
        segs: hit?.segs ?? [],
      }
    }).filter((r) => r.segs.length > 0)
    return { elevM, roles }
  }).filter((g) => g.roles.length > 0)
}

/** 표고 rowspan + 비율 colspan 으로 누적 그래프를 테이블에 그림 */
function ElevCompositionMergeTable({ rows }: { rows: ElevRoleRow[] }) {
  const groups = useMemo(() => toElevGroups(rows), [rows])

  if (!groups.length) return null

  return (
    <div
      className="mt-0.5 max-h-[320px] overflow-auto rounded border border-[#cbd5e1] bg-white"
      role="region"
      aria-label="표고별 구역·분구·블록 구성"
    >
      <table className="w-full border-collapse text-[11px]">
        <thead className="sticky top-0 z-[1] bg-[#f1f5f9]">
          <tr>
            <th className="w-14 border-b border-[#cbd5e1] px-1.5 py-1.5 text-left font-semibold text-[#475569]">
              표고
            </th>
            <th className="w-10 border-b border-[#cbd5e1] px-1.5 py-1.5 text-left font-semibold text-[#475569]">
              구분
            </th>
            <th
              className="border-b border-[#cbd5e1] px-1.5 py-1.5 text-left font-semibold text-[#475569]"
              colSpan={COLSPAN_UNITS}
            >
              구성 비율
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) =>
            g.roles.map((role, ri) => {
              const spans = segsToColspans(role.segs)
              return (
                <tr key={`${g.elevM}-${role.role}`} className="border-b border-[#e2e8f0]">
                  {ri === 0 ? (
                    <td
                      rowSpan={g.roles.length}
                      className="border-r border-[#e2e8f0] px-1.5 py-0.5 text-center align-middle font-normal tabular-nums text-[#0f172a]"
                    >
                      {formatElev(g.elevM)}m
                    </td>
                  ) : null}
                  <td className="border-r border-[#e2e8f0] px-1.5 py-0.5 whitespace-nowrap font-normal text-[#334155]">
                    {role.roleLabel}
                  </td>
                  {spans.map((s, si) => {
                    const title =
                      s.name === '—'
                        ? '—'
                        : `${s.name} ${Math.round(s.pct)}%`
                    return (
                      <td
                        key={`${s.name}-${si}`}
                        colSpan={s.span}
                        title={title}
                        className="overflow-hidden border-r border-[#cbd5e1] bg-transparent px-0.5 py-0.5 text-center align-middle font-normal leading-tight text-[#0f172a] last:border-r-0"
                      >
                        <span className="block truncate px-0.5">
                          {s.name === '—'
                            ? '—'
                            : s.span >= 3
                              ? `${s.name} ${Math.round(s.pct)}%`
                              : s.span >= 2
                                ? s.name
                                : ''}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

/**
 * 옆면 최저~최고 지반고 사이 표고마다 구역·분구·블록 구성.
 * 표고 셀 병합(rowspan) + 비율 셀 병합(colspan)으로 그래프 표시.
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

  return <ElevCompositionMergeTable rows={combinedRows} />
}
