'use client'

import { useMemo } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type TooltipItem,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import annotationPlugin from 'chartjs-plugin-annotation'
import type { OdorGrade } from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import { GRADE_MAX_PPM } from '@/app/(pages)/(index)/odorPh/odorAlertDetailMock'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  Tooltip,
  annotationPlugin
)

const GRADE_COLORS: Record<OdorGrade, string> = {
  1: '#22c55e',
  2: '#84cc16',
  3: '#eab308',
  4: '#f97316',
  5: '#ef4444',
}

const GRADES = [1, 2, 3, 4, 5] as const

/** ppm → 5등분 누적 축(0~5) 위치 */
export function ppmToGradeAxis(ppm: number): number {
  const bounds = [0, GRADE_MAX_PPM[1], GRADE_MAX_PPM[2], GRADE_MAX_PPM[3], GRADE_MAX_PPM[4], GRADE_MAX_PPM[5]]
  for (let g = 1; g <= 5; g++) {
    const lo = bounds[g - 1]!
    const hi = bounds[g]!
    if (ppm <= hi) {
      const t = hi > lo ? (ppm - lo) / (hi - lo) : 0
      return Math.max(0, Math.min(5, g - 1 + t))
    }
  }
  return 5
}

type Props = {
  ppm: number
  grade: OdorGrade
}

/** 현재 농도 — 5등급 누적 막대 + 세로 | 현재 위치 (악취 등급 분포와 동일 패턴) */
export function OdorAlertPpmChart({ ppm, grade }: Props) {
  const markerX = ppmToGradeAxis(ppm)

  const chartData = useMemo<ChartData<'bar'>>(
    () => ({
      labels: ['등급'],
      datasets: GRADES.map((g) => ({
        label: `${g}등급`,
        data: [1],
        backgroundColor: GRADE_COLORS[g],
        borderWidth: 0,
        barPercentage: 1,
        categoryPercentage: 1,
      })),
    }),
    []
  )

  const chartOptions = useMemo<ChartOptions<'bar'>>(
    () => ({
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: 0 },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          mode: 'nearest',
          intersect: true,
          callbacks: {
            title: () => '',
            label: (ctx: TooltipItem<'bar'>) => ctx.dataset.label ?? '',
          },
        },
        annotation: {
          annotations: {
            currentMarkerHalo: {
              type: 'line',
              scaleID: 'x',
              value: markerX,
              borderColor: 'rgba(255, 255, 255, 0.95)',
              borderWidth: 4,
              drawTime: 'afterDatasetsDraw',
            },
            currentMarker: {
              type: 'line',
              scaleID: 'x',
              value: markerX,
              borderColor: 'rgb(15, 23, 42)',
              borderWidth: 2,
              drawTime: 'afterDatasetsDraw',
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          display: false,
          min: 0,
          max: 5,
          grid: { display: false, drawBorder: false },
          border: { display: false },
        },
        y: {
          stacked: true,
          display: false,
          grid: { display: false, drawBorder: false },
          border: { display: false },
        },
      },
    }),
    [markerX]
  )

  return (
    <div className="w-full">
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <span className="text-[12px] text-muted-foreground">{grade}등급</span>
        <span
          className="text-[14px] font-semibold tabular-nums text-amber-700 dark:text-amber-300"
          title={`현재 ${ppm.toFixed(1)} ppm`}
        >
          {ppm.toFixed(1)} ppm
        </span>
      </div>
      <div className="relative h-5 w-full overflow-hidden rounded-[5px]">
        <Bar data={chartData} options={chartOptions} />
      </div>
      <div className="mt-0.5 flex justify-between px-0.5 text-[11px] text-muted-foreground">
        {GRADES.map((g) => (
          <span key={g}>{g}</span>
        ))}
      </div>
    </div>
  )
}
