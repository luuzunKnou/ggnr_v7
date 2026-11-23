'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, History, Search, X } from 'lucide-react'
import type { OdorAlertItem } from '@/app/(pages)/(index)/odorPh/odorPhDashboardMock'
import { useSerWriteAccess } from '@/hooks/useSerWriteAccess'
import { cn } from '@/lib/utils'
import { OdorAlertAckDialog } from '../odorAlert/OdorAlertAckDialog'
import {
  ODOR_ALERT_GRADE_LABEL,
  ODOR_ALERT_KIND_LABEL,
  type OdorAlertGradeFilter,
  type OdorAlertKindFilter,
  type OdorAlertViewTab,
} from '../odorAlert/odorAlertConfig'
import { formatOdorAlertTime, type OdorAlertRow } from '../odorAlert/odorAlertMock'
import { acknowledgeOdorAlerts, useOdorAlertStore } from '../odorAlert/odorAlertStore'
import { ODOR_ALERT_VIEW2_SER_ENG } from './odorAlertView2Config'
import { odorAlertRowToViewItem } from './odorAlertView2Map'

type Props = {
  onClose: () => void
  historyOpen: boolean
  onToggleHistory: () => void
  selectedAlertId: string | null
  onSelectAlert: (alert: OdorAlertItem, source: OdorAlertRow) => void
}

type SortDir = 'asc' | 'desc'
type AlertSortKey =
  | 'occurredAt'
  | 'emdNm'
  | 'sensorNm'
  | 'ppm'
  | 'abatement'
  | 'confirmed'

const PAGE_SIZE = 10

/** 실제 운영 업체 (경보 목업·센서 DB와 동일) */
const AGENCY_OPTIONS = ['가람환경기술', '디오솔류션'] as const

/** 기존 경보목록2 헤더 순서 (유형·등급은 필터 칩으로) */
const ALERT_COLUMNS: Array<{ key: AlertSortKey; label: string; className: string }> = [
  { key: 'occurredAt', label: '발생시각', className: 'w-[20%]' },
  { key: 'emdNm', label: '읍면동', className: 'w-[14%]' },
  { key: 'sensorNm', label: '센서명', className: 'w-[16%]' },
  { key: 'ppm', label: 'ppm', className: 'w-[12%]' },
  { key: 'abatement', label: '저감 설비', className: 'w-[16%]' },
  { key: 'confirmed', label: '확인 여부', className: 'w-[14%]' },
]

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

function inDateRange(iso: string, from: string, to: string): boolean {
  const day = toYmdSeoul(iso)
  if (!day) return false
  if (from && day < from) return false
  if (to && day > to) return false
  return true
}

function pageMeta(total: number, page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize) || 1)
  const safePage = Math.min(Math.max(1, page), pageCount)
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1
  const to = Math.min(safePage * pageSize, total)
  const hasNext = safePage * pageSize < total
  return { pageCount, safePage, from, to, hasNext }
}

type ViewRow = ReturnType<typeof odorAlertRowToViewItem> & { source: OdorAlertRow }

/**
 * 경보목록2 — standard 표 UI 유지, 데이터·인지는 odorAlertStore (P21)
 */
