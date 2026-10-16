'use client'

import { useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from 'lucide-react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  INDIVIDUAL_LAND_PRICE_SERVICE,
  formatWon,
  isStandardYn,
  parcelAddress,
  type LandPriceEmd,
  type LandPriceRow,
  type LandPriceSortKey,
  type LandPriceYear,
} from './individualLandPriceConfig'
import { useIndividualLandPriceMapClick, useOfficialLandPriceControlWhileOpen } from './useIndividualLandPriceLayer'

const PAGE_SIZE = 200
const SCROLL_LOAD_THRESHOLD_PX = 240
const KEYWORD_DEBOUNCE_MS = 350
const ALL = ''

type SortSpec = { key: LandPriceSortKey; dir: 'asc' | 'desc' }

type ListRes = { total: number; rows: LandPriceRow[] }

async function callService<T>(action: string, params: Record<string, unknown>): Promise<T> {
  const res = await call('', 'POST', { service: INDIVIDUAL_LAND_PRICE_SERVICE, action, params })
  if (!res?.success) throw new Error(String((res as { error?: string })?.error ?? '조회하지 못했습니다.'))
  return (res.data ?? res) as T
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : '조회하지 못했습니다.'
}

const LIST_COLUMNS: {
  key: LandPriceSortKey | null
  label: string
  title?: string
  className: string
  align: 'left' | 'right' | 'center'
}[] = [
  { key: 'pnu', label: '소재지·지번', className: 'w-[40%]', align: 'left' },
  { key: 'price', label: '공시지가', title: '공시지가(원/㎡)', className: 'w-[38%]', align: 'right' },
  { key: null, label: '표준지', className: 'w-[22%]', align: 'center' },
]

type Props = {
  onClose: () => void
  selectedPnu: string | null
  onSelect: (pnu: string | null) => void
}

