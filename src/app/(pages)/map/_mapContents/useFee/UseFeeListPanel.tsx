'use client'

import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowDown, ArrowUp, ArrowUpDown, Layers, Search, X } from 'lucide-react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import { getUseFeeBinding } from '@/lib/useFeeBinding'
import { useMapContext } from '../../_mapComponents/MapContext'
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../_mapComponents/config/mapDefaults'
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation'
import { LayerRowPanelButton } from '../../_mapComponents/layerRowEdit'
import {
  clearUseFeeOccupationLedgerWmsLayers,
  clearUseFeeWmsLayer,
  ensureUseFeeWmsLayer,
  getUseFeeOccupationLedgerTarget,
  isUseFeeOccupationLedgerWmsVisible,
  toggleUseFeeOccupationLedgerWmsLayer,
} from './useFeeMapSync'
import { occupationLayerToggleActiveStyle } from '@/lib/occupationLayerStyle'
import { useUseFeeGeomHighlight } from './useUseFeeGeomHighlight'

type ListRow = {
  id: string
  status: string
  ledgerNo: string
  dptNm: string
  payer: string
  amount: string
  dueDate: string
}

type SortKey = 'status' | 'ledgerNo' | 'dptNm' | 'payer' | 'amount' | 'dueDate'
type SortDir = 'asc' | 'desc'
type SortSpec = { key: SortKey; dir: SortDir }
type FeeStatusFilter = '전체' | '미납' | '수납'

const FEE_STATUS_FILTERS: FeeStatusFilter[] = ['전체', '미납', '수납']
const PAGE_SIZE = 500

const SORT_COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: 'status', label: '상태' },
  { key: 'ledgerNo', label: '대장번호' },
  { key: 'dptNm', label: '부서명' },
  { key: 'payer', label: '납부자' },
  { key: 'amount', label: '납부금액' },
  { key: 'dueDate', label: '납기일' },
]

function initialSortDir(key: SortKey): SortDir {
  return key === 'status' || key === 'dptNm' || key === 'payer' ? 'asc' : 'desc'
}

type ListProps = {
  onClose: () => void
  selectedId: string | null
  onSelectId: (id: string) => void
  /** water|road|publicNglFeeList */
  serEng: string
}

