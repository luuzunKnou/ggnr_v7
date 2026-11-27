'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSession } from 'next-auth/react'
import { ArrowDown, ArrowUp, ArrowUpDown, History, Search, X } from 'lucide-react'
import {
  MOCK_CAUTION_ALERTS,
  MOCK_RECENT_ALERTS,
  formatAlertTime,
  type OdorAlertItem,
  type OdorGrade,
} from '@/app/(pages)/(index)/odorPhV2/odorPhDashboardMock'
import { OdorAlertDetailPanel } from '@/app/(pages)/(index)/odorPhV2/OdorAlertDetailPanel'
import type { OdorAlertModalFocus } from '@/app/(pages)/(index)/odorPhV2/OdorIndexAlertModal'
import { getOdorIndexMenuDescription } from '@/app/(pages)/(index)/odorPhV2/odorIndexMenus'
import {
  ODOR_ALERT_GRADE_LABEL,
  type OdorAlertGrade,
} from '@/app/(pages)/map/_mapContents/odorAlertV2/odorAlertConfig'
import {
  formatOdorAlertTime,
  type OdorAckHistoryRow,
} from '@/app/(pages)/map/_mapContents/odorAlertV2/odorAlertMock'
import { useOdorAlertStore } from '@/app/(pages)/map/_mapContents/odorAlertV2/odorAlertStore'
import { cn } from '@/lib/utils'

type ConfirmFilter = 'all' | 'confirmed' | 'unconfirmed'
type AgencyFilter = 'all' | '가람환경기술' | '디오솔류션'
type RightPanel = 'closed' | 'history' | 'detail'
type SortDir = 'asc' | 'desc'
type AlertSortKey =
  | 'sensorKorNm'
  | 'sensorNm'
  | 'agency'
  | 'grade'
  | 'occurredAt'
  | 'ppm'
  | 'abatement'
  | 'confirmed'
  | 'emdNm'
type HistorySortKey = 'sensorLabel' | 'mode' | 'grade' | 'at' | 'reason'

const PAGE_SIZE = 10

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

const ALERT_COLUMNS: Array<{ key: AlertSortKey; label: string; className: string }> = [
  { key: 'sensorKorNm', label: '센서', className: 'w-[16%]' },
  { key: 'sensorNm', label: '센서명', className: 'w-[8%]' },
  { key: 'agency', label: '업체', className: 'w-[14%]' },
  { key: 'emdNm', label: '읍면동', className: 'w-[10%]' },
  { key: 'grade', label: '등급', className: 'w-[7%]' },
  { key: 'occurredAt', label: '발생시각', className: 'w-[14%]' },
  { key: 'ppm', label: 'ppm', className: 'w-[8%]' },
  { key: 'abatement', label: '저감', className: 'w-[10%]' },
  { key: 'confirmed', label: '확인', className: 'w-[9%]' },
]

const HISTORY_COLUMNS: Array<{ key: HistorySortKey; label: string; className: string }> = [
  { key: 'sensorLabel', label: '센서', className: 'w-[22%]' },
  { key: 'mode', label: '구분', className: 'w-[14%]' },
  { key: 'grade', label: '등급', className: 'w-[14%]' },
  { key: 'at', label: '처리시각', className: 'w-[22%]' },
  { key: 'reason', label: '사유', className: 'w-[28%]' },
]

const SEARCH_INPUT_CLASS =
  'standard-search-input focus:border-primary focus:ring-0 focus:ring-offset-0'

const DATE_INPUT_CLASS =
  'h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[11px] text-foreground outline-none focus:border-primary scheme-light dark:scheme-dark'

/** Asia/Seoul 기준 YYYY-MM-DD */
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

function buildAlertPool(): OdorAlertItem[] {
  const map = new Map<string, OdorAlertItem>()
  for (const row of [...MOCK_RECENT_ALERTS, ...MOCK_CAUTION_ALERTS]) {
    map.set(row.id, row)
  }
  return [...map.values()]
}