export function OdorAlertView2ListPanel({
  onClose,
  historyOpen,
  onToggleHistory,
  selectedAlertId,
  onSelectAlert,
}: Props) {
  const { alerts } = useOdorAlertStore()
  const canWrite = useSerWriteAccess(ODOR_ALERT_VIEW2_SER_ENG)

  const [tab, setTab] = useState<OdorAlertViewTab>('all')
  const [gradeFilter, setGradeFilter] = useState<OdorAlertGradeFilter>('all')
  const [kindFilter, setKindFilter] = useState<OdorAlertKindFilter>('all')
  const [agencyFilter, setAgencyFilter] = useState<string>('all')
  const [keyword, setKeyword] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<{ key: AlertSortKey; dir: SortDir }>({
    key: 'occurredAt',
    dir: 'desc',
  })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [ackTarget, setAckTarget] = useState<{
    mode: 'single' | 'bulk'
    ids: string[]
  } | null>(null)

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    let list = alerts.filter((a) => {
      if (tab === 'unacked' && a.acked) return false
      if (tab === 'unrecovered' && a.recovered) return false
      if (kindFilter === 'odor' && a.kind !== 'odor') return false
      if (kindFilter === 'fault' && a.kind !== 'fault') return false
      if (gradeFilter === 'caution' && (a.kind !== 'odor' || a.grade !== 3)) return false
      if (
        gradeFilter === 'serious' &&
        (a.kind !== 'odor' || a.grade == null || a.grade < 4)
      )
        return false
      if (agencyFilter !== 'all' && a.agency !== agencyFilter) return false
      if ((dateFrom || dateTo) && !inDateRange(a.occurredAt, dateFrom, dateTo)) return false
      return true
    })

    const views: ViewRow[] = list.map((source) => ({
      ...odorAlertRowToViewItem(source),
      source,
    }))

    let rows = views
    if (kw) {
      rows = views.filter((r) =>
        [
          r.sensorKorNm,
          r.sensorNm,
          r.agency,
          r.emdNm,
          r.grade != null ? `${r.grade}등급` : '',
          ODOR_ALERT_KIND_LABEL[r.kind],
          formatOdorAlertTime(r.occurredAt),
          r.abatementRunning ? '저감가동' : '미가동',
          r.confirmed ? '확인' : '미확인',
          r.kind === 'fault' ? '통신 두절' : '',
        ]
          .join(' ')
          .toLowerCase()
          .includes(kw)
      )
    }

    const sign = sort.dir === 'asc' ? 1 : -1
    rows.sort((a, b) => {
      let cmp = 0
      switch (sort.key) {
        case 'occurredAt':
          cmp = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
          break
        case 'emdNm':
          cmp = a.emdNm.localeCompare(b.emdNm, 'ko')
          break
        case 'sensorNm':
          cmp = a.sensorNm.localeCompare(b.sensorNm, 'ko', { numeric: true })
          break
        case 'ppm':
          cmp = a.ppm - b.ppm
          break
        case 'abatement':
          cmp = Number(a.abatementRunning) - Number(b.abatementRunning)
          break
        case 'confirmed':
          cmp = Number(a.confirmed) - Number(b.confirmed)
          break
      }
      return sign * cmp
    })
    return rows
  }, [
    alerts,
    tab,
    gradeFilter,
    kindFilter,
    agencyFilter,
    keyword,
    dateFrom,
    dateTo,
    sort,
  ])

  const unackedVisible = filtered.filter((r) => !r.confirmed)
  const { pageCount, from, to, hasNext } = pageMeta(filtered.length, page, PAGE_SIZE)

  useEffect(() => {
    setPage(1)
  }, [tab, gradeFilter, kindFilter, agencyFilter, keyword, dateFrom, dateTo, sort])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, page])

  const toggleSort = (key: AlertSortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    )
  }

  const toggleSelect = (id: string, acked: boolean) => {
    if (acked || !canWrite) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title">경보목록2</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title={historyOpen ? '해제 이력 접기' : '해제(인지) 이력'}
            onClick={onToggleHistory}
            className={cn(
              'standard-detail-hdr-btn cursor-pointer',
              historyOpen && 'border-primary bg-primary/10 text-foreground'
            )}
          >
            <History className="h-3.5 w-3.5" aria-hidden />
            해제 이력
          </button>
          <button
            type="button"
            onClick={onClose}
            className="standard-panel-close cursor-pointer"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="standard-filter-section space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-[11px] font-medium text-muted-foreground">보기</span>
            <div className="standard-filter-chips">
              {(
                [
                  ['all', '전체'],
                  ['unacked', '미인지'],
                  ['unrecovered', '미복귀'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  title={label}
                  onClick={() => setTab(key)}
                  className={cn(
                    'standard-filter-chip cursor-pointer',
                    tab === key && 'standard-filter-chip-active'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-[11px] font-medium text-muted-foreground">등급</span>
            <div className="standard-filter-chips">
              {(
                [
                  ['all', '전체'],
                  ['caution', '주의(3)'],
                  ['serious', '심각(4·5)'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  title={label}
                  onClick={() => setGradeFilter(key)}
                  className={cn(
                    'standard-filter-chip cursor-pointer',
                    gradeFilter === key && 'standard-filter-chip-active'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-[11px] font-medium text-muted-foreground">유형</span>
            <div className="standard-filter-chips">
              {(
                [
                  ['all', '전체'],
                  ['odor', '악취'],
                  ['fault', '장애'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  title={label}
                  onClick={() => setKindFilter(key)}
                  className={cn(
                    'standard-filter-chip cursor-pointer',
                    kindFilter === key && 'standard-filter-chip-active'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-[11px] font-medium text-muted-foreground">업체</span>
            <div className="standard-filter-chips">
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
              {AGENCY_OPTIONS.map((agency) => (
                <button
                  key={agency}
                  type="button"
                  title={agency}
                  onClick={() => setAgencyFilter(agency)}
                  className={cn(
                    'standard-filter-chip cursor-pointer',
                    agencyFilter === agency && 'standard-filter-chip-active'
                  )}
                >
                  {agency}
                </button>
              ))}
            </div>
          </div>
          <div className="flex min-w-[12rem] items-center gap-1.5">
            <span className="shrink-0 text-[11px] font-medium text-muted-foreground">기간</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              title="시작일"
              className="standard-detail-input h-7 min-w-0 flex-1"
            />
            <span className="shrink-0 text-[11px] text-muted-foreground">~</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              title="종료일"
              className="standard-detail-input h-7 min-w-0 flex-1"
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

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            title="표시 중 미인지 전체 선택"
            className="standard-detail-hdr-btn cursor-pointer disabled:opacity-50"
            disabled={unackedVisible.length === 0 || !canWrite}
            onClick={() => setSelected(new Set(unackedVisible.map((r) => r.id)))}
          >
            미인지 전체선택
          </button>
          <button
            type="button"
            title="선택 해제"
            className="standard-detail-hdr-btn cursor-pointer disabled:opacity-50"
            disabled={selected.size === 0}
            onClick={() => setSelected(new Set())}
          >
            선택해제
          </button>
          {canWrite ? (
            <button
              type="button"
              title="일괄 해제(인지)"
              className="standard-detail-hdr-btn-save cursor-pointer disabled:opacity-50"
              disabled={[...selected].every((id) => !unackedVisible.some((r) => r.id === id))}
              onClick={() => {
                const ids = [...selected].filter((id) =>
                  unackedVisible.some((r) => r.id === id)
                )
                if (ids.length) setAckTarget({ mode: 'bulk', ids })
              }}
            >
              일괄 해제(인지)
            </button>
          ) : (
            <span className="text-[10px] text-muted-foreground">조회 전용 — 해제 불가</span>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">
            선택 {selected.size}
          </span>
        </div>
      </div>

      <div className="standard-list-body">
        <div className="standard-list-scroll">
          <table className="standard-list-table">
            <colgroup>
              <col style={{ width: '2.25rem' }} />
              {ALERT_COLUMNS.map((col) => (
                <col key={col.key} />
              ))}
              <col style={{ width: '3.25rem' }} />
            </colgroup>
            <thead className="standard-table-thead">
              <tr>
                <th className="standard-table-th !w-9 px-0.5 text-center">
                  <span className="sr-only">선택</span>
                </th>
                {ALERT_COLUMNS.map((col) => {
                  const active = sort.key === col.key
                  const Icon = !active
                    ? ArrowUpDown
                    : sort.dir === 'asc'
                      ? ArrowUp
                      : ArrowDown
                  return (
                    <th
                      key={col.key}
                      className={cn('standard-table-th standard-table-th-left', col.className)}
                    >
                      <button
                        type="button"
                        title={`${col.label} 정렬`}
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          'standard-sort-button standard-sort-button-left cursor-pointer',
                          active && 'standard-sort-button-active'
                        )}
                      >
                        <span className="truncate">{col.label}</span>
                        <Icon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                      </button>
                    </th>
                  )
                })}
                <th className="standard-table-th !w-13 px-0.5">
                  <span className="sr-only">해제</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={ALERT_COLUMNS.length + 2} className="standard-table-empty">
                    조건에 맞는 경보가 없습니다.
                  </td>
                </tr>
              ) : (
                paged.map((row) => (
                  <tr
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    title={`${row.sensorKorNm} 상세보기`}
                    onClick={() => onSelectAlert(row, row.source)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelectAlert(row, row.source)
                      }
                    }}
                    className={cn(
                      'standard-list-row',
                      selectedAlertId === row.id && 'standard-list-row-selected'
                    )}
                  >
                    <td
                      className="standard-table-td-compact !w-9 px-0.5 text-center align-middle"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 cursor-pointer accent-primary"
                        title="선택"
                        disabled={row.confirmed || !canWrite}
                        checked={selected.has(row.id)}
                        onChange={() => toggleSelect(row.id, row.confirmed)}
                      />
                    </td>
                    <td
                      className="standard-table-td-date"
                      title={formatOdorAlertTime(row.occurredAt)}
                    >
                      {formatOdorAlertTime(row.occurredAt)}
                    </td>
                    <td className="standard-table-td-text-muted" title={row.emdNm}>
                      {row.emdNm}
                    </td>
                    <td className="standard-table-td-text" title={row.sensorKorNm}>
                      {row.sensorKorNm}
                    </td>
                    <td className="standard-table-td-date font-semibold text-amber-700 dark:text-amber-300">
                      {row.kind === 'fault' ? '—' : row.ppm.toFixed(1)}
                    </td>
                    <td
                      className={cn(
                        'standard-table-td-text-muted',
                        row.abatementRunning && 'text-primary'
                      )}
                      title={
                        row.kind === 'fault'
                          ? '해당 없음'
                          : row.abatementRunning
                            ? '제거설비 자동 가동'
                            : '미가동'
                      }
                    >
                      {row.kind === 'fault'
                        ? '—'
                        : row.abatementRunning
                          ? '자동 가동'
                          : '미가동'}
                    </td>
                    <td className="standard-table-td-compact">
                      <span
                        className={cn(
                          'standard-status-badge',
                          row.confirmed
                            ? 'standard-status-badge-muted'
                            : 'standard-status-badge-primary'
                        )}
                        title={
                          row.kind === 'fault'
                            ? row.lastRecvAt
                              ? `장애 · 최종수신 ${formatOdorAlertTime(row.lastRecvAt)}`
                              : '장애(통신두절)'
                            : `${ODOR_ALERT_KIND_LABEL[row.kind]} · ${ODOR_ALERT_GRADE_LABEL[row.grade as 3 | 4 | 5] ?? `${row.grade}등급`}`
                        }
                      >
                        {row.confirmed ? '인지' : '미인지'}
                      </span>
                    </td>
                    <td
                      className="standard-table-td-compact !w-13 px-0.5 text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {canWrite && !row.confirmed ? (
                        <button
                          type="button"
                          title="단건 해제(인지)"
                          className="standard-status-badge standard-status-badge-primary cursor-pointer border-0 leading-none"
                          onClick={() => setAckTarget({ mode: 'single', ids: [row.id] })}
                        >
                          해제
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="standard-list-footer flex items-center justify-between gap-2">
          <span className="tabular-nums">
            {filtered.length === 0
              ? '0건'
              : `${from}–${to} / ${filtered.length.toLocaleString()}건`}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="이전"
              disabled={page <= 1}
              className="standard-detail-action-btn cursor-pointer disabled:cursor-not-allowed"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              이전
            </button>
            <span className="px-1.5 text-[11px] text-muted-foreground">{page}페이지</span>
            <button
              type="button"
              title="다음"
              disabled={!hasNext}
              className="standard-detail-action-btn cursor-pointer disabled:cursor-not-allowed"
              onClick={() => setPage((p) => p + 1)}
            >
              다음
            </button>
          </div>
        </div>
      </div>

      <OdorAlertAckDialog
        open={ackTarget != null}
        title={ackTarget?.mode === 'bulk' ? '일괄 해제(인지)' : '단건 해제(인지)'}
        description={
          ackTarget?.mode === 'bulk'
            ? `선택한 미인지 경보 ${ackTarget.ids.length}건을 사유와 함께 해제합니다.`
            : '이 경보를 사유와 함께 해제(인지)합니다.'
        }
        onClose={() => setAckTarget(null)}
        onConfirm={(reason) => {
          if (!ackTarget) return
          acknowledgeOdorAlerts({
            alertIds: ackTarget.ids,
            reason,
            mode: ackTarget.mode,
          })
          setSelected((prev) => {
            const next = new Set(prev)
            for (const id of ackTarget.ids) next.delete(id)
            return next
          })
          setAckTarget(null)
        }}
      />
    </div>
  )
}
