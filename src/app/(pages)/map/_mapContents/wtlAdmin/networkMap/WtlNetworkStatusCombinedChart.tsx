'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type TooltipItem,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { Scaling } from 'lucide-react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useResolvedThemeSafe } from '@/app/(pages)/(index)/theme-provider'
import type {
  WtlNetworkDipMatrix,
  WtlNetworkFilterMeta,
  WtlNetworkSaaMatrix,
  WtlNetworkStatusListFilter,
} from './wtlNetworkTypes'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  BarController,
  Tooltip,
  Legend
)

export type WtlNetworkStatusChartKind = 'diameter' | 'year' | 'saa'

const CHART_KIND_OPTIONS: { id: WtlNetworkStatusChartKind; label: string }[] = [
  { id: 'diameter', label: '관경별' },
  { id: 'year', label: '연도별' },
  { id: 'saa', label: '관용도별' },
]

const SERIES_COLORS = [
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#64748b',
  '#14b8a6',
  '#a855f7',
]

const CHART_ANIMATION = {
  duration: 650,
  easing: 'easeOutQuart' as const,
}

function formatLengthMeters(meters: number) {
  if (meters >= 1000) {
    const km = meters / 1000
    const text = Number.isInteger(km) ? String(km) : km.toFixed(1)
    return `${text}㎞`
  }
  return `${Math.round(meters)}m`
}

function isDipMatrix(
  data: unknown
): data is WtlNetworkDipMatrix {
  return (
    !!data &&
    typeof data === 'object' &&
    Array.isArray((data as WtlNetworkDipMatrix).columns) &&
    Array.isArray((data as WtlNetworkDipMatrix).rows)
  )
}

function isSaaMatrix(data: unknown): data is WtlNetworkSaaMatrix {
  return (
    !!data &&
    typeof data === 'object' &&
    Array.isArray((data as WtlNetworkSaaMatrix).columns) &&
    Array.isArray((data as WtlNetworkSaaMatrix).rows)
  )
}

type Props = {
  mapSources: string[]
  listFilter: WtlNetworkStatusListFilter
  filterMeta?: WtlNetworkFilterMeta | null
  className?: string
  /** LengthTable SectionTitle 과 동일 톤 */
  solidHeader?: boolean
  /** 현재 탭(관경/연도/관용도)에 맞는 도표 확대 모달 */
  onExpand?: (kind: WtlNetworkStatusChartKind) => void
}

/**
 * 관경·연도·관용도 상세(교차표)와 동일 데이터 —
 * X=관경/연도/관용도, 시리즈(범례)=관재질, Y=연장(m)
 *
 * 필터 변경 시에만 3종 매트릭스를 한 번에 조회.
 * 탭·관재질 범례는 캐시 데이터에서 표시/가림만 한다.
 */