export function UseFeeListPanel({ onClose, selectedId, onSelectId, serEng }: ListProps) {
  const searchParams = useSearchParams()
  const system = String(searchParams.get('system') ?? '').trim()
  const feeQuery = { system: system || undefined, serEng: serEng || undefined }
  const mapContext = useMapContext()
  const mapContextRef = useRef(mapContext)
  mapContextRef.current = mapContext

  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  /** 빈 문자열 = 전체 */
  const [dptNm, setDptNm] = useState('')
  const [feeStatusFilter, setFeeStatusFilter] = useState<FeeStatusFilter>('전체')
  const [sorts, setSorts] = useState<SortSpec[]>([])
  const [departments, setDepartments] = useState<string[]>([])
  const [rows, setRows] = useState<ListRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isUljinRiver, setIsUljinRiver] = useState(false)
  const listScrollRef = useRef<HTMLDivElement | null>(null)
  const loadingMoreRef = useRef(false)
  const rowsLenRef = useRef(0)
  const totalRef = useRef(0)
  /** 지도 픽이 클릭 도형으로 맞춘 경우 — selectedId 자동 fit 1회 건너뜀 */
  const skipAutoFitOnceRef = useRef(false)
  rowsLenRef.current = rows.length
  totalRef.current = total

  useUseFeeGeomHighlight(selectedId, Boolean(selectedId), serEng)

  useEffect(() => {
    let cancelled = false
    void call('', 'POST', { service: 'configService', action: 'getBootProject', params: {} })
      .then((res) => {
        if (cancelled) return
        const data = res?.data ?? res
        setIsUljinRiver(String(data?.project ?? '').trim() === 'build_uj')
      })
      .catch(() => {
        if (!cancelled) setIsUljinRiver(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    ensureUseFeeWmsLayer(mapContextRef.current?.setVisibleLayerNames, feeQuery)
    return () => {
      clearUseFeeOccupationLedgerWmsLayers(mapContextRef.current?.setVisibleLayerNames)
      clearUseFeeWmsLayer(mapContextRef.current?.setVisibleLayerNames)
    }
  }, [serEng, system])

  const fitMapAfterDetailLayout = useCallback(
    (extent3857: number[]) => {
      const map = mapContext?.mapInstanceRef?.current
      if (!map) return
      ensureUseFeeWmsLayer(mapContext?.setVisibleLayerNames, feeQuery)
      window.setTimeout(() => {
        scheduleFitMapToExtent3857(map, extent3857, {
          maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
          applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
        })
      }, 80)
    },
    [mapContext, serEng, system]
  )

  const fitMapToFeeId = useCallback(
    async (id: string) => {
      const key = String(id ?? '').trim()
      if (!key) return
      try {
        const res = await call('', 'POST', {
          service: 'useFeeService',
          action: 'getUseFeeExtent3857ById',
          params: { id: key, ...feeQuery },
        })
        const data = res?.data ?? res
        const ext = data?.extent3857 as unknown
        if (!Array.isArray(ext) || ext.length !== 4) return
        if (!ext.every((v) => Number.isFinite(Number(v)))) return
        fitMapAfterDetailLayout(ext.map(Number))
      } catch {
        /* geom 없으면 무시 */
      }
    },
    [fitMapAfterDetailLayout, serEng, system]
  )

  useEffect(() => {
    const key = String(selectedId ?? '').trim()
    if (!key) return
    if (skipAutoFitOnceRef.current) {
      skipAutoFitOnceRef.current = false
      return
    }
    void fitMapToFeeId(key)
  }, [selectedId, fitMapToFeeId])

  useEffect(() => {
    const pickRef = mapContext?.applyUseFeeMapPickRef
    if (!pickRef) return
    pickRef.current = (pick) => {
      const id = String(pick?.id ?? '').trim()
      if (!id) return
      const opts = Array.isArray(pick?.overlapOptions) ? pick.overlapOptions : []
      mapContext?.setUseFeeMapHitOptions?.(opts.length > 1 ? opts : [])

      const clickedExt = pick?.extent3857
      if (
        Array.isArray(clickedExt) &&
        clickedExt.length === 4 &&
        clickedExt.every((v) => Number.isFinite(Number(v)))
      ) {
        skipAutoFitOnceRef.current = true
        onSelectId(id)
        fitMapAfterDetailLayout(clickedExt.map(Number))
        return
      }
      onSelectId(id)
    }
    return () => {
      pickRef.current = null
    }
  }, [mapContext, onSelectId, fitMapAfterDetailLayout])

  useEffect(() => {
    if (!selectedId) return
    // 무한스크롤로 아직 안 불러온 행이면 목록 삽입·스크롤하지 않음 (정렬 유지, 상세만 열림)
    if (!rows.some((r) => r.id === selectedId)) return
    const scroller = listScrollRef.current
    if (!scroller) return
    const el = scroller.querySelector(`[data-use-fee-row="${CSS.escape(selectedId)}"]`)
    if (!(el instanceof HTMLElement)) return
    const scrollerRect = scroller.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    const delta =
      elRect.top + elRect.height / 2 - (scrollerRect.top + scrollerRect.height / 2)
    if (Math.abs(delta) < 4) return
    scroller.scrollBy({ top: delta, behavior: 'smooth' })
  }, [selectedId, rows])

  const handleRowClick = useCallback(
    (id: string) => {
      if (!id) return
      mapContext?.setUseFeeMapHitOptions?.([])
      if (id === selectedId) {
        void fitMapToFeeId(id)
        return
      }
      onSelectId(id)
    },
    [selectedId, onSelectId, fitMapToFeeId, mapContext]
  )

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedKeyword(keyword.trim()), 300)
    return () => window.clearTimeout(t)
  }, [keyword])

  useEffect(() => {
    let cancelled = false
    void call('', 'POST', {
      service: 'useFeeService',
      action: 'getUseFeeDepartments',
      params: feeQuery,
    })
      .then((res) => {
        if (cancelled) return
        const data = (res?.data ?? res) as { departments?: string[] }
        const next = Array.isArray(data?.departments) ? data.departments : []
        setDepartments(next)
        setDptNm((prev) => (prev && !next.includes(prev) ? '' : prev))
      })
      .catch(() => {
        if (!cancelled) setDepartments([])
      })
    return () => {
      cancelled = true
    }
  }, [serEng, system])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setRows([])
    setTotal(0)
    void call('', 'POST', {
      service: 'useFeeService',
      action: 'getUseFeeList',
      params: {
        keyword: debouncedKeyword,
        dptNm: dptNm || undefined,
        feeStatus: feeStatusFilter === '전체' ? undefined : feeStatusFilter,
        sorts: sorts.length > 0 ? sorts : undefined,
        ...feeQuery,
        limit: PAGE_SIZE,
        offset: 0,
      },
    })
      .then((res) => {
        if (cancelled) return
        const data = (res?.data ?? res) as {
          rows?: ListRow[]
          total?: number
          error?: string
        }
        if (data?.error) setError(data.error)
        setRows(Array.isArray(data?.rows) ? data.rows : [])
        setTotal(Number(data?.total ?? 0))
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setRows([])
        setTotal(0)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedKeyword, dptNm, feeStatusFilter, sorts, serEng, system])

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || loading) return
    const offset = rowsLenRef.current
    if (offset >= totalRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    void call('', 'POST', {
      service: 'useFeeService',
      action: 'getUseFeeList',
      params: {
        keyword: debouncedKeyword,
        dptNm: dptNm || undefined,
        feeStatus: feeStatusFilter === '전체' ? undefined : feeStatusFilter,
        sorts: sorts.length > 0 ? sorts : undefined,
        system: system || undefined,
        serEng: serEng || undefined,
        limit: PAGE_SIZE,
        offset,
      },
    })
      .then((res) => {
        const data = (res?.data ?? res) as {
          rows?: ListRow[]
          total?: number
          error?: string
        }
        if (data?.error) {
          setError(data.error)
          return
        }
        const next = Array.isArray(data?.rows) ? data.rows : []
        setRows((prev) => {
          const seen = new Set(prev.map((r) => r.id))
          const appended = next.filter((r) => !seen.has(r.id))
          return appended.length ? [...prev, ...appended] : prev
        })
        if (typeof data?.total === 'number') setTotal(Number(data.total))
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        loadingMoreRef.current = false
        setLoadingMore(false)
      })
  }, [
    loading,
    debouncedKeyword,
    dptNm,
    feeStatusFilter,
    sorts,
    serEng,
    system,
  ])

  const onListScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget
      const remain = el.scrollHeight - el.scrollTop - el.clientHeight
      if (remain < 240) loadMore()
    },
    [loadMore]
  )

  const toggleSort = (key: SortKey) => {
    const initial = initialSortDir(key)
    setSorts((prev) => {
      const idx = prev.findIndex((s) => s.key === key)
      if (idx < 0) return [...prev, { key, dir: initial }]
      const cur = prev[idx]
      if (cur.dir === initial) {
        const next = [...prev]
        next[idx] = { key, dir: initial === 'asc' ? 'desc' : 'asc' }
        return next
      }
      return prev.filter((_, i) => i !== idx)
    })
  }

  const feeBinding = getUseFeeBinding({ serEng, system })
  const occupationTarget = getUseFeeOccupationLedgerTarget({
    system,
    serEng,
    isUljinRiver,
  })
  const occupationLayerOn = isUseFeeOccupationLedgerWmsVisible(
    mapContext?.visibleLayerNames,
    occupationTarget
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-sm font-semibold text-foreground">{feeBinding.title}</span>
        <div className="flex items-center gap-1">
          <LayerRowPanelButton
            type="button"
            title={
              occupationLayerOn
                ? `${occupationTarget.label} 레이어 끄기`
                : `${occupationTarget.label} 레이어 켜기`
            }
            aria-label={
              occupationLayerOn
                ? `${occupationTarget.label} 레이어 끄기`
                : `${occupationTarget.label} 레이어 켜기`
            }
            aria-pressed={occupationLayerOn}
            onClick={() =>
              toggleUseFeeOccupationLedgerWmsLayer(
                mapContext?.setVisibleLayerNames,
                occupationTarget
              )
            }
            style={occupationLayerOn ? occupationLayerToggleActiveStyle('parent') : undefined}
            className={occupationLayerOn ? 'hover:opacity-90' : undefined}
          >
            <Layers className="h-3 w-3 shrink-0" aria-hidden />
            {occupationTarget.label}
          </LayerRowPanelButton>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="shrink-0 space-y-2 border-b border-border px-3 py-2">
        <div className="flex items-stretch gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="검색 (대장번호, 부서명, 납부자, 상태)"
              className="h-8 w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none ring-offset-2 focus:border-border focus:ring-2 focus:ring-border"
            />
          </div>
          <div
            className="flex shrink-0 rounded-md border border-border bg-muted/50 p-0.5"
            role="group"
            aria-label="미납·수납 필터"
            title="미납·수납"
          >
            {FEE_STATUS_FILTERS.map((filter) => {
              const active = feeStatusFilter === filter
              return (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setFeeStatusFilter(filter)}
                  className={cn(
                    'rounded px-1.5 py-1 text-[10px] font-medium transition-colors',
                    active
                      ? 'bg-background text-primary shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  aria-pressed={active}
                >
                  {filter}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {(
            [
              { value: '', label: '전체' },
              ...departments.map((name) => ({ value: name, label: name })),
            ] as const
          ).map((opt) => {
            const active = dptNm === opt.value
            return (
              <button
                key={opt.value || '__all__'}
                type="button"
                onClick={() => setDptNm(opt.value)}
                title={opt.label}
                className={cn(
                  'max-w-full truncate rounded border px-2 py-1 text-[11px] font-medium transition-colors',
                  active
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border bg-background text-muted-foreground hover:border-border hover:text-foreground'
                )}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          ref={listScrollRef}
          className="min-h-0 flex-1 overflow-auto scrollbar-thin"
          onScroll={onListScroll}
        >
          <table className="w-full min-w-[517px] table-fixed border-collapse text-left text-xs">
            <colgroup>
              <col className="w-[55px]" />
              <col className="w-[88px]" />
              <col className="w-[80px]" />
              <col className="w-[90px]" />
              <col className="w-[90px]" />
              <col className="w-[80px]" />
            </colgroup>
            <thead className="sticky top-0 z-[1] bg-muted/50">
              <tr>
                {SORT_COLUMNS.map((col) => {
                  const sortIdx = sorts.findIndex((s) => s.key === col.key)
                  const active = sortIdx >= 0
                  const sortDir = active ? sorts[sortIdx].dir : null
                  const Icon = !active
                    ? ArrowUpDown
                    : sortDir === 'asc'
                      ? ArrowUp
                      : ArrowDown
                  const initial = initialSortDir(col.key)
                  return (
                    <th
                      key={col.key}
                      className="whitespace-nowrap border-b-0 px-1.5 py-1.5 text-center font-semibold text-foreground/90 [box-shadow:inset_0_-2px_0_0_var(--border)]"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          'inline-flex max-w-full items-center justify-center gap-0.5 rounded px-0.5 py-0.5 transition-colors hover:bg-muted',
                          active ? 'text-primary' : 'text-foreground/90'
                        )}
                        title={
                          !active
                            ? `${col.label} 정렬 추가`
                            : sortDir === initial
                              ? `${col.label} 방향 바꾸기`
                              : `${col.label} 정렬 해제`
                        }
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
              {error ? (
                <tr>
                  <td
                    colSpan={SORT_COLUMNS.length}
                    className="px-3 py-6 text-center text-xs text-destructive"
                  >
                    {error}
                  </td>
                </tr>
              ) : loading && rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={SORT_COLUMNS.length}
                    className="px-3 py-6 text-center text-xs text-muted-foreground"
                  >
                    불러오는 중…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={SORT_COLUMNS.length}
                    className="px-3 py-6 text-center text-xs text-muted-foreground"
                  >
                    조회된 점사용료가 없습니다.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const isSelected = selectedId === row.id
                  return (
                    <tr
                      key={row.id}
                      data-use-fee-row={row.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleRowClick(row.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleRowClick(row.id)
                        }
                      }}
                      className={cn(
                        'cursor-pointer border-b border-border transition-colors hover:bg-muted/50',
                        isSelected && 'bg-primary/10'
                      )}
                    >
                      <td className="px-1.5 py-1.5 text-center">
                        <span
                          className={cn(
                            'inline-block rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                            row.status === '미납'
                              ? 'bg-destructive/10 text-destructive'
                              : 'bg-primary/10 text-primary'
                          )}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="truncate px-1.5 py-1.5 text-foreground" title={row.ledgerNo}>
                        {row.ledgerNo || '—'}
                      </td>
                      <td className="truncate px-1.5 py-1.5 text-foreground/90" title={row.dptNm}>
                        {row.dptNm || '—'}
                      </td>
                      <td className="truncate px-1.5 py-1.5 text-foreground/90" title={row.payer}>
                        {row.payer || '—'}
                      </td>
                      <td
                        className="truncate px-1 py-1.5 text-right tabular-nums text-foreground/90"
                        title={row.amount}
                      >
                        {row.amount}
                      </td>
                      <td
                        className="truncate px-1 py-1.5 tabular-nums text-foreground/90"
                        title={row.dueDate}
                      >
                        {row.dueDate}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
          {rows.length > 0 ? (
            loadingMore ? (
              <div className="px-3 py-2 text-center text-[11px] text-muted-foreground">더 불러오는 중…</div>
            ) : rows.length < total ? (
              <div className="px-3 py-2 text-center text-[11px] text-muted-foreground">
                아래로 스크롤하면 더 불러옵니다
              </div>
            ) : null
          ) : null}
        </div>
        <div className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          {rows.length < total
            ? `${rows.length.toLocaleString()} / ${total.toLocaleString()}건`
            : `${total.toLocaleString()}건`}
        </div>
      </div>
    </div>
  )
}
