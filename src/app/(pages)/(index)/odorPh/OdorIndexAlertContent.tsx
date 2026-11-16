'use client'

import { useMemo, useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/app/shadcnComponents/ui/card'
import {
  MOCK_CAUTION_ALERTS,
  MOCK_RECENT_ALERTS,
  formatAlertTime,
  gradeDotColor,
  sortCautionAlerts,
  type OdorAlertItem,
} from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import { getOdorIndexMenuDescription } from '@/app/(pages)/(index)/odorPh/odorIndexMenus'
import { cn } from '@/lib/utils'

type ConfirmFilter = 'all' | 'confirmed' | 'unconfirmed'
type AgencyFilter = 'all' | '가람환경기술' | '디오솔류션'

const AGENCY_OPTIONS: Array<{ key: AgencyFilter; label: string }> = [
  { key: 'all', label: '전체' },
  { key: '가람환경기술', label: '가람환경기술' },
  { key: '디오솔류션', label: '디오 솔류션' },
]

const CONFIRM_OPTIONS: Array<{ key: ConfirmFilter; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'confirmed', label: '확인' },
  { key: 'unconfirmed', label: '미확인' },
]

function buildAlertPool(): OdorAlertItem[] {
  const map = new Map<string, OdorAlertItem>()
  for (const row of [...MOCK_RECENT_ALERTS, ...MOCK_CAUTION_ALERTS]) {
    map.set(row.id, row)
  }
  return [...map.values()]
}

/** Index 콘솔 경보 목록 — 제목·설명(dev Card) + 확인/업체 칩 + 홈형 목록 */
export function OdorIndexAlertContent() {
  const [confirmFilter, setConfirmFilter] = useState<ConfirmFilter>('all')
  const [agencyFilter, setAgencyFilter] = useState<AgencyFilter>('all')

  const rows = useMemo(() => {
    let list = buildAlertPool()
    if (confirmFilter === 'confirmed') list = list.filter((r) => r.confirmed)
    if (confirmFilter === 'unconfirmed') list = list.filter((r) => !r.confirmed)
    if (agencyFilter !== 'all') list = list.filter((r) => r.agency === agencyFilter)
    return sortCautionAlerts(list)
  }, [confirmFilter, agencyFilter])

  return (
    <Card className="flex h-full min-h-0 flex-1 flex-col gap-0 overflow-hidden rounded-none border-0 py-0 shadow-none">
      <CardHeader className="shrink-0 gap-1 px-4 pb-3 pt-1 sm:px-6">
        <CardTitle className="text-xl">경보 목록</CardTitle>
        <CardDescription className="text-xs">
          {getOdorIndexMenuDescription('alertList')}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-4 pb-0 sm:px-6">
        <div className="flex shrink-0 flex-col gap-1.5">
          <div className="standard-filter-chips">
            {CONFIRM_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                title={opt.label}
                onClick={() => setConfirmFilter(opt.key)}
                className={cn(
                  'standard-filter-chip cursor-pointer',
                  confirmFilter === opt.key && 'standard-filter-chip-active'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="standard-filter-chips">
            {AGENCY_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                title={opt.label}
                onClick={() => setAgencyFilter(opt.key)}
                className={cn(
                  'standard-filter-chip cursor-pointer',
                  agencyFilter === opt.key && 'standard-filter-chip-active'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
          {rows.length === 0 ? (
            <li className="py-10 text-center text-xs text-muted-foreground">
              조건에 맞는 경보가 없습니다.
            </li>
          ) : (
            rows.map((row) => (
              <li
                key={row.id}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 transition-colors hover:bg-muted/50"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: gradeDotColor(row.grade) }}
                  title={`${row.grade}등급`}
                  aria-label={`${row.grade}등급`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">
                    {row.sensorKorNm}
                  </div>
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
                    <span className="text-muted-foreground"> · {row.agency}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[12px] font-semibold tabular-nums text-foreground">
                    {row.ppm.toFixed(1)}
                    <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">
                      ppm
                    </span>
                  </span>
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                      row.confirmed
                        ? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                        : 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                    )}
                  >
                    {row.confirmed ? '확인' : '미확인'}
                  </span>
                </div>
              </li>
            ))
          )}
        </ul>
      </CardContent>
    </Card>
  )
}
