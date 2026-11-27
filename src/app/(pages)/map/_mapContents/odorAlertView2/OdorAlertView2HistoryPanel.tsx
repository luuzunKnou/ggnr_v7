'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ODOR_ALERT_GRADE_LABEL,
  ODOR_ALERT_KIND_LABEL,
  type OdorAckMode,
  type OdorAlertGrade,
} from '../odorAlert/odorAlertConfig'
import { formatOdorAlertTime, type OdorAckHistoryRow } from '../odorAlert/odorAlertMock'
import { useOdorAlertStore } from '../odorAlert/odorAlertStore'
import {
  odorMapFloatBodyOpacityStyle,
  odorMapFloatHeaderOpacityStyle,
} from '../odorMapFloatOpacity'

type Props = {
  onClose: () => void
  /** 플로팅 사이드 패널 — 맵 서피스 헤더 스타일 */
  variant?: 'panel' | 'float'
  className?: string
  /** 이력에서 직접 고른 행 id — 경보목록 클릭으로는 설정하지 않음 */
  selectedHistoryId?: string | null
  onSelectHistory?: (row: OdorAckHistoryRow) => void
}

type ModeFilter = 'all' | OdorAckMode

const PAGE_SIZE = 10

function modeLabel(mode: OdorAckMode): string {
  return mode === 'bulk' ? '일괄' : '단건'
}

/** 표에 보이는 컬럼값만 통합검색 대상 */
function historyColumnSearchText(row: OdorAckHistoryRow): string {
  return [
    row.sensorLabel,
    ODOR_ALERT_KIND_LABEL[row.kind],
    modeLabel(row.mode),
    formatOdorAlertTime(row.at),
    row.reason,
  ]
    .join(' ')
    .toLowerCase()
}

function toYmdSeoul(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

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
  selectedHistoryId = null,
  onSelectHistory,
}: Props) {
  const { history } = useOdorAlertStore()
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all')
  const [ackedDay, setAckedDay] = useState('')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return history.filter((r) => {
      if (modeFilter !== 'all' && r.mode !== modeFilter) return false
      if (ackedDay && toYmdSeoul(r.at) !== ackedDay) return false
      if (kw && !historyColumnSearchText(r).includes(kw)) return false
      return true
    })
  }, [history, modeFilter, ackedDay, keyword])

  const { pageCount, safePage, from, to, hasNext } = pageMeta(filtered.length, page)

  useEffect(() => {
    setPage(1)
  }, [modeFilter, ackedDay, keyword])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const paged = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, safePage])

  const isFloat = variant === 'float'

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-1 flex-col overflow-hidden',
        className
      )}
    >
      {isFloat ? (
        <div
          className="standard-map-float-header shrink-0 border-b border-slate-200 dark:border-white/10"
          style={odorMapFloatHeaderOpacityStyle()}
        >
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
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        style={isFloat ? odorMapFloatBodyOpacityStyle() : undefined}
      >
      <div
        className={cn(
          'standard-filter-section shrink-0 space-y-2 border-b border-border px-2 py-1.5',
          isFloat && 'border-slate-100 dark:border-white/10'
        )}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-[11px] font-medium text-muted-foreground">구분</span>
            <div className="standard-filter-chips">
              {(
                [
                  ['all', '전체'],
                  ['single', '단건'],
                  ['bulk', '일괄'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  title={label}
                  onClick={() => setModeFilter(key)}
                  className={cn(
                    'standard-filter-chip cursor-pointer',
                    modeFilter === key && 'standard-filter-chip-active'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <label
              htmlFor="odor-alert-history-acked-day"
              className="shrink-0 text-[11px] font-medium text-muted-foreground"
            >
              해제시각
            </label>
            <input
              id="odor-alert-history-acked-day"
              type="date"
              value={ackedDay}
              onChange={(e) => setAckedDay(e.target.value)}
              title="해제시각"
              className="standard-detail-input h-7 min-w-0"
            />
          </div>
        </div>

        <div className="standard-search-wrap">
          <Search className="standard-search-icon" aria-hidden />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="통합검색"
            title="통합검색"
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
                  const selected = selectedHistoryId === row.id
                  const gradeLabel =
                    row.grade != null
                      ? ODOR_ALERT_GRADE_LABEL[row.grade as OdorAlertGrade]
                      : ''
                  const sensorTitle = [row.sensorLabel, row.actor, gradeLabel]
                    .filter(Boolean)
                    .join(' · ')
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
                      <td className="standard-table-td-text" title={sensorTitle}>
                        {row.sensorLabel}
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
                          {modeLabel(row.mode)}
                        </span>
                      </td>
                      <td
                        className="standard-table-td-date"
                        title={formatOdorAlertTime(row.at)}
                      >
                        {formatOdorAlertTime(row.at)}
                      </td>
                      <td className="standard-table-td-text" title={row.reason}>
                        {row.reason}
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
    </div>
  )
}