export function WtlNetworkStatusCombinedChart({
  mapSources,
  listFilter,
  className,
  solidHeader = false,
  onExpand,
}: Props) {
  const theme = useResolvedThemeSafe()
  const isDark = theme === 'dark'
  const [kind, setKind] = useState<WtlNetworkStatusChartKind>('diameter')
  const [loading, setLoading] = useState(true)
  const [dipMatrix, setDipMatrix] = useState<WtlNetworkDipMatrix | null>(null)
  const [yearMatrix, setYearMatrix] = useState<WtlNetworkDipMatrix | null>(null)
  const [saaMatrix, setSaaMatrix] = useState<WtlNetworkSaaMatrix | null>(null)
  /** 가린 관재질 라벨 — 재조회 없이 시리즈만 숨김 */
  const [hiddenMaterials, setHiddenMaterials] = useState<ReadonlySet<string>>(
    () => new Set()
  )

  const mapSourcesSig = [...mapSources].map(String).sort().join('\u0001')
  const mapSourcesParam = useMemo(
    () => mapSources.map(String).filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 서명으로 안정화
    [mapSourcesSig]
  )
  const listFilterSig = JSON.stringify(listFilter ?? {})
  const listFilterParam = useMemo(
    () => listFilter,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 서명으로 안정화
    [listFilterSig]
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setDipMatrix(null)
    setYearMatrix(null)
    setSaaMatrix(null)
    setHiddenMaterials(new Set())
    const baseParams = {
      mapSources: mapSourcesParam,
      listFilter: listFilterParam,
    }
    ;(async () => {
      try {
        const [dipRes, yearRes, saaRes] = await Promise.all([
          call('', 'POST', {
            service: 'wtlNetworkService',
            action: 'getWtlNetworkStatusDipMatrix',
            params: baseParams,
          }),
          call('', 'POST', {
            service: 'wtlNetworkService',
            action: 'getWtlNetworkStatusYearMatrix',
            params: baseParams,
          }),
          call('', 'POST', {
            service: 'wtlNetworkService',
            action: 'getWtlNetworkStatusSaaMatrix',
            params: baseParams,
          }),
        ])
        if (cancelled) return
        const dipData = dipRes?.data ?? dipRes
        const yearData = yearRes?.data ?? yearRes
        const saaData = saaRes?.data ?? saaRes
        setDipMatrix(isDipMatrix(dipData) ? dipData : null)
        setYearMatrix(isDipMatrix(yearData) ? yearData : null)
        setSaaMatrix(isSaaMatrix(saaData) ? saaData : null)
      } catch {
        if (!cancelled) {
          setDipMatrix(null)
          setYearMatrix(null)
          setSaaMatrix(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mapSourcesParam, listFilterParam])

  const chartPayload = useMemo(() => {
    if (kind === 'saa') {
      if (!saaMatrix) return null
      const columns = saaMatrix.columns
      /** 연장(Y)이 있는 관재질만 범례 시리즈로 */
      const rows = saaMatrix.rows.filter(
        (r) =>
          !r.isTotal &&
          columns.some((c) => Number(r.lengths[c] ?? 0) > 0)
      )
      /** X축: 값이 있는 관용도만 */
      const activeCols = columns.filter((c) =>
        rows.some((r) => Number(r.lengths[c] ?? 0) > 0)
      )
      return {
        /** X = 관용도 */
        labels: activeCols.map((c) => saaMatrix.columnLabels[c] ?? c),
        /** 시리즈 = 관재질 */
        series: rows.map((r) => ({
          label: r.label,
          data: activeCols.map((c) => Number(r.lengths[c] ?? 0)),
        })),
        xAxisTitle: '관용도',
      }
    }
    const matrix = kind === 'year' ? yearMatrix : dipMatrix
    if (!matrix) return null
    const columns = matrix.columns
    const rows = matrix.rows.filter(
      (r) =>
        !r.isTotal &&
        columns.some((c) => Number(r.lengths[c] ?? 0) > 0)
    )
    const activeCols = columns.filter((c) =>
      rows.some((r) => Number(r.lengths[c] ?? 0) > 0)
    )
    return {
      /** X = 관경/연도 */
      labels: activeCols,
      /** 시리즈 = 관재질 */
      series: rows.map((r) => ({
        label: r.label,
        data: activeCols.map((c) => Number(r.lengths[c] ?? 0)),
      })),
      xAxisTitle: kind === 'year' ? '연도' : '관경',
    }
  }, [kind, dipMatrix, yearMatrix, saaMatrix])

  /** 관경/연도/관용도마다 관재질을 나란히 비교 — 그룹(비누적) 막대. 가림은 hidden만 */
  const chartData = useMemo<ChartData<'bar'> | null>(() => {
    if (!chartPayload || chartPayload.labels.length === 0) return null
    const { labels, series } = chartPayload
    const activeSeries = series.filter((s) => s.data.some((v) => v > 0))
    if (activeSeries.length === 0) return null
    return {
      labels,
      datasets: activeSeries.map((s, colorIdx) => ({
        label: s.label,
        data: s.data,
        backgroundColor: SERIES_COLORS[colorIdx % SERIES_COLORS.length],
        borderWidth: 0,
        barPercentage: 0.85,
        categoryPercentage: 0.7,
        hidden: hiddenMaterials.has(s.label),
      })),
    }
  }, [chartPayload, hiddenMaterials])

  const tickColor = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(15,23,42,0.65)'
  const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'
  const xAxisTitle = chartPayload?.xAxisTitle ?? '관경'
  const yAxisTitle = '연장'

  const chartOptions = useMemo<ChartOptions<'bar'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: CHART_ANIMATION,
      transitions: {
        active: { animation: { duration: 280 } },
        show: { animations: { y: { from: 0 } } },
        hide: { animations: { y: { to: 0 } } },
      },
      plugins: {
        /** 단면 등에서 전역 등록된 ChartDataLabels — 이 그래프에서는 막대 위 값 숨김 */
        datalabels: { display: false },
        /** 범례(관재질)는 좌측 HTML 세로 목록 — 항목 많을 때 스크롤 */
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx: TooltipItem<'bar'>) => {
              const v = typeof ctx.parsed.y === 'number' ? ctx.parsed.y : 0
              return `${ctx.dataset.label ?? ''}: ${formatLengthMeters(v)}`
            },
          },
        },
      },
      scales: {
        x: {
          stacked: false,
          ticks: {
            color: tickColor,
            font: { size: 10 },
            maxRotation: 45,
            minRotation: 0,
          },
          grid: { color: gridColor },
          title: {
            display: true,
            text: xAxisTitle,
            color: tickColor,
            font: { size: 11 },
          },
        },
        y: {
          stacked: false,
          beginAtZero: true,
          ticks: {
            color: tickColor,
            font: { size: 10 },
            callback: (value) =>
              formatLengthMeters(typeof value === 'number' ? value : Number(value)),
          },
          grid: { color: gridColor },
          title: {
            display: true,
            text: yAxisTitle,
            color: tickColor,
            font: { size: 11 },
          },
        },
      },
    }),
    [tickColor, gridColor, xAxisTitle, yAxisTitle]
  )

  const toggleMaterial = (label: string) => {
    setHiddenMaterials((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  return (
    <section
      className={cn(
        'flex shrink-0 flex-col overflow-hidden rounded border border-border bg-background',
        className
      )}
    >
      <div
        className={
          solidHeader
            ? 'standard-map-float-header shrink-0 gap-1.5 px-2 py-1 text-xs'
            : 'flex shrink-0 items-center justify-between gap-1.5 border-b border-border bg-muted/50 px-2 py-1 text-xs font-medium text-foreground'
        }
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="h-3 w-0.5 shrink-0 rounded-sm bg-primary" aria-hidden />
          <span className="truncate">관로 연장 그래프</span>
        </div>
        {onExpand ? (
          <button
            type="button"
            onClick={() => onExpand(kind)}
            className="cursor-pointer shrink-0 rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground/90"
            title="확대"
            aria-label="확대"
          >
            <Scaling className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <div className="standard-filter-chips shrink-0 overflow-x-auto px-1.5 py-1">
        {CHART_KIND_OPTIONS.map((opt) => {
          const on = opt.id === kind
          return (
            <button
              key={opt.id}
              type="button"
              title={opt.label}
              className={cn(
                'standard-filter-chip cursor-pointer',
                on && 'standard-filter-chip-active'
              )}
              onClick={() => setKind(opt.id)}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
      {/* 그래프 본체 높이 200px 고정 — 좌측 관재질 목록만 이 높이 안에서 스크롤 */}
      <div className="flex h-50 min-h-50 w-full min-w-0 shrink-0 overflow-hidden">
        {chartData && chartData.datasets.length > 0 ? (
          <aside
            className="flex h-full w-22 shrink-0 flex-col overflow-hidden border-r border-border"
            title="관재질 범례"
          >
            <ul className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overflow-x-hidden px-1.5 py-1.5">
              {chartData.datasets.map((ds, i) => {
                const color =
                  typeof ds.backgroundColor === 'string'
                    ? ds.backgroundColor
                    : SERIES_COLORS[i % SERIES_COLORS.length]
                const label = String(ds.label ?? '')
                const hidden = hiddenMaterials.has(label)
                return (
                  <li key={`${label}-${i}`} className="m-0 p-0">
                    <button
                      type="button"
                      title={hidden ? `${label} 표시` : `${label} 숨김`}
                      aria-label={hidden ? `${label} 표시` : `${label} 숨김`}
                      aria-pressed={!hidden}
                      onClick={() => toggleMaterial(label)}
                      className={cn(
                        'flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded px-0.5 py-0.5 text-left text-xs leading-snug hover:bg-muted/60',
                        hidden
                          ? 'text-muted-foreground/45 line-through'
                          : 'text-muted-foreground'
                      )}
                    >
                      <span
                        className={cn(
                          'h-2.5 w-2.5 shrink-0 rounded-md',
                          hidden && 'opacity-40'
                        )}
                        style={{ backgroundColor: color }}
                        aria-hidden
                      />
                      <span className="min-w-0 truncate">{label}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>
        ) : null}
        <div className="relative h-full min-w-0 flex-1 overflow-hidden px-1 pt-1">
          {loading ? (
            <p className="flex h-full items-center justify-center text-xs text-muted-foreground">
              그래프 집계 중…
            </p>
          ) : !chartData ? (
            <p className="flex h-full items-center justify-center text-xs text-muted-foreground">
              해당 자료가 없습니다.
            </p>
          ) : (
            <Bar data={chartData} options={chartOptions} />
          )}
        </div>
      </div>
    </section>
  )
}
