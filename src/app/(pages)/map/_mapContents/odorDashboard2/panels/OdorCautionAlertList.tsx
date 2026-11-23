'use client'

import { useMemo, useState } from 'react'
import { ChevronsRight } from 'lucide-react'
import {
  MOCK_CAUTION_ALERTS,
  formatAlertTime,
  gradeDotColor,
  sortCautionAlerts,
  type OdorAlertItem,
} from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import { cn } from '@/lib/utils'

type Props = {
  items?: OdorAlertItem[]
  onGoAlertList?: () => void
  /** true면 제목·경보목록 헤더 숨김 (플로팅 헤더 사용 시) */
  hideHeader?: boolean
  onSelectAlert?: (alert: OdorAlertItem) => void
  selectedAlertId?: string | null
}

export function OdorCautionAlertList({
  items = MOCK_CAUTION_ALERTS,
  onGoAlertList,
  hideHeader = false,
  onSelectAlert,
  selectedAlertId = null,
}: Props) {
  const [agencyFilter, setAgencyFilter] = useState<string>('all')

  const grade3 = useMemo(() => items.filter((i) => i.grade === 3), [items])

  const agencies = useMemo(() => {
    const set = new Set<string>()
    for (const row of grade3) {
      const a = row.agency.trim()
      if (a) set.add(a)
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'))
  }, [grade3])

  const rows = useMemo(() => {
    const filtered =
      agencyFilter === 'all' ? grade3 : grade3.filter((r) => r.agency === agencyFilter)
    return sortCautionAlerts(filtered)
  }, [grade3, agencyFilter])

  return (
    <section
      className={cn(
        'flex min-h-0 flex-col overflow-hidden',
        hideHeader ? 'h-full p-2' : 'h-full border border-border p-3'
      )}
    >
      {!hideHeader ? (
        <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">주의 경보 목록</h2>
          <button
            type="button"
            title="경보목록"
            onClick={() => onGoAlertList?.()}
            className="inline-flex cursor-pointer items-center gap-0.5 border-0 bg-transparent p-0 text-[12px] font-normal text-muted-foreground hover:text-foreground"
          >
            경보목록
            <ChevronsRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : null}
      <p className="mb-1.5 shrink-0 text-[11px] text-muted-foreground">3등급 주의 경보 · 미인지 우선</p>

      <div className="standard-filter-chips mb-1.5 shrink-0">
        <button
          type="button"
          title="전체"
          onClick={() => setAgencyFilter('all')}
          className={cn(
            'standard-filter-chip cursor-pointer',
            agencyFilter === 'all' && 'standard-filter-chip-active'
          )}
        >
          전체
        </button>
        {agencies.map((agency) => (
          <button
            key={agency}
            type="button"
            title={agency}
            onClick={() => setAgencyFilter(agency)}
            className={cn(
              'standard-filter-chip max-w-[7.5rem] cursor-pointer truncate',
              agencyFilter === agency && 'standard-filter-chip-active'
            )}
          >
            {agency}
          </button>
        ))}
      </div>

      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {rows.length === 0 ? (
          <li className="py-6 text-center text-xs text-muted-foreground">주의 경보가 없습니다.</li>
        ) : (
          rows.map((row) => (
            <li
              key={row.id}
              role="button"
              tabIndex={0}
              title={`${row.sensorKorNm} 상세`}
              onClick={() => onSelectAlert?.(row)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelectAlert?.(row)
                }
              }}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 transition-colors',
                'hover:bg-slate-100 dark:hover:bg-white/15',
                selectedAlertId === row.id &&
                  'border-primary/40 bg-primary/10 hover:bg-primary/15 dark:hover:bg-primary/25'
              )}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: gradeDotColor(row.grade) }}
                title={`${row.grade}등급`}
                aria-label={`${row.grade}등급`}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{row.sensorKorNm}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {row.sensorNm} · {formatAlertTime(row.occurredAt)} ·{' '}
                  <span
                    className={cn(
                      row.abatementRunning
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-muted-foreground'
                    )}
                  >
                    {row.abatementRunning ? '저감가동' : '미가동'}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="text-[12px] font-semibold tabular-nums text-foreground">
                  {row.ppm.toFixed(1)}
                  <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">ppm</span>
                </span>
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                    row.confirmed
                      ? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                      : 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                  )}
                >
                  {row.confirmed ? '인지' : '미인지'}
                </span>
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  )
}