/** 모달 경보 → 목록 행 매칭 (센서명·업체·읍면동), 없으면 합성 */
export function resolveAlertFromModalFocus(focus: OdorAlertModalFocus): OdorAlertItem {
  const pool = buildAlertPool()
  const label = focus.sensorLabel.trim()
  const hit =
    pool.find(
      (a) =>
        a.sensorKorNm === label &&
        a.agency === focus.agency &&
        a.emdNm === focus.emdNm
    ) ??
    pool.find((a) => a.sensorKorNm === label && a.agency === focus.agency) ??
    pool.find((a) => a.sensorKorNm === label) ??
    pool.find((a) => label.includes(a.sensorKorNm) || a.sensorKorNm.includes(label))

  if (hit) {
    return {
      ...hit,
      confirmed: focus.acked,
      abatementRunning: focus.scrubberAutoOn ?? hit.abatementRunning,
      occurredAt: focus.occurredAt || hit.occurredAt,
      grade: (focus.grade ?? hit.grade) as OdorGrade,
    }
  }

  const grade = (focus.grade ?? 3) as OdorGrade
  return {
    id: `modal-${focus.storeAlertId}`,
    sensorKorNm: focus.sensorLabel,
    sensorNm: '—',
    agency: focus.agency,
    grade,
    occurredAt: focus.occurredAt,
    confirmed: focus.acked,
    ppm: grade <= 2 ? 1.5 : grade === 3 ? 3.5 : grade === 4 ? 6.5 : 9.5,
    abatementRunning: focus.scrubberAutoOn ?? false,
    emdNm: focus.emdNm,
  }
}

export type AlertDetailOpenSignal = {
  focus: OdorAlertModalFocus
  nonce: number
}

function resolveDisplayName(
  status: string,
  user: { id?: string | null; name?: string | null } | undefined
): string {
  if (status === 'loading') return ''
  if (user?.id === 'su') return '슈퍼관리자'
  return String(user?.name ?? user?.id ?? '').trim() || '게스트'
}

function alertSearchBlob(row: OdorAlertItem): string {
  return [
    row.sensorKorNm,
    row.sensorNm,
    row.agency,
    row.emdNm,
    `${row.grade}등급`,
    formatAlertTime(row.occurredAt),
    row.ppm.toFixed(1),
    row.abatementRunning ? '가동중' : '가동 필요',
    row.confirmed ? '확인' : '미확인',
  ]
    .join(' ')
    .toLowerCase()
}

function historySearchBlob(row: OdorAckHistoryRow): string {
  return [
    row.sensorLabel,
    row.mode === 'bulk' ? '일괄' : '단건',
    row.grade != null ? ODOR_ALERT_GRADE_LABEL[row.grade as OdorAlertGrade] : '',
    formatOdorAlertTime(row.at),
    row.reason,
    row.actor,
  ]
    .join(' ')
    .toLowerCase()
}

function compareAlert(a: OdorAlertItem, b: OdorAlertItem, key: AlertSortKey): number {
  switch (key) {
    case 'sensorKorNm':
      return a.sensorKorNm.localeCompare(b.sensorKorNm, 'ko')
    case 'sensorNm':
      return a.sensorNm.localeCompare(b.sensorNm, 'ko', { numeric: true })
    case 'agency':
      return a.agency.localeCompare(b.agency, 'ko')
    case 'emdNm':
      return a.emdNm.localeCompare(b.emdNm, 'ko')
    case 'grade':
      return a.grade - b.grade
    case 'occurredAt':
      return new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
    case 'ppm':
      return a.ppm - b.ppm
    case 'abatement':
      return Number(a.abatementRunning) - Number(b.abatementRunning)
    case 'confirmed':
      return Number(a.confirmed) - Number(b.confirmed)
  }
}

function compareHistory(a: OdorAckHistoryRow, b: OdorAckHistoryRow, key: HistorySortKey): number {
  switch (key) {
    case 'sensorLabel':
      return a.sensorLabel.localeCompare(b.sensorLabel, 'ko')
    case 'mode':
      return a.mode.localeCompare(b.mode)
    case 'grade':
      return (a.grade ?? 0) - (b.grade ?? 0)
    case 'at':
      return new Date(a.at).getTime() - new Date(b.at).getTime()
    case 'reason':
      return a.reason.localeCompare(b.reason, 'ko')
  }
}

