'use client'

import { useMemo, type ReactNode } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  LineElement,
  LineController,
  PointElement,
  ArcElement,
  PieController,
  Tooltip,
  Legend,
  type ChartData,
  type ChartOptions,
} from 'chart.js'
import { Bar, Chart, Line, Pie } from 'react-chartjs-2'
import { cn } from '@/lib/utils'
import type { ReportBarPoint, ReportLinePoint, ReportPieSlice } from './odorReportViewMock'

/** 카드 accent 파란(#3b82f6) — 멀티차트에서 꺾은선으로 표시 */
function isBlueSeriesColor(color: string): boolean {
  const c = color.trim().toLowerCase().replace(/\s+/g, '')
  return c === '#3b82f6' || c === 'rgb(59,130,246)' || c === 'rgba(59,130,246,1)'
}

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  LineElement,
  LineController,
  PointElement,
  ArcElement,
  PieController,
  Tooltip,
  Legend
)

type ChartShellProps = {
  title: string
  className?: string
  children: ReactNode
}

function ChartShell({ title, className, children }: ChartShellProps) {
  return (
    <section
      className={cn(
        'flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded border border-border bg-card',
        className
      )}
    >
      <h3 className="shrink-0 border-b border-border px-2.5 py-1.5 text-[12px] font-semibold text-foreground">
        {title}
      </h3>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 p-2">{children}</div>
      </div>
    </section>
  )
}

type BarProps = {
  title: string
  points: ReportBarPoint[]
  color?: string
  className?: string
}

export function OdorReportBarChart({
  title,
  points,
  color = 'rgb(59, 130, 246)',
  className,
}: BarProps) {
  const data = useMemo<ChartData<'bar'>>(
    () => ({
      labels: points.map((p) => p.label),
      datasets: [
        {
          label: title,
          data: points.map((p) => p.value),
          backgroundColor: color,
          borderWidth: 0,
          borderRadius: 3,
          maxBarThickness: 28,
        },
      ],
    }),
    [points, title, color]
  )

  const options = useMemo<ChartOptions<'bar'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10 }, color: 'rgb(100,116,139)' },
        },
        y: {
          beginAtZero: true,
          ticks: { font: { size: 10 }, color: 'rgb(100,116,139)' },
          grid: { color: 'rgba(148,163,184,0.25)' },
        },
      },
    }),
    []
  )

  return (
    <ChartShell title={title} className={className}>
      <Bar data={data} options={options} />
    </ChartShell>
  )
}

type LineProps = {
  title: string
  points: ReportLinePoint[]
  color?: string
  className?: string
}

export function OdorReportLineChart({
  title,
  points,
  color = 'rgb(239, 68, 68)',
  className,
}: LineProps) {
  const data = useMemo<ChartData<'line'>>(
    () => ({
      labels: points.map((p) => p.label),
      datasets: [
        {
          label: title,
          data: points.map((p) => p.value),
          borderColor: color,
          backgroundColor: 'rgba(239, 68, 68, 0.08)',
          borderWidth: 1.5,
          pointRadius: 2.5,
          pointHoverRadius: 4,
          tension: 0.3,
          fill: true,
        },
      ],
    }),
    [points, title, color]
  )

  const options = useMemo<ChartOptions<'line'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10 }, color: 'rgb(100,116,139)' },
        },
        y: {
          beginAtZero: true,
          ticks: { font: { size: 10 }, color: 'rgb(100,116,139)' },
          grid: { color: 'rgba(148,163,184,0.25)' },
        },
      },
    }),
    []
  )

  return (
    <ChartShell title={title} className={className}>
      <Line data={data} options={options} />
    </ChartShell>
  )
}

type MultiMetricProps = {
  title: string
  labels: string[]
  series: Array<{ key: string; label: string; color: string; values: number[] }>
  className?: string
}

/** 카드 지표 전부 — 그룹 막대 + 파란 지표는 꺾은선 */
export function OdorReportMultiMetricChart({
  title,
  labels,
  series,
  className,
}: MultiMetricProps) {
  const data = useMemo(
    () => ({
      labels,
      datasets: series.map((s) => {
        if (isBlueSeriesColor(s.color)) {
          return {
            type: 'line' as const,
            label: s.label,
            data: s.values,
            borderColor: s.color,
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 2.5,
            pointHoverRadius: 4,
            pointBackgroundColor: s.color,
            tension: 0.3,
            fill: false,
            order: 0,
          }
        }
        return {
          type: 'bar' as const,
          label: s.label,
          data: s.values,
          backgroundColor: s.color,
          borderWidth: 0,
          borderRadius: 2,
          maxBarThickness: 18,
          order: 1,
        }
      }),
    }),
    [labels, series]
  )

  const options = useMemo<ChartOptions<'bar'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 10, font: { size: 10 }, color: 'rgb(100,116,139)' },
        },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10 }, color: 'rgb(100,116,139)', maxRotation: 0 },
        },
        y: {
          beginAtZero: true,
          ticks: { font: { size: 10 }, color: 'rgb(100,116,139)' },
          grid: { color: 'rgba(148,163,184,0.25)' },
        },
      },
    }),
    []
  )

  return (
    <ChartShell title={title} className={className}>
      <Chart type="bar" data={data as ChartData<'bar'>} options={options} />
    </ChartShell>
  )
}

type PieProps = {
  title: string
  slices: ReportPieSlice[]
  className?: string
}

export function OdorReportPieChart({ title, slices, className }: PieProps) {
  const data = useMemo<ChartData<'pie'>>(
    () => ({
      labels: slices.map((s) => s.label),
      datasets: [
        {
          data: slices.map((s) => s.value),
          backgroundColor: slices.map((s) => s.color),
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.7)',
        },
      ],
    }),
    [slices]
  )

  const options = useMemo<ChartOptions<'pie'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { boxWidth: 10, font: { size: 10 }, color: 'rgb(100,116,139)' },
        },
        tooltip: { mode: 'nearest' },
      },
    }),
    []
  )

  return (
    <ChartShell title={title} className={className}>
      <Pie data={data} options={options} />
    </ChartShell>
  )
}
