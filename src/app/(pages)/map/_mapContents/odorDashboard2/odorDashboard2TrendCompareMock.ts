import {
  DEFAULT_PPM_ZONES,
  GRADE_MAX_PPM,
  type PpmZoneBounds,
  type TrendPoint,
} from '@/app/(pages)/(index)/odorPh/odorAlertDetailMock'
import type { OdorStationRow } from './odorDashboard2StationRows'

/** 추이비교 시간 범위 */
export type CompareRange =
  | '30m'
  | '1h'
  | '6h'
  | '12h'
  | '24h'
  | 'week'
  | 'month'

export const COMPARE_RANGE_OPTIONS: Array<{ key: CompareRange; label: string }> = [
  { key: '30m', label: '30분' },
  { key: '1h', label: '1시간' },
  { key: '6h', label: '6시간' },
  { key: '12h', label: '12시간' },
  { key: '24h', label: '24시간' },
  { key: 'week', label: '주' },
  { key: 'month', label: '월' },
]

export const COMPARE_RANGE_FILE: Record<CompareRange, string> = {
  '30m': '30m',
  '1h': '1h',
  '6h': '6h',
  '12h': '12h',
  '24h': '24h',
  week: 'week',
  month: 'month',
}

export type CompareSeries = {
  stationId: string
  label: string
  color: string
  points: TrendPoint[]
}

const SERIES_COLORS = [
  'rgb(59, 130, 246)',
  'rgb(16, 185, 129)',
  'rgb(245, 158, 11)',
  'rgb(239, 68, 68)',
  'rgb(168, 85, 247)',
  'rgb(20, 184, 166)',
  'rgb(244, 63, 94)',
  'rgb(99, 102, 241)',
]

function hashSeed(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h || 1
}

function mulberry32(seed: number) {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function rangeSpec(range: CompareRange): { count: number; labelAt: (i: number) => string } {
  const pad = (n: number) => String(n).padStart(2, '0')
  switch (range) {
    case '30m':
      return {
        count: 30,
        labelAt: (i) => `${pad(Math.floor(i / 60))}:${pad(i % 60)}`,
      }
    case '1h':
      return {
        count: 60,
        labelAt: (i) => `${pad(Math.floor(i / 60))}:${pad(i % 60)}`,
      }
    case '6h':
      return {
        count: 36,
        labelAt: (i) => {
          const m = i * 10
          return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
        },
      }
    case '12h':
      return {
        count: 48,
        labelAt: (i) => {
          const m = i * 15
          return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
        },
      }
    case '24h':
      return { count: 24, labelAt: (i) => `${pad(i)}:00` }
    case 'week':
      return {
        count: 7,
        labelAt: (i) => {
          const d = new Date()
          d.setDate(d.getDate() - (6 - i))
          return `${d.getMonth() + 1}/${d.getDate()}`
        },
      }
    case 'month':
      return {
        count: 30,
        labelAt: (i) => {
          const d = new Date()
          d.setDate(d.getDate() - (29 - i))
          return `${d.getMonth() + 1}/${d.getDate()}`
        },
      }
  }
}

function buildSeries(
  rand: () => number,
  basePpm: number,
  thresholdPpm: number,
  count: number,
  labelAt: (i: number) => string
): TrendPoint[] {
  const out: TrendPoint[] = []
  let v = basePpm
  let running = basePpm >= thresholdPpm
  for (let i = 0; i < count; i++) {
    v = Math.max(0.2, Math.min(12, v + (rand() - 0.48) * 1.2))
    if (v >= thresholdPpm) running = true
    else if (v < thresholdPpm * 0.85) running = false
    out.push({
      label: labelAt(i),
      ppm: Math.round(v * 10) / 10,
      running,
    })
  }
  return out
}

/** 1~5등급 y축 배경 박스 (농도경향과 동일 계열 색) */
export function gradeBandBoxAnnotations(zones: PpmZoneBounds): Record<string, object> {
  const tops = [
    GRADE_MAX_PPM[1],
    GRADE_MAX_PPM[2],
    GRADE_MAX_PPM[3],
    GRADE_MAX_PPM[4],
    zones.chartMax,
  ]
  const colors = [
    'rgba(34, 197, 94, 0.18)',
    'rgba(74, 222, 128, 0.14)',
    'rgba(0, 0, 0, 0)',
    'rgba(251, 146, 60, 0.16)',
    'rgba(248, 113, 113, 0.20)',
  ]
  const out: Record<string, object> = {}
  let from = 0
  tops.forEach((to, i) => {
    out[`gradeBand${i + 1}`] = {
      type: 'box' as const,
      yMin: from,
      yMax: to,
      backgroundColor: colors[i],
      borderWidth: 0,
      drawTime: 'beforeDatasetsDraw' as const,
    }
    from = to
  })
  return out
}

/** 선택 지점들의 추이비교 시계열 목업 */
export function buildTrendCompareSeries(opts: {
  stations: OdorStationRow[]
  range: CompareRange
  thresholdPpm: number
}): { series: CompareSeries[]; zones: PpmZoneBounds } {
  const { count, labelAt } = rangeSpec(opts.range)
  const series = opts.stations.map((st, idx) => {
    const rand = mulberry32(hashSeed(`${st.id}:${opts.range}`))
    const base = Math.max(0.3, st.ppm + (rand() - 0.5) * 1.5)
    return {
      stationId: st.id,
      label: st.sensorKorNm,
      color: SERIES_COLORS[idx % SERIES_COLORS.length],
      points: buildSeries(rand, base, opts.thresholdPpm, count, labelAt),
    }
  })
  return { series, zones: DEFAULT_PPM_ZONES }
}