function pageMeta(total: number, page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize) || 1)
  const safePage = Math.min(Math.max(1, page), pageCount)
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1
  const to = Math.min(safePage * pageSize, total)
  const hasNext = safePage * pageSize < total
  return { pageCount, safePage, from, to, hasNext }
}

function NetworkStylePager({
  total,
  page,
  onPageChange,
}: {
  total: number
  page: number
  onPageChange: (page: number) => void
}) {
  const { from, to, hasNext } = pageMeta(total, page, PAGE_SIZE)
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-muted/30 px-2 py-1.5">
      <span className="text-[11px] text-muted-foreground">
        {total === 0 ? '0건' : `${from}–${to} / ${total.toLocaleString()}건`}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          title="이전"
          disabled={page <= 1}
          className="cursor-pointer rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          이전
        </button>
        <span className="px-1.5 text-[11px] text-muted-foreground">{page}페이지</span>
        <button
          type="button"
          title="다음"
          disabled={!hasNext}
          className="cursor-pointer rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => onPageChange(page + 1)}
        >
          다음
        </button>
      </div>
    </div>
  )
}

type PanelHeaderProps = {
  title: string
  description: string
  action?: ReactNode
}

function PanelHeader({ title, description, action }: PanelHeaderProps) {
  return (
    <div className="flex shrink-0 items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold leading-none text-foreground">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

type SearchFieldProps = {
  value: string
  onChange: (value: string) => void
}

function UnifiedSearchField({ value, onChange }: SearchFieldProps) {
  return (
    <div className="flex min-w-[12rem] flex-1 items-center gap-2">
      <span className="shrink-0 text-[11px] font-medium text-muted-foreground">통합검색</span>
      <div className="standard-search-wrap min-w-0 flex-1">
        <Search className="standard-search-icon" aria-hidden />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="통합검색"
          title="통합검색"
          className={SEARCH_INPUT_CLASS}
        />
      </div>
    </div>
  )
}

type DateRangeFieldProps = {
  from: string
  to: string
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
}

function DateRangeField({ from, to, onFromChange, onToChange }: DateRangeFieldProps) {
  return (
    <div className="flex min-w-[14rem] items-center gap-1.5">
      <span className="shrink-0 text-[11px] font-medium text-muted-foreground">기간</span>
      <input
        type="date"
        value={from}
        onChange={(e) => onFromChange(e.target.value)}
        title="시작일"
        className={DATE_INPUT_CLASS}
      />
      <span className="shrink-0 text-[11px] text-muted-foreground">~</span>
      <input
        type="date"
        value={to}
        onChange={(e) => onToChange(e.target.value)}
        title="종료일"
        className={DATE_INPUT_CLASS}
      />
    </div>
  )
}

type AlertContentProps = {
  /** 모달 «경보 목록 이동» 시 상세까지 열기 */
  openDetailSignal?: AlertDetailOpenSignal | null
}

/** Index 콘솔 — 경보목록 / 우측(이력·상세) 형제 div (3:2) */
export function OdorIndexAlertContent({ openDetailSignal = null }: AlertContentProps) {
  const { data: session, status } = useSession()
  const { history } = useOdorAlertStore()
  const displayName = resolveDisplayName(status, session?.user)

  const [rightPanel, setRightPanel] = useState<RightPanel>('closed')
  const [selectedAlert, setSelectedAlert] = useState<OdorAlertItem | null>(null)
  const [confirmFilter, setConfirmFilter] = useState<ConfirmFilter>('all')
  const [agencyFilter, setAgencyFilter] = useState<AgencyFilter>('all')
  const [keyword, setKeyword] = useState('')
  const [historyKeyword, setHistoryKeyword] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [historyDateFrom, setHistoryDateFrom] = useState('')
  const [historyDateTo, setHistoryDateTo] = useState('')
  const [listPage, setListPage] = useState(1)
  const [historyPage, setHistoryPage] = useState(1)
  const [alertSort, setAlertSort] = useState<{ key: AlertSortKey; dir: SortDir }>({
    key: 'occurredAt',
    dir: 'desc',
  })
  const [historySort, setHistorySort] = useState<{ key: HistorySortKey; dir: SortDir }>({
    key: 'at',
    dir: 'desc',
  })

  const rightOpen = rightPanel !== 'closed'
  const historyOpen = rightPanel === 'history'
  const detailOpen = rightPanel === 'detail' && selectedAlert != null

  const openHistory = () => {
    setSelectedAlert(null)
    setRightPanel('history')
  }

  const openDetail = (row: OdorAlertItem) => {
    if (rightPanel === 'detail' && selectedAlert?.id === row.id) {
      setSelectedAlert(null)
      setRightPanel('closed')
      return
    }
    setSelectedAlert(row)
    setRightPanel('detail')
  }

  const closeRight = () => {
    setSelectedAlert(null)
    setRightPanel('closed')
  }

  useEffect(() => {
    if (!openDetailSignal) return
    openDetail(resolveAlertFromModalFocus(openDetailSignal.focus))
  }, [openDetailSignal])

  const filteredAlerts = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    let list = buildAlertPool()
    if (confirmFilter === 'confirmed') list = list.filter((r) => r.confirmed)
    if (confirmFilter === 'unconfirmed') list = list.filter((r) => !r.confirmed)
    if (agencyFilter !== 'all') list = list.filter((r) => r.agency === agencyFilter)
    if (dateFrom || dateTo) {
      list = list.filter((r) => inDateRange(r.occurredAt, dateFrom, dateTo))
    }
    if (kw) list = list.filter((r) => alertSearchBlob(r).includes(kw))
    const sign = alertSort.dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => sign * compareAlert(a, b, alertSort.key))
  }, [confirmFilter, agencyFilter, keyword, dateFrom, dateTo, alertSort])

  const myHistory = useMemo(() => {
    if (!displayName) return []
    const kw = historyKeyword.trim().toLowerCase()
    let list = history.filter((h) => h.actor === displayName)
    if (historyDateFrom || historyDateTo) {
      list = list.filter((r) => inDateRange(r.at, historyDateFrom, historyDateTo))
    }
    if (kw) list = list.filter((r) => historySearchBlob(r).includes(kw))
    const sign = historySort.dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => sign * compareHistory(a, b, historySort.key))
  }, [history, displayName, historyKeyword, historyDateFrom, historyDateTo, historySort])

  const listPageCount = pageMeta(filteredAlerts.length, listPage, PAGE_SIZE).pageCount
  const historyPageCount = pageMeta(myHistory.length, historyPage, PAGE_SIZE).pageCount

  useEffect(() => {
    setListPage(1)
  }, [confirmFilter, agencyFilter, keyword, dateFrom, dateTo, alertSort])

  useEffect(() => {
    setHistoryPage(1)
  }, [historyKeyword, historyDateFrom, historyDateTo, historySort, historyOpen])

  useEffect(() => {
    if (rightPanel === 'detail' && !selectedAlert) setRightPanel('closed')
  }, [rightPanel, selectedAlert])

  useEffect(() => {
    if (listPage > listPageCount) setListPage(listPageCount)
  }, [listPage, listPageCount])

  useEffect(() => {
    if (historyPage > historyPageCount) setHistoryPage(historyPageCount)
  }, [historyPage, historyPageCount])

  const pagedAlerts = useMemo(() => {
    const start = (listPage - 1) * PAGE_SIZE
    return filteredAlerts.slice(start, start + PAGE_SIZE)
  }, [filteredAlerts, listPage])

  const pagedHistory = useMemo(() => {
    const start = (historyPage - 1) * PAGE_SIZE
    return myHistory.slice(start, start + PAGE_SIZE)
  }, [myHistory, historyPage])

  const toggleAlertSort = (key: AlertSortKey) => {
    setAlertSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    )
  }

  const toggleHistorySort = (key: HistorySortKey) => {
    setHistorySort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {/* 경보 목록 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
        <PanelHeader
          title="경보 목록"
          description={getOdorIndexMenuDescription('alertList')}
          action={
            <button
              type="button"
              title={historyOpen ? '사용자 이력 접기' : '사용자 이력'}
              onClick={() => (historyOpen ? closeRight() : openHistory())}
              className={cn(
                'inline-flex h-7 cursor-pointer items-center gap-1 rounded border px-2 text-[11px] font-medium',
                historyOpen
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              )}
            >
              <History className="h-3.5 w-3.5" aria-hidden />
              사용자 이력
            </button>
          }
        />

        <div className="flex shrink-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-[11px] font-medium text-muted-foreground">확인</span>
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
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-[11px] font-medium text-muted-foreground">업체</span>
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
            <DateRangeField
              from={dateFrom}
              to={dateTo}
              onFromChange={setDateFrom}
              onToChange={setDateTo}
            />
          </div>
          <UnifiedSearchField value={keyword} onChange={setKeyword} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border">
          <div className="standard-list-scroll">
            <table className="standard-list-table">
              <thead className="standard-table-thead">
                <tr>
                  {ALERT_COLUMNS.map((col) => {
                    const active = alertSort.key === col.key
                    const Icon = !active
                      ? ArrowUpDown
                      : alertSort.dir === 'asc'
                        ? ArrowUp
                        : ArrowDown
                    return (
                      <th
                        key={col.key}
                        className={cn(
                          'standard-table-th standard-table-th-left border-r border-border last:border-r-0',
                          col.className
                        )}
                      >
                        <button
                          type="button"
                          title={`${col.label} 정렬`}
                          onClick={() => toggleAlertSort(col.key)}
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
                </tr>
              </thead>
              <tbody>
                {pagedAlerts.length === 0 ? (
                  <tr>
                    <td colSpan={ALERT_COLUMNS.length} className="standard-table-empty">
                      조건에 맞는 경보가 없습니다.
                    </td>
                  </tr>
                ) : (
                  pagedAlerts.map((row) => (
                    <tr
                      key={row.id}
                      title={`${row.sensorKorNm} 상세보기`}
                      onClick={() => openDetail(row)}
                      className={cn(
                        'standard-list-row cursor-pointer',
                        selectedAlert?.id === row.id && 'bg-primary/10'
                      )}
                    >
                      <td
                        className="standard-table-td-compact border-r border-border/60"
                        title={row.sensorKorNm}
                      >
                        {row.sensorKorNm}
                      </td>
                      <td
                        className="standard-table-td-compact border-r border-border/60"
                        title={row.sensorNm}
                      >
                        {row.sensorNm}
                      </td>
                      <td
                        className="standard-table-td-compact border-r border-border/60"
                        title={row.agency}
                      >
                        {row.agency}
                      </td>
                      <td
                        className="standard-table-td-compact border-r border-border/60"
                        title={row.emdNm}
                      >
                        {row.emdNm}
                      </td>
                      <td className="standard-table-td-compact border-r border-border/60 tabular-nums">
                        {row.grade}등급
                      </td>
                      <td
                        className="standard-table-td-compact border-r border-border/60 tabular-nums"
                        title={formatAlertTime(row.occurredAt)}
                      >
                        {formatAlertTime(row.occurredAt)}
                      </td>
                      <td className="standard-table-td-compact border-r border-border/60 tabular-nums">
                        <span className="font-semibold text-amber-700 dark:text-amber-300">
                          {row.ppm.toFixed(1)}
                        </span>
                      </td>
                      <td className="standard-table-td-compact border-r border-border/60">
                        <span
                          className={cn(
                            row.abatementRunning
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                          )}
                        >
                          {row.abatementRunning ? '가동중' : '가동 필요'}
                        </span>
                      </td>
                      <td className="standard-table-td-compact">
                        <span
                          className={cn(
                            'standard-status-badge',
                            row.confirmed
                              ? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                              : 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                          )}
                        >
                          {row.confirmed ? '확인' : '미확인'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <NetworkStylePager
            total={filteredAlerts.length}
            page={listPage}
            onPageChange={setListPage}
          />
        </div>
      </div>

      {/* 우측 — 이력/상세 배타 · transition-[width] duration-300 · 3:2(40%) */}
      <div
        className={cn(
          'flex min-h-0 shrink-0 flex-col overflow-hidden transition-[width] duration-300 ease-in-out',
          rightOpen ? 'w-2/5 pl-4' : 'w-0 pl-0'
        )}
        aria-hidden={!rightOpen}
        inert={!rightOpen ? true : undefined}
      >
        <div
          className={cn(
            'flex h-full min-h-0 w-[max(18rem,100%)] flex-col gap-2 overflow-hidden transition-opacity duration-300 ease-in-out',
            rightOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
        >
          {detailOpen && selectedAlert ? (
            <>
              <PanelHeader
                title={selectedAlert.sensorKorNm}
                description={selectedAlert.agency}
                action={
                  <button
                    type="button"
                    title="닫기"
                    onClick={closeRight}
                    className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                }
              />
              <OdorAlertDetailPanel alert={selectedAlert} />
            </>
          ) : (
            <>
              <PanelHeader
                title="사용자 이력"
                description="사용자가 조회한 경보 목록 이력입니다."
                action={
                  <button
                    type="button"
                    title="닫기"
                    onClick={closeRight}
                    className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                }
              />

              <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
                <DateRangeField
                  from={historyDateFrom}
                  to={historyDateTo}
                  onFromChange={setHistoryDateFrom}
                  onToChange={setHistoryDateTo}
                />
                <UnifiedSearchField value={historyKeyword} onChange={setHistoryKeyword} />
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border">
                <div className="standard-list-scroll">
                  <table className="standard-list-table">
                    <thead className="standard-table-thead">
                      <tr>
                        {HISTORY_COLUMNS.map((col) => {
                          const active = historySort.key === col.key
                          const Icon = !active
                            ? ArrowUpDown
                            : historySort.dir === 'asc'
                              ? ArrowUp
                              : ArrowDown
                          return (
                            <th
                              key={col.key}
                              className={cn(
                                'standard-table-th standard-table-th-left border-r border-border last:border-r-0',
                                col.className
                              )}
                            >
                              <button
                                type="button"
                                title={`${col.label} 정렬`}
                                onClick={() => toggleHistorySort(col.key)}
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
                      </tr>
                    </thead>
                    <tbody>
                      {pagedHistory.length === 0 ? (
                        <tr>
                          <td colSpan={HISTORY_COLUMNS.length} className="standard-table-empty">
                            {displayName
                              ? '본인 확인(해제) 이력이 없습니다.'
                              : '로그인 정보를 확인하는 중…'}
                          </td>
                        </tr>
                      ) : (
                        pagedHistory.map((row) => (
                          <tr key={row.id} className="standard-list-row">
                            <td
                              className="standard-table-td-compact border-r border-border/60"
                              title={row.sensorLabel}
                            >
                              {row.sensorLabel}
                            </td>
                            <td className="standard-table-td-compact border-r border-border/60">
                              {row.mode === 'bulk' ? '일괄' : '단건'}
                            </td>
                            <td className="standard-table-td-compact border-r border-border/60">
                              {row.grade != null
                                ? ODOR_ALERT_GRADE_LABEL[row.grade as OdorAlertGrade]
                                : '—'}
                            </td>
                            <td
                              className="standard-table-td-compact border-r border-border/60 tabular-nums"
                              title={formatOdorAlertTime(row.at)}
                            >
                              {formatOdorAlertTime(row.at)}
                            </td>
                            <td className="standard-table-td-compact" title={row.reason}>
                              {row.reason}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <NetworkStylePager
                  total={myHistory.length}
                  page={historyPage}
                  onPageChange={setHistoryPage}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
