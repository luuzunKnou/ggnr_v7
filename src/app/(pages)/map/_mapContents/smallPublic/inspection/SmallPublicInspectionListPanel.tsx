'use client'

import { useMemo, useRef } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  SmallPublicSortTh,
  smallPublicSelectedRowClass,
  smallPublicSortRows,
  useSmallPublicScrollSelectedIntoView,
  useSmallPublicSort,
} from '../smallPublicUi'
import type { SmallPublicInspectionReport } from './smallPublicInspectionReport'

/** 보고서 목록 한 줄 — 그해 점검을 마친 대상 수 */
export type SmallPublicReportListRow = { report: SmallPublicInspectionReport; inspected: number }

type SortKey = 'year' | 'title' | 'targets' | 'inspected'
const initialSortDir = (key: SortKey) => (key === 'title' ? 'asc' : 'desc')

type Props = {
  keyword: string
  onKeywordChange: (keyword: string) => void
  /** '' = 전체 연도 */
  year: string
  onYearChange: (year: string) => void
  yearOptions: number[]
  rows: SmallPublicReportListRow[]
  selectedId: string | null
  /** 같은 보고서 재선택 시 닫기(토글)는 셸에서 처리 */
  onSelect: (id: string) => void
  onAdd: () => void
  onClose: () => void
  /** 상세와 위·아래 배치 — 헤더·푸터 생략, 높이만 채움 */
  embedded?: boolean
}

/** 안전점검 보고서 목록 — 연도 필터·검색·표 형식 */
export function SmallPublicInspectionListPanel({
  keyword,
  onKeywordChange,
  year,
  onYearChange,
  yearOptions,
  rows,
  selectedId,
  onSelect,
  embedded = false,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useSmallPublicScrollSelectedIntoView(scrollRef, selectedId)
  const sort = useSmallPublicSort<SortKey>(initialSortDir)
  const sortedRows = useMemo(
    () =>
      smallPublicSortRows(rows, sort.sorts, ({ report: r, inspected }, key) => {
        if (key === 'year') return r.year
        if (key === 'title') return r.title
        if (key === 'targets') return r.rows.length
        return inspected
      }),
    [rows, sort.sorts]
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-[12px]">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-1.5">
        <select
          className="standard-filter-select h-7 w-[6rem] max-w-none text-[11px]"
          value={year}
          onChange={(e) => onYearChange(e.target.value)}
          aria-label="연도"
        >
          <option value="">전체 연도</option>
          {yearOptions.map((y) => (
            <option key={y} value={String(y)}>
              {y}년
            </option>
          ))}
        </select>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => onKeywordChange(e.target.value)}
            placeholder="보고서명·작성자 검색"
            className="h-7 w-full rounded-md border border-border bg-background pl-7 pr-2 text-[12px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <table className="w-full table-fixed border-collapse text-left text-[12px] leading-snug">
          <colgroup>
            <col className="w-[52px]" />
            <col />
            <col className="w-[64px]" />
            <col className="w-[80px]" />
          </colgroup>
          <thead className="sticky top-0 z-[1] bg-muted">
            <tr className="[&>th]:whitespace-nowrap [&>th]:px-1.5 [&>th]:py-1.5 [&>th]:font-semibold [&>th]:text-foreground/90 [&>th]:[box-shadow:inset_0_-2px_0_0_var(--border)]">
              <SmallPublicSortTh sort={sort} sortKey="year" label="연도" className="px-1.5 py-1.5 pl-3" />
              <SmallPublicSortTh sort={sort} sortKey="title" label="보고서명" className="px-1.5 py-1.5" />
              <SmallPublicSortTh sort={sort} sortKey="targets" label="대상" align="center" className="px-1.5 py-1.5" />
              <SmallPublicSortTh sort={sort} sortKey="inspected" label="점검" align="center" className="px-1.5 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                  보고서가 없습니다. «보고서 추가»로 만드세요.
                </td>
              </tr>
            ) : (
              sortedRows.map(({ report: r, inspected }) => {
                const active = selectedId === r.id
                return (
                  <tr
                    key={r.id}
                    data-row-id={r.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={active}
                    title={active ? '다시 누르면 닫힙니다' : r.title}
                    onClick={() => onSelect(r.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelect(r.id)
                      }
                    }}
                    className={cn(
                      'cursor-pointer border-b border-border transition-colors',
                      active ? smallPublicSelectedRowClass : 'hover:bg-muted/50'
                    )}
                  >
                    <td className="px-1.5 py-1.5 pl-3 tabular-nums">{r.year}</td>
                    <td
                      className={cn('truncate px-1.5 py-1.5', active ? 'text-primary' : 'text-foreground')}
                      title={r.title}
                    >
                      {r.title}
                    </td>
                    <td className="px-1.5 py-1.5 text-center tabular-nums">{r.rows.length}</td>
                    <td className="px-1.5 py-1.5 text-center tabular-nums">
                      {inspected}
                      <span className="text-muted-foreground">
                        {' '}
                        ({r.rows.length ? Math.round((inspected / r.rows.length) * 100) : 0}%)
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      {embedded ? null : <div className="standard-list-footer">총 {rows.length}건</div>}
    </div>
  )
}
