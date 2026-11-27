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
  type ChartOptions,
  type TooltipItem,
} from 'chart.js'
import { Chart } from 'react-chartjs-2'
import annotationPlugin from 'chartjs-plugin-annotation'
import {
  ppmZoneBoxAnnotations,
  thresholdLineAnnotation,
} from '@/app/(pages)/(index)/odorPhV2/odorAlertChartTheme'
import type {
  PpmZoneBounds,
  TrendPoint,
} from '@/app/(pages)/(index)/odorPhV2/odorAlertDetailMock'

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
  points: TrendPoint[]
  thresholdPpm: number
  zones: PpmZoneBounds
}

/** 경향 — 표7 배경·가동 기준선·가동중/미가동 마커 */
export function OdorAlertTrendChart({ points, thresholdPpm, zones }: Props) {
  const chartData = useMemo<ChartData>(() => {
    const labels = points.map((p) => p.label)
    return {
      labels,
      datasets: [
        {
          type: 'line' as const,
          label: 'ppm',
          data: points.map((p) => p.ppm),
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: 'rgba(59, 130, 246, 0.08)',
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 3,
          tension: 0.25,
          fill: false,
          order: 2,
        },
        {
          type: 'scatter' as const,
          label: '가동중',
          data: points.map((p) => (p.running ? p.ppm : null)),
          backgroundColor: 'rgb(34, 197, 94)',
          borderColor: 'rgb(34, 197, 94)',
          pointStyle: 'circle',
          radius: 3.5,
          hoverRadius: 4,
          order: 1,
          spanGaps: false,
        },
        {
          type: 'scatter' as const,
          label: '미가동',
          data: points.map((p) => (!p.running ? p.ppm : null)),
          backgroundColor: 'rgba(255,255,255,0.9)',
          borderColor: 'rgb(100, 116, 139)',
          borderWidth: 1.5,
          pointStyle: 'circle',
          radius: 3.5,
          hoverRadius: 4,
          order: 1,
          spanGaps: false,
        },
      ],
    }
  }, [points])

  const chartOptions = useMemo<ChartOptions>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx: TooltipItem<'line'>) => {
              if (ctx.dataset.label === '가동중') return '● 가동중'
              if (ctx.dataset.label === '미가동') return '○ 미가동'
              const v = typeof ctx.parsed.y === 'number' ? ctx.parsed.y : 0
              return `${v.toFixed(1)} ppm`
            },
          },
        },
        annotation: {
          annotations: {
            ...ppmZoneBoxAnnotations(zones, 'y'),
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
            maxTicksLimit: 6,
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
            maxTicksLimit: 5,
          },
          grid: { color: 'rgba(148, 163, 184, 0.15)' },
          border: { display: false },
        },
      },
    }),
    [zones, thresholdPpm]
  )

  return (
    <div className="h-[200px] w-full shrink-0">
      <Chart type="line" data={chartData} options={chartOptions} />
    </div>
  )
}
