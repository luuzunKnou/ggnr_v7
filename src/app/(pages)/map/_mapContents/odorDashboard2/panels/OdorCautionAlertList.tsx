'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronsRight } from 'lucide-react'
import {
  MOCK_CAUTION_ALERTS,
  formatAlertTime,
  gradeDotColor,
  sortCautionAlerts,
  type OdorAlertItem,
} from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import { cn } from '@/lib/utils'
import { ODOR_DASHBOARD2_ALERT_PAGE_SIZE } from '../odorDashboard2Config'

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
  const [page, setPage] = useState(1)

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

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border">
        <div className="standard-list-scroll min-h-0 flex-1">
          <table className="standard-list-table">
            <thead className="standard-table-thead">
              <tr>
                <th className="standard-table-th standard-table-th-left">지점</th>
                <th className="standard-table-th standard-table-th-left w-[20%]">발생</th>
                <th className="standard-table-th standard-table-th-left w-[14%]">농도</th>
                <th className="standard-table-th standard-table-th-left w-[14%]">인지</th>
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={4} className="standard-table-empty">
                    주의 경보가 없습니다.
                  </td>
                </tr>
              ) : (
                paged.map((row) => {
                  const selected = selectedAlertId === row.id
                  return (
                    <tr
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
                        'standard-list-row cursor-pointer',
                        selected && 'standard-list-row-selected'
                      )}
                    >
                      <td className="standard-table-td-text" title={row.sensorKorNm}>
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: gradeDotColor(row.grade) }}
                            title={`${row.grade}등급`}
                            aria-label={`${row.grade}등급`}
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{row.sensorKorNm}</span>
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {row.sensorNm} · {row.agency}
                              {row.abatementRunning ? ' · 가동' : ''}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td
                        className="standard-table-td-date"
                        title={formatAlertTime(row.occurredAt)}
                      >
                        {formatAlertTime(row.occurredAt)}
                      </td>
                      <td className="standard-table-td-date tabular-nums font-semibold">
                        {row.ppm.toFixed(1)}
                      </td>
                      <td className="standard-table-td-compact">
                        <span
                          className={cn(
                            'standard-status-badge',
                            row.confirmed
                              ? 'standard-status-badge-muted'
                              : 'standard-status-badge-primary'
                          )}
                        >
                          {row.confirmed ? '인지' : '미인지'}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
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
