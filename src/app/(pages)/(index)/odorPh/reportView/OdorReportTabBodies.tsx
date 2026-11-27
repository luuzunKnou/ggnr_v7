'use client'

import dynamic from 'next/dynamic'
import type { ReactNode } from 'react'
import {
  buildAbatementReportMock,
  buildActionReportMock,
  buildAlertReportMock,
  buildComplaintReportMock,
  type ReportStatCard,
  type ReportTableCol,
  type ReportTableRow,
} from './odorReportViewMock'
import {
  buildCardMetricChartMock,
  scaleCardsForPeriod,
} from './odorReportCardChartMock'
import { OdorReportDataTable } from './OdorReportDataTable'
import { OdorReportStatCards } from './OdorReportStatCards'
import { cn } from '@/lib/utils'
import type { OdorReportTabId } from './odorReportViewConfig'
import {
  defaultOdorReportPeriodState,
  type OdorReportPeriodState,
} from './OdorReportPeriodBar'

const OdorReportMultiMetricChart = dynamic(
  () => import('./OdorReportCharts').then((m) => m.OdorReportMultiMetricChart),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-[160px] flex-1 animate-pulse rounded border border-border bg-muted/30" />
    ),
  }
)

/** stack: 카드→그래프→집계표 / split: 좌 카드+그래프 · 우 집계표 */
function ReportMainLayout({
  cards,
  charts,
  tableTitle,
  tableCols,
  tableRows,
  layout = 'stack',
  className,
}: {
  cards: ReportStatCard[]
  charts: ReactNode
  tableTitle: string
  tableCols: ReportTableCol[]
  tableRows: ReportTableRow[]
  layout?: 'stack' | 'split'
  className?: string
}) {
  if (layout === 'stack') {
    return (
      <div
        className={cn(
          'flex h-full min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2',
          className
        )}
      >
        <OdorReportStatCards cards={cards} className="shrink-0" />
        <div className="flex min-h-[160px] min-w-0 flex-2 flex-col overflow-hidden">
          {charts}
        </div>
        <OdorReportDataTable
          title={tableTitle}
          cols={tableCols}
          rows={tableRows}
          className="min-h-[180px] min-w-0 flex-3"
        />
      </div>
    )
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-1 items-stretch gap-2 overflow-hidden p-2', className)}>
      <div className="flex h-full min-h-0 min-w-0 flex-2 flex-col gap-2 overflow-hidden">
        <OdorReportStatCards cards={cards} className="shrink-0" />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
          {charts}
        </div>
      </div>
      <OdorReportDataTable
        title={tableTitle}
        cols={tableCols}
        rows={tableRows}
        className="h-full min-h-0 min-w-0 flex-3"
      />
    </div>
  )
}

function CardMetricsChart({
  cards,
  period,
}: {
  cards: ReportStatCard[]
  period: OdorReportPeriodState
}) {
  const chart = buildCardMetricChartMock(cards, period)
  return (
    <OdorReportMultiMetricChart
      title={chart.title}
      labels={chart.labels}
      series={chart.series}
      className="h-full min-h-0 flex-1"
    />
  )
}

type BodyProps = {
  period?: OdorReportPeriodState
  layout?: 'stack' | 'split'
  className?: string
}

function resolvePeriod(period?: OdorReportPeriodState): OdorReportPeriodState {
  return period ?? defaultOdorReportPeriodState()
}

export function OdorReportAbatementBody({ period, layout, className }: BodyProps) {
  const p = resolvePeriod(period)
  const data = buildAbatementReportMock()
  const cards = scaleCardsForPeriod(data.cards, p.mode)
  return (
    <ReportMainLayout
      className={className}
      layout={layout}
      cards={cards}
      charts={<CardMetricsChart cards={data.cards} period={p} />}
      tableTitle="지점별 저감장치 동작 집계표"
      tableCols={data.stationCols}
      tableRows={data.stationRows}
    />
  )
}

export function OdorReportAlertBody({ period, layout, className }: BodyProps) {
  const p = resolvePeriod(period)
  const data = buildAlertReportMock()
  const cards = scaleCardsForPeriod(data.cards, p.mode)
  return (
    <ReportMainLayout
      className={className}
      layout={layout}
      cards={cards}
      charts={<CardMetricsChart cards={data.cards} period={p} />}
      tableTitle="지점별 경보 집계표"
      tableCols={data.stationCols}
      tableRows={data.stationRows}
    />
  )
}

export function OdorReportComplaintBody({ period, layout, className }: BodyProps) {
  const p = resolvePeriod(period)
  const data = buildComplaintReportMock()
  const cards = scaleCardsForPeriod(data.cards, p.mode)
  return (
    <ReportMainLayout
      className={className}
      layout={layout}
      cards={cards}
      charts={<CardMetricsChart cards={data.cards} period={p} />}
      tableTitle="민원 접수 목록"
      tableCols={data.listCols}
      tableRows={data.listRows}
    />
  )
}

export function OdorReportActionBody({ period, layout, className }: BodyProps) {
  const p = resolvePeriod(period)
  const data = buildActionReportMock()
  const cards = scaleCardsForPeriod(data.cards, p.mode)
  return (
    <ReportMainLayout
      className={className}
      layout={layout}
      cards={cards}
      charts={<CardMetricsChart cards={data.cards} period={p} />}
      tableTitle="조치내역(현장 조사) 목록표"
      tableCols={data.listCols}
      tableRows={data.listRows}
    />
  )
}

export function OdorReportTabFullBody({
  tab,
  period,
  layout = 'stack',
}: {
  tab: OdorReportTabId
  period?: OdorReportPeriodState
  layout?: 'stack' | 'split'
}) {
  const p = resolvePeriod(period)
  const body =
    tab === 'abatement' ? (
      <OdorReportAbatementBody period={p} layout={layout} />
    ) : tab === 'alert' ? (
      <OdorReportAlertBody period={p} layout={layout} />
    ) : tab === 'complaint' ? (
      <OdorReportComplaintBody period={p} layout={layout} />
    ) : tab === 'action' ? (
      <OdorReportActionBody period={p} layout={layout} />
    ) : null
  return <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">{body}</div>
}
