'use client'

import type { ReactNode } from 'react'
import { AlertTriangle, RefreshCw, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCommTime } from './odorSystemStatusJudge'
import { OdorSystemStatusDiagram } from './OdorSystemStatusDiagram'
import { OdorSystemStatusExpandPanel } from './OdorSystemStatusExpandPanel'
import type { OdorCommNodeView } from './odorSystemStatusTypes'
import {
  ODOR_COMM_EXPAND_DEFAULT_WIDTH,
  type OdorCommStatusFilter,
} from './odorSystemStatusTypes'
import {
  useOdorSystemStatusModel,
  type OdorSystemStatusModel,
} from './useOdorSystemStatusModel'

type ViewProps = {
  variant: 'index' | 'map'
  model: OdorSystemStatusModel
  onClose?: () => void
  onGoToStation?: (node: OdorCommNodeView) => void
  /** inline: Index 본문 우측 / none: 지도 셸이 별도 확장 패널 */
  expandMode?: 'inline' | 'none'
  className?: string
  /** 헤더 우측(새로고침·닫기 앞) — UI select 등 */
  headerExtra?: ReactNode
}

const FILTER_OPTIONS: Array<{ key: OdorCommStatusFilter; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'ok', label: '정상' },
  { key: 'abnormal', label: '이상' },
]

export function OdorSystemStatusPanelView({
  variant,
  model,
  onClose,
  onGoToStation,
  expandMode = 'inline',
  className,
  headerExtra,
}: ViewProps) {
  const {
    graph,
    visibleViews,
    visibleLinks,
    filter,
    setFilter,
    autoRefresh,
    setAutoRefresh,
    refresh,
    selectedId,
    selected,
    sensorDetail,
    agencySensors,
    selectNode,
    selectSensor,
    setSensorDetailId,
    closeExpand,
    disconnectSensors,
    summary,
    setBannerDismissed,
    showBanner,
  } = model

  const summaryCards: Array<{
    key: OdorCommStatusFilter
    title: string
    sub: string
    value: number
    accent: string
  }> = [
    {
      key: 'ok',
      title: '정상장비',
      sub: '통신 정상',
      value: summary.okCount,
      accent: '#22c55e',
    },
    {
      key: 'abnormal',
      title: '통신이상',
      sub: '지연·두절',
      value: summary.abnormalCount,
      accent: '#ef4444',
    },
    {
      key: 'all',
      title: '센서 수',
      sub: '전체',
      value: summary.sensorCount,
      accent: '#3b82f6',
    },
  ]

  const expandPanel =
    selected != null ? (
      <OdorSystemStatusExpandPanel
        node={selected}
        sensorDetail={sensorDetail}
        agencySensors={agencySensors}
        selectedSensorId={sensorDetail?.id ?? null}
        onSelectSensor={(s) => selectSensor(s.id)}
        onBackToAgencyList={() => setSensorDetailId(null)}
        onGoToStation={onGoToStation}
        onClose={closeExpand}
        className="h-full w-full"
      />
    ) : null

  return (
    <div className={cn('flex h-full min-h-0 flex-1 flex-col overflow-hidden', className)}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-foreground">시스템 상태•통신</p>
          <p className="truncate text-[10px] text-muted-foreground">
            조회 기준: {formatCommTime(graph.judgedAt)}
            {variant === 'map' ? ' · 통신계통도' : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {headerExtra}
          <button
            type="button"
            title="새로고침"
            onClick={refresh}
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          </button>
          {onClose ? (
            <button
              type="button"
              title="닫기"
              onClick={onClose}
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border px-2 py-1.5">
        <div className="grid grid-cols-3 gap-1.5">
          {summaryCards.map((c) => {
            const active = filter === c.key
            return (
              <button
                key={c.key}
                type="button"
                title={`${c.title} ${c.value}`}
                onClick={() => setFilter(c.key)}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-1.5 rounded-[5px] border border-border bg-card px-2.5 py-2 text-left',
                  active && 'ring-1 ring-primary/40'
                )}
                style={{
                  borderLeftWidth: '4px',
                  borderLeftColor: c.accent,
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[10px] font-medium tracking-wide text-muted-foreground/55">
                    {c.title}
                    <span className="ml-1 font-normal normal-case opacity-80">({c.sub})</span>
                  </div>
                  <span className="text-xl font-bold leading-none text-foreground tabular-nums">
                    {c.value}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded border border-border p-0.5">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                title={opt.label}
                onClick={() => setFilter(opt.key)}
                className={cn(
                  'cursor-pointer rounded px-2 py-0.5 text-[11px] font-medium',
                  filter === opt.key
                    ? 'bg-primary text-white'
                    : 'text-muted-foreground hover:bg-muted/60'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 cursor-pointer accent-primary"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            30초 자동갱신
          </label>
        </div>
      </div>

      {showBanner ? (
        <div className="flex shrink-0 items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-2 py-1.5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-destructive">
              통신 두절 {disconnectSensors.length}건 — 장애 경보로 연동됨
            </p>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
              {disconnectSensors
                .slice(0, 4)
                .map((s) => s.label)
                .join(', ')}
              {disconnectSensors.length > 4 ? ' …' : ''}
            </p>
          </div>
          <button
            type="button"
            title="배너 닫기"
            onClick={() => setBannerDismissed(true)}
            className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-destructive/80 hover:bg-destructive/15"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <OdorSystemStatusDiagram
            nodes={visibleViews}
            links={visibleLinks}
            selectedId={selectedId}
            onSelect={selectNode}
          />
          {!selectedId ? (
            <p className="px-3 pb-3 text-center text-[10px] text-muted-foreground">
              계층·업체를 선택하면 오른쪽에 상세·기기 목록이 열립니다.
            </p>
          ) : null}
        </div>

        {expandMode === 'inline' && expandPanel ? (
          <div
            className="flex h-full shrink-0 flex-col border-l border-border"
            style={{ width: ODOR_COMM_EXPAND_DEFAULT_WIDTH }}
          >
            {expandPanel}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Index 등 — 내부에서 모델 생성 + 우측 인라인 확장 */
export function OdorSystemStatusPanel({
  variant,
  onClose,
  onGoToStation,
  className,
}: {
  variant: 'index' | 'map'
  onClose?: () => void
  onGoToStation?: (node: OdorCommNodeView) => void
  className?: string
}) {
  const model = useOdorSystemStatusModel()
  return (
    <OdorSystemStatusPanelView
      variant={variant}
      model={model}
      onClose={onClose}
      onGoToStation={onGoToStation}
      expandMode="inline"
      className={className}
    />
  )
}
