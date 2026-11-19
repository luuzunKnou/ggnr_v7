'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dongSummaryClient } from '@/lib/realTransactionPriceClient'
import {
  MONTH_OPTIONS,
  dealYmdParts,
  defaultDealYmd,
  formatWon,
  yearOptions,
  type DongSortKey,
  type DongSummaryRow,
} from './realTransactionPriceConfig'
import { useRealTransactionPriceLayer } from './useRealTransactionPriceLayer'

type SortSpec = { key: DongSortKey; dir: 'asc' | 'desc' }

type Props = {
  onClose: () => void
  selectedUmd: string | null
  dealYmd: string
  onDealYmdChange: (dealYmd: string) => void
  onSelect: (umdNm: string | null) => void
}

const LIST_COLUMNS: {
  key: DongSortKey
  label: string
  className: string
  align: 'left' | 'right'
}[] = [
  { key: 'umdNm', label: '읍면동', className: 'w-[34%]', align: 'left' },
  { key: 'count', label: '건수', className: 'w-[14%]', align: 'right' },
  { key: 'avgPerSqm', label: '평균 실거래가(원/m²)', className: 'w-[52%]', align: 'right' },
]

export function RealTransactionPriceListPanel({
  onClose,
  selectedUmd,
  dealYmd,
  onDealYmdChange,
  onSelect,
}: Props) {
  const parts = dealYmdParts(dealYmd || defaultDealYmd())
  const [year, setYear] = useState(parts.year)
  const [month, setMonth] = useState(parts.month)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<DongSummaryRow[]>([])
  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [sort, setSort] = useState<SortSpec>({ key: 'count', dir: 'desc' })
  const [fitSelected, setFitSelected] = useState(false)
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map())
  const years = useMemo(() => yearOptions(), [])

  const loadSummary = useCallback(
    async (ymd: string) => {
      setLoading(true)
      setError(null)
      onSelect(null)
      try {
        const data = await dongSummaryClient({ dealYmd: ymd })
        setRows(Array.isArray(data.rows) ? (data.rows as DongSummaryRow[]) : [])
        onDealYmdChange(ymd)
      } catch (e) {
        setRows([])
        setError(e instanceof Error ? e.message : '조회하지 못했습니다.')
      } finally {
        setLoading(false)
      }
    },
    [onDealYmdChange, onSelect]
  )

  useEffect(() => {
    const ymd = dealYmd || defaultDealYmd()
    const p = dealYmdParts(ymd)
    setYear(p.year)
    setMonth(p.month)
    void loadSummary(ymd)
    // 최초·부모 dealYmd 초기값만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setKeyword(keywordInput.replace(/\s+/g, '')), 300)
    return () => clearTimeout(timer)
  }, [keywordInput])

  useRealTransactionPriceLayer({
    dealYmd,
    enabled: true,
    selectedUmd,
    onSelectUmd: (umd) => {
      setFitSelected(true)
      onSelect(umd)
    },
    fitSelected,
    onFitDone: () => setFitSelected(false),
  })

  const onYearMonthChange = (nextYear: string, nextMonth: string) => {
    setYear(nextYear)
    setMonth(nextMonth)
    void loadSummary(`${nextYear}${nextMonth}`)
  }

  const selectFromList = (umdNm: string) => {
    setFitSelected(true)
    onSelect(umdNm)
  }

  const filteredSorted = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    let list = rows
    if (q) list = list.filter((r) => r.umdNm.toLowerCase().includes(q))
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      if (sort.key === 'umdNm') return a.umdNm.localeCompare(b.umdNm, 'ko') * dir
      if (sort.key === 'count') return (a.count - b.count) * dir
      const av = a.avgPerSqm ?? -1
      const bv = b.avgPerSqm ?? -1
      return (av - bv) * dir
    })
  }, [rows, keyword, sort])

  useEffect(() => {
    if (!selectedUmd) return
    const node = rowRefs.current.get(selectedUmd)
    node?.scrollIntoView({ block: 'nearest' })
  }, [selectedUmd])

  const toggleSort = (key: DongSortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'umdNm' ? 'asc' : 'desc' }
    )
  }

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title">실거래가</span>
        <button type="button" onClick={onClose} className="standard-panel-close" title="닫기" aria-label="닫기">
          <X className="h-4 w-4" />
        </button>
      </div>

      {error ? (
        <div className="standard-detail-empty-dashed m-3">{error}</div>
      ) : (
        <>
          <div className="standard-filter-section">
            <div className="flex items-center gap-1.5">
              <select
                className="standard-filter-select max-w-none min-w-0 flex-1"
                value={year}
                onChange={(e) => onYearMonthChange(e.target.value, month)}
                aria-label="계약년도"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
              </select>
              <select
                className="standard-filter-select max-w-none min-w-0 flex-1"
                value={month}
                onChange={(e) => onYearMonthChange(year, e.target.value)}
                aria-label="계약월"
              >
                {MONTH_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {Number(m)}월
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <div className="standard-search-wrap min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  placeholder="읍면동"
                  className="w-full rounded-md border border-border bg-background py-1 pl-7 pr-2 text-xs text-foreground outline-none ring-offset-2 focus:border-border focus:ring-2 focus:ring-ring scheme-light dark:scheme-dark"
                />
              </div>
            </div>
          </div>

          <div className="standard-list-body mt-2">
            <div className="standard-list-scroll scrollbar-thin">
              <table className="standard-list-table">
                <thead className="standard-table-thead">
                  <tr>
                    {LIST_COLUMNS.map((col) => {
                      const active = sort.key === col.key
                      const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
                      const thAlign = col.align === 'left' ? 'standard-table-th-left' : 'text-right'
                      const sortAlign =
                        col.align === 'left' ? 'standard-sort-button-left' : 'ml-auto justify-end'
                      return (
                        <th
                          key={col.key}
                          className={cn('standard-table-th max-w-none whitespace-nowrap', thAlign, col.className)}
                        >
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key)}
                            className={cn(
                              'standard-sort-button max-w-none whitespace-nowrap',
                              sortAlign,
                              active && 'standard-sort-button-active'
                            )}
                            title={`${col.label} 정렬`}
                          >
                            <span>{col.label}</span>
                            <Icon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                          </button>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filteredSorted.length === 0 ? (
                    <tr>
                      <td colSpan={LIST_COLUMNS.length} className="standard-table-empty">
                        {loading ? '' : '해당 월 토지 매매 자료가 없습니다.'}
                      </td>
                    </tr>
                  ) : (
                    filteredSorted.map((r) => (
                      <tr
                        key={r.umdNm}
                        ref={(node) => {
                          if (node) rowRefs.current.set(r.umdNm, node)
                          else rowRefs.current.delete(r.umdNm)
                        }}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectFromList(r.umdNm)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            selectFromList(r.umdNm)
                          }
                        }}
                        className={cn(
                          'standard-list-row',
                          selectedUmd === r.umdNm && 'standard-list-row-selected'
                        )}
                      >
                        <td className="standard-table-td-text w-[34%]" title={r.umdNm}>
                          {r.umdNm}
                        </td>
                        <td className="standard-table-td-date w-[14%] whitespace-nowrap text-right">
                          {r.count.toLocaleString('ko-KR')}
                        </td>
                        <td className="standard-table-td-date w-[52%] whitespace-nowrap text-right">
                          {formatWon(r.avgPerSqm)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="standard-list-footer flex items-center justify-between gap-2">
              <span className="tabular-nums">
                {loading ? '불러오는 중' : `${filteredSorted.length.toLocaleString('ko-KR')}건`}
              </span>
              <span className="text-muted-foreground">읍면동·리</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
