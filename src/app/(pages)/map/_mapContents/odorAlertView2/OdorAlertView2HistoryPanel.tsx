'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ODOR_ALERT_GRADE_LABEL,
  ODOR_ALERT_KIND_LABEL,
  type OdorAlertGrade,
} from '../odorAlert/odorAlertConfig'
import { formatOdorAlertTime, type OdorAckHistoryRow } from '../odorAlert/odorAlertMock'
import { useOdorAlertStore } from '../odorAlert/odorAlertStore'

type Props = {
  onClose: () => void
  /** 플로팅 사이드 패널 — 맵 서피스 헤더 스타일 */
  variant?: 'panel' | 'float'
  className?: string
  /** 경보목록에서 선택된 경보 id — 이력 행 강조 */
  selectedAlertId?: string | null
  onSelectHistory?: (row: OdorAckHistoryRow) => void
}

const PAGE_SIZE = 10

function pageMeta(total: number, page: number) {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1)
  const safePage = Math.min(Math.max(1, page), pageCount)
  const from = total === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1
  const to = Math.min(safePage * PAGE_SIZE, total)
  const hasNext = safePage * PAGE_SIZE < total
  return { pageCount, safePage, from, to, hasNext }
}

/** 해제(인지) 이력 본문 — 풀패널 모달·플로팅 패널 공용 (표 + 페이징) */
export function OdorAlertView2HistoryPanel({
  onClose,
  variant = 'panel',
  className,
  selectedAlertId = null,
  onSelectHistory,
}: Props) {
  const { history } = useOdorAlertStore()
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return history
    return history.filter((r) =>
      [r.at, r.actor, r.sensorLabel, r.reason, r.mode, ODOR_ALERT_KIND_LABEL[r.kind]]
        .join(' ')
        .toLowerCase()
        .includes(kw)
    )
  }, [history, keyword])

  const { pageCount, safePage, from, to, hasNext } = pageMeta(filtered.length, page)

  useEffect(() => {
    setPage(1)
  }, [keyword])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const paged = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, safePage])

  const isFloat = variant === 'float'

  return (
    <div className={cn('flex h-full min-h-0 flex-1 flex-col overflow-hidden', className)}>
      {isFloat ? (
        <div className="standard-map-float-header shrink-0 border-b border-slate-200 dark:border-white/10">
          <div className="min-w-0 flex-1">
            <span className="standard-map-float-header-title">해제(인지) 이력</span>
          </div>
          <button
            type="button"
            className="standard-map-float-header-close inline-flex h-7 w-7 cursor-pointer items-center justify-center"
            onClick={onClose}
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <div
        className={cn(
          'shrink-0 border-b border-border px-2 py-1.5',
          isFloat && 'border-slate-100 dark:border-white/10'
        )}
      >
        <div className="standard-search-wrap">
          <Search className="standard-search-icon" aria-hidden />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="센서·사유·사용자 검색"
            title="검색"
            className="standard-search-input"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="standard-list-scroll min-h-0 flex-1">
          <table className="standard-list-table">
            <thead className="standard-table-thead">
              <tr>
                <th className="standard-table-th standard-table-th-left">센서</th>
                <th className="standard-table-th standard-table-th-left w-[18%]">유형</th>
                <th className="standard-table-th standard-table-th-left w-[14%]">구분</th>
                <th className="standard-table-th standard-table-th-left w-[22%]">해제시각</th>
                <th className="standard-table-th standard-table-th-left">사유</th>
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={5} className="standard-table-empty">
                    이력이 없습니다.
                  </td>
                </tr>
              ) : (
                paged.map((row: OdorAckHistoryRow) => {
                  const selected = selectedAlertId === row.alertId
                  return (
                    <tr
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      title={`${row.sensorLabel} 상세보기`}
                      onClick={() => onSelectHistory?.(row)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onSelectHistory?.(row)
                        }
                      }}
                      className={cn(
                        'standard-list-row cursor-pointer',
                        selected && 'standard-list-row-selected'
                      )}
                    >
                      <td className="standard-table-td-text" title={row.sensorLabel}>
                        <span className="block truncate font-medium">{row.sensorLabel}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {row.actor}
                          {row.grade != null
                            ? ` · ${ODOR_ALERT_GRADE_LABEL[row.grade as OdorAlertGrade]}`
                            : ''}
                        </span>
                      </td>
                      <td className="standard-table-td-compact">
                        {ODOR_ALERT_KIND_LABEL[row.kind]}
                      </td>
                      <td className="standard-table-td-compact">
                        <span
                          className={cn(
                            'standard-status-badge',
                            row.mode === 'bulk'
                              ? 'standard-status-badge-primary'
                              : 'standard-status-badge-muted'
                          )}
                        >
                          {row.mode === 'bulk' ? '일괄' : '단건'}
                        </span>
                      </td>
                      <td
                        className="standard-table-td-date tabular-nums"
                        title={formatOdorAlertTime(row.at)}
                      >
                        {formatOdorAlertTime(row.at)}
                      </td>
                      <td className="standard-table-td-text" title={row.reason}>
                        <span className="block truncate">{row.reason}</span>
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
            {filtered.length === 0
              ? '0건'
              : `${from}–${to} / ${filtered.length.toLocaleString()}건`}
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
            <span className="px-1.5 text-[11px] text-muted-foreground">{safePage}페이지</span>
            <button
              type="button"
              title="다음"
              disabled={!hasNext}
              className="standard-detail-action-btn cursor-pointer disabled:cursor-not-allowed"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              다음
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
