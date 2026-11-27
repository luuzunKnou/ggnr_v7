'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronsRight } from 'lucide-react'
import {
  MOCK_RECENT_ALERTS,
  type OdorAlertItem,
} from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import { cn } from '@/lib/utils'
import { ODOR_DASHBOARD2_ALERT_PAGE_SIZE } from '../odorDashboard2Config'
import { OdorAlertCardItem } from './OdorAlertCardItem'

type Props = {
  items?: OdorAlertItem[]
  onGoAlertList?: () => void
  /** true면 제목·경보목록 헤더 숨김 (플로팅 헤더 사용 시) */
  hideHeader?: boolean
  onSelectAlert?: (alert: OdorAlertItem) => void
  selectedAlertId?: string | null
}

export function OdorRecentAlertList({
  items = MOCK_RECENT_ALERTS,
  onGoAlertList,
  hideHeader = false,
  onSelectAlert,
  selectedAlertId = null,
}: Props) {
  const [agencyFilter, setAgencyFilter] = useState<string>('all')
  const [page, setPage] = useState(1)

  const agencies = useMemo(() => {
    const set = new Set<string>()
    for (const row of items) {
      const a = row.agency.trim()
      if (a) set.add(a)
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'))
  }, [items])

  const rows = useMemo(() => {
    const filtered =
      agencyFilter === 'all' ? items : items.filter((r) => r.agency === agencyFilter)
    return [...filtered].sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
    )
  }, [items, agencyFilter])

  const pageCount = Math.max(1, Math.ceil(rows.length / ODOR_DASHBOARD2_ALERT_PAGE_SIZE) || 1)
  const safePage = Math.min(page, pageCount)
  const paged = useMemo(() => {
    const start = (safePage - 1) * ODOR_DASHBOARD2_ALERT_PAGE_SIZE
    return rows.slice(start, start + ODOR_DASHBOARD2_ALERT_PAGE_SIZE)
  }, [rows, safePage])

  useEffect(() => {
    setPage(1)
  }, [agencyFilter])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const from = rows.length === 0 ? 0 : (safePage - 1) * ODOR_DASHBOARD2_ALERT_PAGE_SIZE + 1
  const to = Math.min(safePage * ODOR_DASHBOARD2_ALERT_PAGE_SIZE, rows.length)

  return (
    <section
      className={cn(
        'flex min-h-0 flex-col overflow-hidden',
        hideHeader ? 'h-full' : 'h-full border border-border p-3'
      )}
    >
      {!hideHeader ? (
        <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">최근 경보</h2>
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
      <p className="mb-1.5 shrink-0 px-1.5 text-[11px] text-muted-foreground">
        방금 발생한 악취 경보
      </p>

      <div className="standard-filter-chips mb-1.5 shrink-0 px-1.5">
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

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border">
        <div className="standard-list-scroll min-h-0 flex-1 px-1.5 py-1.5">
          {paged.length === 0 ? (
            <p className="standard-table-empty px-2 py-6 text-center">최근 경보가 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {paged.map((row) => (
                <li key={row.id}>
                  <OdorAlertCardItem
                    alert={row}
                    selected={selectedAlertId === row.id}
                    onSelect={onSelectAlert}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="standard-list-footer flex shrink-0 items-center justify-between gap-2">
          <span className="tabular-nums">
            {rows.length === 0
              ? '0건'
              : `${from}–${to} / ${rows.length.toLocaleString()}건`}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="이전"
              disabled={safePage <= 1}
              className="standard-detail-action-btn cursor-pointer disabled:cursor-not-allowed"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              이전
            </button>
            <span className="px-1 text-[11px] text-muted-foreground">{safePage}페이지</span>
            <button
              type="button"
              title="다음"
              disabled={safePage >= pageCount}
              className="standard-detail-action-btn cursor-pointer disabled:cursor-not-allowed"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              다음
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
