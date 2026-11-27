'use client'

import { useMemo } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  LineController,
  PointElement,
  ScatterController,
  Filler,
  Tooltip,
  Legend,
  type ChartData,
  type ChartDataset,
  type ChartOptions,
} from 'chart.js'
import { Chart } from 'react-chartjs-2'
import annotationPlugin from 'chartjs-plugin-annotation'
import { thresholdLineAnnotation } from '@/app/(pages)/(index)/odorPh/odorAlertChartTheme'
import type { PpmZoneBounds } from '@/app/(pages)/(index)/odorPh/odorAlertDetailMock'
import {
  gradeBandBoxAnnotations,
  type CompareSeries,
} from '../odorDashboard2TrendCompareMock'

ChartJS.register(
  CategoryScale,
  LinearScale,
  LineElement,
  LineController,
  PointElement,
  ScatterController,
  Filler,
  Tooltip,
  Legend,
  annotationPlugin
)

type Props = {
  series: CompareSeries[]
  thresholdPpm: number
  zones: PpmZoneBounds
}

/** 가동 시작(△)·완료(▽) 인덱스 */
function abatementMarkers(points: { ppm: number; running: boolean }[]) {
  const starts: number[] = []
  const ends: number[] = []
  for (let i = 0; i < points.length; i++) {
    const prev = i > 0 ? points[i - 1].running : false
    const cur = points[i].running
    if (!prev && cur) starts.push(i)
    if (prev && !cur) ends.push(i)
  }
  return { starts, ends }
}

/** 추이비교 — 다중 선 + 등급 배경 + 저감 △/▽ + 가동 구간 굵은 선 */
export function OdorTrendCompareChart({ series, thresholdPpm, zones }: Props) {
  const chartData = useMemo(() => {
    const labels = series[0]?.points.map((p) => p.label) ?? []
    const datasets: ChartDataset[] = []

    series.forEach((s) => {
      const runningFlags = s.points.map((p) => p.running)
      datasets.push({
        type: 'line',
        label: s.label,
        data: s.points.map((p) => p.ppm),
        borderColor: s.color,
        backgroundColor: s.color,
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 3,
        tension: 0.25,
        fill: false,
        order: 3,
        segment: {
          borderWidth: (ctx) => {
            const i = ctx.p0DataIndex
            return runningFlags[i] ? 3.25 : 1.5
          },
        },
      } as ChartDataset)

      const { starts, ends } = abatementMarkers(s.points)
      datasets.push({
        type: 'scatter',
        label: `${s.label}·시작`,
        data: s.points.map((p, i) => (starts.includes(i) ? p.ppm : null)),
        backgroundColor: s.color,
        borderColor: '#fff',
        borderWidth: 1,
        pointStyle: 'triangle',
        radius: 5.5,
        hoverRadius: 6.5,
        order: 1,
        spanGaps: false,
      } as ChartDataset)
      datasets.push({
        type: 'scatter',
        label: `${s.label}·완료`,
        data: s.points.map((p, i) => (ends.includes(i) ? p.ppm : null)),
        backgroundColor: s.color,
        borderColor: '#fff',
        borderWidth: 1,
        pointStyle: 'triangle',
        rotation: 180,
        radius: 5.5,
        hoverRadius: 6.5,
        order: 1,
        spanGaps: false,
      } as ChartDataset)
    })

    return { labels, datasets } satisfies ChartData
  }, [series])

  const chartOptions = useMemo<ChartOptions>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            boxWidth: 10,
            boxHeight: 2,
            font: { size: 9 },
            filter: (item) =>
              !String(item.text ?? '').includes('·시작') &&
              !String(item.text ?? '').includes('·완료'),
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const name = ctx.dataset.label ?? ''
              if (name.includes('·시작')) return '△ 저감 가동 시작'
              if (name.includes('·완료')) return '▽ 저감 가동 완료'
              const parsed = ctx.parsed as { y?: number }
              const v = typeof parsed.y === 'number' ? parsed.y : 0
              return `${name}: ${v.toFixed(1)} ppm`
            },
          },
        },
        annotation: {
          annotations: {
            ...gradeBandBoxAnnotations(zones),
            ...thresholdLineAnnotation(thresholdPpm, 'y'),
          },
        },
      },
      scales: {
        x: {
          type: 'category',
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8,
            font: { size: 8 },
            color: 'rgb(148, 163, 184)',
          },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          min: 0,
          max: zones.chartMax,
          ticks: {
            font: { size: 8 },
            color: 'rgb(148, 163, 184)',
            maxTicksLimit: 6,
          },
          grid: { color: 'rgba(148, 163, 184, 0.15)' },
          border: { display: false },
        },
      },
    }),
    [zones, thresholdPpm]
  )

  return (
    <div className="h-full min-h-[140px] w-full">
      <Chart type="line" data={chartData} options={chartOptions} />
    </div>
  )
}
