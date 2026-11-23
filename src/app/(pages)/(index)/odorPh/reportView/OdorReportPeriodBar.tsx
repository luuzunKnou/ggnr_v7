'use client'

import { cn } from '@/lib/utils'
import {
  ODOR_REPORT_EMD_OPTIONS,
  ODOR_REPORT_PERIOD_OPTIONS,
  type OdorReportPeriodMode,
} from './odorReportViewConfig'
import { OdorReportExportButtons } from './OdorReportExportButtons'

export type OdorReportPeriodState = {
  mode: OdorReportPeriodMode
  day: string
  month: string
  from: string
  to: string
  emd: string
}

type Props = {
  value: OdorReportPeriodState
  onChange: (next: OdorReportPeriodState) => void
  /** 저감장치 탭만 읍면동 select */
  showEmd?: boolean
  className?: string
}

function todayIsoDay(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function todayIsoMonth(): string {
  return todayIsoDay().slice(0, 7)
}

export function defaultOdorReportPeriodState(): OdorReportPeriodState {
  const day = todayIsoDay()
  return {
    mode: 'monthly',
    day,
    month: todayIsoMonth(),
    from: day.slice(0, 8) + '01',
    to: day,
    emd: 'all',
  }
}

/** 일보/월보/기간 칩 + 달력 입력(+읍면동·인쇄) */
export function OdorReportPeriodBar({
  value,
  onChange,
  showEmd = false,
  className,
}: Props) {
  const set = (patch: Partial<OdorReportPeriodState>) => onChange({ ...value, ...patch })

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-2 py-1.5',
        className
      )}
    >
      <div className="standard-filter-chips">
        {ODOR_REPORT_PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            title={opt.label}
            onClick={() => set({ mode: opt.value })}
            className={cn(
              'standard-filter-chip cursor-pointer',
              value.mode === opt.value && 'standard-filter-chip-active'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {value.mode === 'daily' ? (
          <input
            type="date"
            title="일자"
            value={value.day}
            onChange={(e) => set({ day: e.target.value })}
            className="h-7 cursor-pointer rounded border border-border bg-background px-1.5 text-[11px] text-foreground"
          />
        ) : null}
        {value.mode === 'monthly' ? (
          <input
            type="month"
            title="월"
            value={value.month}
            onChange={(e) => set({ month: e.target.value })}
            className="h-7 cursor-pointer rounded border border-border bg-background px-1.5 text-[11px] text-foreground"
          />
        ) : null}
        {value.mode === 'range' ? (
          <>
            <input
              type="date"
              title="시작일"
              value={value.from}
              onChange={(e) => set({ from: e.target.value })}
              className="h-7 cursor-pointer rounded border border-border bg-background px-1.5 text-[11px] text-foreground"
            />
            <span className="text-[11px] text-muted-foreground">~</span>
            <input
              type="date"
              title="종료일"
              value={value.to}
              onChange={(e) => set({ to: e.target.value })}
              className="h-7 cursor-pointer rounded border border-border bg-background px-1.5 text-[11px] text-foreground"
            />
          </>
        ) : null}
      </div>

      {showEmd ? (
        <>
          <label className="sr-only" htmlFor="odor-report-emd">
            행정읍면동
          </label>
          <select
            id="odor-report-emd"
            title="행정읍면동"
            value={value.emd}
            onChange={(e) => set({ emd: e.target.value })}
            className="h-7 max-w-[9rem] cursor-pointer rounded border border-border bg-background px-1.5 text-[11px] text-foreground"
          >
            {ODOR_REPORT_EMD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </>
      ) : null}

      <div className="ml-auto">
        <OdorReportExportButtons />
      </div>
    </div>
  )
}