export function IndividualLandPriceListPanel({ onClose, selectedPnu, onSelect }: Props) {
  /** 파일의 최신 기준연도만 쓴다 */
  const [year, setYear] = useState('')
  const [emd, setEmd] = useState(ALL)
  const [emdRows, setEmdRows] = useState<LandPriceEmd[]>([])
  const [initError, setInitError] = useState<string | null>(null)

  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [standardOnly, setStandardOnly] = useState(false)
  const [sort, setSort] = useState<SortSpec>({ key: 'pnu', dir: 'asc' })
  const [listResult, setListResult] = useState<{
    key: string
    rows: LandPriceRow[]
    total: number
    error: string | null
  } | null>(null)

  useIndividualLandPriceMapClick(onSelect)
  useOfficialLandPriceControlWhileOpen()

  useEffect(() => {
    let cancelled = false
    callService<{ years: LandPriceYear[] }>('years', {})
      .then((d) => {
        if (cancelled) return
        if (!d.years?.length) setInitError('공시지가 파일 자료가 없습니다. 연계 작업이 끝났는지 확인하세요.')
        else setYear(d.years[0]!.year)
      })
      .catch((e) => {
        if (!cancelled) setInitError(errorText(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!year) return
    let cancelled = false
    callService<{ rows: LandPriceEmd[] }>('emds', { year })
      .then((d) => {
        if (!cancelled) setEmdRows(d.rows ?? [])
      })
      .catch(() => {
        if (!cancelled) setEmdRows([])
      })
    return () => {
      cancelled = true
    }
  }, [year])

  const listParams = useMemo(
    () => ({ year, emd, keyword, standardOnly, sort: sort.key, dir: sort.dir }),
    [year, emd, keyword, standardOnly, sort]
  )

  /** 응답을 조건 키와 함께 보관 — 조건이 바뀌면 키가 달라져 첫 묶음부터 다시 받는다 */
  const requestKey = JSON.stringify(listParams)
  const requestKeyRef = useRef(requestKey)
  const loadingMoreRef = useRef(false)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    requestKeyRef.current = requestKey
    if (!listParams.year) return
    let cancelled = false
    callService<ListRes>('list', { ...listParams, page: 1, pageSize: PAGE_SIZE })
      .then((d) => {
        if (!cancelled) setListResult({ key: requestKey, rows: d.rows ?? [], total: d.total, error: null })
      })
      .catch((e) => {
        if (!cancelled) setListResult({ key: requestKey, rows: [], total: 0, error: errorText(e) })
      })
    return () => {
      cancelled = true
    }
  }, [listParams, requestKey])

  const current = listResult?.key === requestKey ? listResult : null
  const rows = current?.rows ?? []
  const total = current?.total ?? 0
  const listLoading = Boolean(listParams.year) && !current
  const listError = current?.error ?? null

  const loadMore = () => {
    if (!current || loadingMoreRef.current || rows.length >= total) return
    const key = requestKey
    loadingMoreRef.current = true
    setLoadingMore(true)
    callService<ListRes>('list', { ...listParams, page: Math.floor(rows.length / PAGE_SIZE) + 1, pageSize: PAGE_SIZE })
      .then((d) => {
        if (requestKeyRef.current !== key) return
        setListResult((prev) => {
          if (!prev || prev.key !== key) return prev
          const seen = new Set(prev.rows.map((r) => r.pnu))
          return { ...prev, rows: [...prev.rows, ...(d.rows ?? []).filter((r) => !seen.has(r.pnu))], total: d.total }
        })
      })
      .catch((e) => window.alert(errorText(e)))
      .finally(() => {
        loadingMoreRef.current = false
        setLoadingMore(false)
      })
  }

  const handleListScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_LOAD_THRESHOLD_PX) loadMore()
  }

  const sortedEmdNames = useMemo(
    () => [...emdRows].sort((a, b) => a.emdName.localeCompare(b.emdName, 'ko')),
    [emdRows]
  )

  const toggleSort = (key: LandPriceSortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'pnu' ? 'asc' : 'desc' }
    )
  }

  useEffect(() => {
    const next = keywordInput.replace(/\s+/g, '').replace(/-$/, '')
    const timer = setTimeout(() => setKeyword(next), KEYWORD_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [keywordInput])

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title">
          개별공시지가
          {year ? <span className="ml-1 text-xs font-normal text-muted-foreground">{year}년 기준</span> : null}
        </span>
        <button type="button" onClick={onClose} className="standard-panel-close" title="닫기" aria-label="닫기">
          <X className="h-4 w-4" />
        </button>
      </div>

      {initError ? (
        <div className="standard-detail-empty-dashed m-3">{initError}</div>
      ) : (
        <>
          <div className="standard-filter-section">
            <div className="flex items-center gap-1.5">
              <select
                className="standard-filter-select max-w-none min-w-0 flex-1"
                value={emd}
                onChange={(e) => setEmd(e.target.value)}
                aria-label="읍면동"
              >
                <option value={ALL}>전체 읍면동</option>
                {sortedEmdNames.map((r) => (
                  <option key={r.emdCd} value={r.emdCd}>
                    {r.emdName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={cn('standard-filter-chip shrink-0', standardOnly && 'standard-filter-chip-active')}
                onClick={() => setStandardOnly((v) => !v)}
                aria-pressed={standardOnly}
                title="표준지만 보기"
              >
                표준지만
              </button>
            </div>
            <div className="standard-search-wrap">
              <Search className="standard-search-icon" />
              <input
                type="search"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                placeholder="소재지·지번"
                title="소재지(읍면동·리) 또는 지번 (예: 삼산동, 12-3, 산5)"
                className="standard-search-input"
              />
            </div>
          </div>

          <div className="standard-list-body mt-2">
            <div
              key={requestKey}
              className="standard-list-scroll scrollbar-thin"
              onScroll={handleListScroll}
            >
              <table className="standard-list-table">
                <thead className="standard-table-thead">
                  <tr>
                    {LIST_COLUMNS.map((col) => {
                      const sortKey = col.key
                      const active = sortKey != null && sort.key === sortKey
                      const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
                      const thAlign =
                        col.align === 'left'
                          ? 'standard-table-th-left'
                          : col.align === 'right'
                            ? 'text-right'
                            : 'standard-table-th-center'
                      const sortAlign =
                        col.align === 'left'
                          ? 'standard-sort-button-left'
                          : col.align === 'right'
                            ? 'ml-auto justify-end'
                            : 'standard-sort-button-center'
                      return (
                        <th
                          key={col.label}
                          title={col.title}
                          className={cn('standard-table-th max-w-none whitespace-nowrap', thAlign, col.className)}
                        >
                          {sortKey ? (
                            <button
                              type="button"
                              onClick={() => toggleSort(sortKey)}
                              className={cn(
                                'standard-sort-button max-w-none whitespace-nowrap',
                                sortAlign,
                                active && 'standard-sort-button-active'
                              )}
                              title={`${col.title ?? col.label} 정렬`}
                            >
                              <span>{col.label}</span>
                              <Icon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                            </button>
                          ) : (
                            <span>{col.label}</span>
                          )}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={LIST_COLUMNS.length} className="standard-table-empty">
                        {listLoading ? '' : (listError ?? '조회된 필지가 없습니다.')}
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr
                        key={r.pnu}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelect(r.pnu)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onSelect(r.pnu)
                          }
                        }}
                        className={cn('standard-list-row', selectedPnu === r.pnu && 'standard-list-row-selected')}
                      >
                        <td className="standard-table-td-text w-[40%]" title={`${parcelAddress(r)} (${r.pnu})`}>
                          {parcelAddress(r) || r.pnu}
                        </td>
                        <td className="standard-table-td-date w-[38%] whitespace-nowrap text-right">
                          {formatWon(r.price)}
                        </td>
                        <td className="standard-table-td-date w-[22%] text-center">
                          {isStandardYn(r.standardYn) ? (
                            <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">
                              표준
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="standard-list-footer flex items-center justify-between gap-2">
              <span className="tabular-nums">
                {current ? `${rows.length.toLocaleString()} / ${total.toLocaleString()}건` : '—'}
              </span>
              <span className="text-muted-foreground">
                {loadingMore ? '더 불러오는 중' : '단위 원/㎡'}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
