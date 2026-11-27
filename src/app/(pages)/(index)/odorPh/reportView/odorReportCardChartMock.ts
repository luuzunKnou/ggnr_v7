/** 카드 지표 → 기간별 멀티시리즈 차트 목업 */

import type { OdorReportPeriodMode } from './odorReportViewConfig'
import type { ReportStatCard } from './odorReportViewMock'
import type { OdorReportPeriodState } from './OdorReportPeriodBar'

export type CardMetricSeries = {
  key: string
  label: string
  color: string
  values: number[]
}

export type CardMetricChartMock = {
  title: string
  labels: string[]
  series: CardMetricSeries[]
}

function parseCardNumber(value: string): number {
  const n = Number(String(value).replace(/,/g, '').trim())
  if (Number.isFinite(n)) return n
  // 지점명 등 비숫자 — 시리즈용 목업 수치
  let h = 0
  for (let i = 0; i < value.length; i++) h = (h + value.charCodeAt(i) * (i + 1)) % 97
  return 12 + (h % 40)
}

function periodTitle(mode: OdorReportPeriodMode): string {
  if (mode === 'daily') return '일보 지표 추이'
  if (mode === 'monthly') return '월보 지표 추이'
  return '기간 지표 추이'
}

/** 일보: 시간대 / 월보: 일자 / 기간: 구간 일자 */
export function buildPeriodLabels(period: OdorReportPeriodState): string[] {
  if (period.mode === 'daily') {
    return Array.from({ length: 12 }, (_, i) => `${String(i * 2).padStart(2, '0')}시`)
  }

  if (period.mode === 'monthly') {
    const parts = period.month.split('-').map((x) => Number(x))
    const y = parts[0] || new Date().getFullYear()
    const m = parts[1] || new Date().getMonth() + 1
    const daysInMonth = new Date(y, m, 0).getDate()
    const step = daysInMonth > 15 ? 2 : 1
    const labels: string[] = []
    for (let d = 1; d <= daysInMonth; d += step) {
      labels.push(`${d}일`)
    }
    return labels
  }

  const from = new Date(`${period.from}T00:00:00`)
  const to = new Date(`${period.to}T00:00:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    return ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']
  }
  const labels: string[] = []
  const cursor = new Date(from)
  let guard = 0
  while (cursor <= to && guard < 31) {
    const mm = String(cursor.getMonth() + 1).padStart(2, '0')
    const dd = String(cursor.getDate()).padStart(2, '0')
    labels.push(`${mm}-${dd}`)
    cursor.setDate(cursor.getDate() + 1)
    guard += 1
  }
  if (labels.length > 16) {
    const step = Math.ceil(labels.length / 14)
    return labels.filter((_, i) => i % step === 0)
  }
  return labels.length > 0 ? labels : ['D1', 'D2', 'D3']
}

function waveAt(i: number, n: number, seed: number): number {
  const t = n <= 1 ? 0 : i / (n - 1)
  const w =
    0.72 +
    0.18 * Math.sin((t * Math.PI * 2) + seed) +
    0.1 * Math.sin((t * Math.PI * 4) + seed * 1.7)
  return Math.max(0.35, w)
}

/**
 * 카드 지표를 시리즈로 한 그래프.
 * 기간 모드에 따라 X축(시간/일/구간)이 바뀌고, 카드 값 기준 추이 목업을 만든다.
 */
export function buildCardMetricChartMock(
  cards: ReportStatCard[],
  period: OdorReportPeriodState
): CardMetricChartMock {
  const labels = buildPeriodLabels(period)
  const n = labels.length
  const modeScale = period.mode === 'daily' ? 0.22 : period.mode === 'range' ? 0.55 : 1

  const series: CardMetricSeries[] = cards.map((c, idx) => {
    const base = Math.max(0.1, parseCardNumber(c.value) * modeScale)
    const unitHint = c.sub ? ` (${c.sub})` : ''
    return {
      key: c.key,
      label: `${c.title}${unitHint}`,
      color: c.accent,
      values: labels.map((_, i) => {
        const v = base * waveAt(i, n, idx + 1)
        // 개소·건수류는 정수에 가깝게
        if (c.sub === '개소' || c.sub === '건' || c.sub === '회' || c.sub === '부') {
          return Math.max(0, Math.round(v))
        }
        return Math.round(v * 10) / 10
      }),
    }
  })

  return {
    title: periodTitle(period.mode),
    labels,
    series,
  }
}

/** 기간에 맞춰 카드 표시값도 스케일 (목업) */
export function scaleCardsForPeriod(
  cards: ReportStatCard[],
  mode: OdorReportPeriodMode
): ReportStatCard[] {
  const scale = mode === 'daily' ? 0.22 : mode === 'range' ? 0.55 : 1
  return cards.map((c) => {
    const n = Number(String(c.value).replace(/,/g, '').trim())
    if (!Number.isFinite(n)) return c
    const scaled = n * scale
    const display =
      c.sub === 'ppm' || c.sub === '일'
        ? (Math.round(scaled * 10) / 10).toString()
        : Math.round(scaled).toLocaleString('ko-KR')
    return { ...c, value: display }
  })
}
