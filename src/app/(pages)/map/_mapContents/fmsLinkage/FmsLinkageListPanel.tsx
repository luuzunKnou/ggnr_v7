'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from 'lucide-react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useMapContext } from '../../_mapComponents/MapContext'
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../_mapComponents/config/mapDefaults'
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation'
import {
  defaultFmsListSystemFilter,
  FMS_EMPTY_LIST_MESSAGE,
  FMS_LIST_COLUMNS,
  FMS_LIST_SYSTEM_FILTERS,
  FMS_LIST_TITLE,
  type FmsListSystemFilter,
} from './fmsLinkageBinding'

type ListRow = {
  id: string
  facilNo: string
  facilNm: string
  facilKind: string
  facilOwner: string
  addrFull: string
}

type SortKey = 'facilKind' | 'facilNm' | 'facilOwner' | 'addrFull'
type SortDir = 'asc' | 'desc'
type SortSpec = { key: SortKey; dir: SortDir }

const SORTABLE_KEYS = new Set<string>(['facilKind', 'facilNm', 'facilOwner', 'addrFull'])

/** 패널 기본 440px — 시설명·주소 비중 확대, 종류·소유자는 truncate */
const FMS_LIST_COL_PERCENT = [16, 28, 20, 36] as const

type Props = {
  onClose: () => void
  selectedDetailId: string | null
  onSelectDetailId: (id: string) => void
  onGeomToast?: (message: string | null) => void
}

function compareText(a: string, b: string): number {
  return String(a ?? '').localeCompare(String(b ?? ''), 'ko', { sensitivity: 'base' })
}

function compareRows(a: ListRow, b: ListRow, key: SortKey): number {
  if (key === 'facilKind') return compareText(a.facilKind, b.facilKind)
  if (key === 'facilOwner') return compareText(a.facilOwner, b.facilOwner)
  if (key === 'addrFull') return compareText(a.addrFull, b.addrFull)
  return compareText(a.facilNm, b.facilNm)
}

function isSortKey(key: string): key is SortKey {
  return SORTABLE_KEYS.has(key)
}

export function FmsLinkageListPanel({
  onClose,
  selectedDetailId,
  onSelectDetailId,
  onGeomToast,
}: Props) {
  const searchParams = useSearchParams()
  const system = String(searchParams.get('system') ?? '').trim()
  const mapContext = useMapContext()
  const setOverlayRows = mapContext?.setFmsLinkageOverlayRows
  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [systemFilter, setSystemFilter] = useState<FmsListSystemFilter>(() =>
    defaultFmsListSystemFilter(system)
  )
  const [rows, setRows] = useState<ListRow[]>([])
  const [sorts, setSorts] = useState<SortSpec[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const displayRows = useMemo(() => {
    if (sorts.length === 0) return rows
    return [...rows].sort((a, b) => {
      for (const spec of sorts) {
        const cmp = compareRows(a, b, spec.key)
        if (cmp !== 0) return spec.dir === 'asc' ? cmp : -cmp
      }
      return 0
    })
  }, [rows, sorts])

  const toggleSort = (key: SortKey) => {
    setSorts((prev) => {
      const idx = prev.findIndex((s) => s.key === key)
      if (idx < 0) return [...prev, { key, dir: 'asc' }]
      const cur = prev[idx]
      if (cur.dir === 'asc') {
        const next = [...prev]
        next[idx] = { key, dir: 'desc' }
        return next
      }
      return prev.filter((_, i) => i !== idx)
    })
  }

  const fitMapToFacilNo = useCallback(
    async (facilNo: string) => {
      const key = String(facilNo ?? '').trim()
      if (!key) return
      const map = mapContext?.mapInstanceRef?.current
      if (!map) return
      try {
        const res = await call('', 'POST', {
          service: 'fmsLinkageService',
          action: 'getFmsFacilityExtent3857ByFacilNo',
          params: { facilNo: key, system: systemFilter || undefined },
        })
        const data = res?.data ?? res
        const ext = data?.extent3857 as unknown
        if (!Array.isArray(ext) || ext.length !== 4) {
          onGeomToast?.('도형을 찾을 수 없습니다.')
          return
        }
        if (!ext.every((v) => Number.isFinite(Number(v)))) {
          onGeomToast?.('도형을 찾을 수 없습니다.')
          return
        }
        onGeomToast?.(null)
        window.setTimeout(() => {
          scheduleFitMapToExtent3857(map, ext.map(Number), {
            maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
            applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
          })
        }, 80)
      } catch {
        onGeomToast?.('도형을 찾을 수 없습니다.')
      }
    },
    [mapContext, systemFilter, onGeomToast]
  )

  const handleRowSelect = useCallback(
    (id: string) => {
      if (!id) return
      onSelectDetailId(id)
      void fitMapToFacilNo(id)
    },
    [onSelectDetailId, fitMapToFacilNo]
  )

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedKeyword(keyword.trim()), 300)
    return () => window.clearTimeout(t)
  }, [keyword])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void call('', 'POST', {
      service: 'fmsLinkageService',
      action: 'getFmsFacilityList',
      params: { keyword: debouncedKeyword, system: systemFilter || undefined },
    })
      .then((res) => {
        if (cancelled) return
        const data = (res?.data ?? res) as { rows?: ListRow[]; error?: string }
        if (data?.error) setError(data.error)
        setRows(Array.isArray(data?.rows) ? data.rows : [])
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setRows([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedKeyword, systemFilter])

  useEffect(() => {
    let cancelled = false
    void call('', 'POST', {
      service: 'fmsLinkageService',
      action: 'getFmsFacilityGeomOverlayList',
      params: { keyword: debouncedKeyword, system: systemFilter || undefined },
    })
      .then((res) => {
        if (cancelled) return
        const data = (res?.data ?? res) as {
          rows?: { facilNo?: string; geom?: unknown }[]
        }
        const next =
          Array.isArray(data?.rows)
            ? data.rows.flatMap((r) => {
                const facilNo = String(r?.facilNo ?? '').trim()
                let geom = r?.geom
                if (typeof geom === 'string') {
                  try {
                    geom = JSON.parse(geom) as Record<string, unknown>
                  } catch {
                    return []
                  }
                }
                if (!facilNo || !geom || typeof geom !== 'object') return []
                return [{ facilNo, geom: geom as Record<string, unknown> }]
              })
            : []
        setOverlayRows?.(next)
      })
      .catch(() => {
        if (!cancelled) setOverlayRows?.([])
      })
    return () => {
      cancelled = true
    }
  }, [debouncedKeyword, systemFilter, setOverlayRows])

  useEffect(() => {
    return () => {
      setOverlayRows?.([])
    }
  }, [setOverlayRows])

  useEffect(() => {
    setSystemFilter(defaultFmsListSystemFilter(system))
  }, [system])

  useEffect(() => {
    if (loading) return
    if (!selectedDetailId) return
    if (rows.some((r) => r.id === selectedDetailId)) return
    onSelectDetailId('')
  }, [loading, rows, selectedDetailId, onSelectDetailId])

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title">{FMS_LIST_TITLE}</span>
        <button
          type="button"
          onClick={onClose}
          className="standard-panel-close"
          title="닫기"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="standard-filter-section">
        <div className="standard-search-wrap">
          <Search className="standard-search-icon" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="시설명, 번호, 소유자, 주소 검색"
            className="standard-search-input"
          />
        </div>
        <div className="standard-filter-chips" role="group" aria-label="시스템 필터">
          {FMS_LIST_SYSTEM_FILTERS.map((opt) => {
            const active = systemFilter === opt.value
            return (
              <button
                key={opt.value || '__all__'}
                type="button"
                onClick={() => setSystemFilter(opt.value)}
                aria-pressed={active}
                className={cn('standard-filter-chip', active && 'standard-filter-chip-active')}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="standard-list-body">
        {error && (
          <div className="shrink-0 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <div className="standard-list-scroll">
          <table className="standard-list-table min-w-0 w-full table-fixed">
          <colgroup>
            {FMS_LIST_COL_PERCENT.map((pct, i) => (
              <col key={i} style={{ width: `${pct}%` }} />
            ))}
          </colgroup>
          <thead className="standard-table-thead">
            <tr>
              {FMS_LIST_COLUMNS.map((col) => {
                if (!isSortKey(col.key)) {
                  return (
                    <th key={col.key} className="standard-table-th standard-table-th-left">
                      <span className="block truncate">{col.label}</span>
                    </th>
                  )
                }
                const sortKey = col.key
                const sortIdx = sorts.findIndex((s) => s.key === sortKey)
                const active = sortIdx >= 0
                const sortDir = active ? sorts[sortIdx]!.dir : null
                const SortIcon =
                  !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown
                return (
                  <th key={sortKey} className="standard-table-th standard-table-th-left">
                    <button
                      type="button"
                      onClick={() => toggleSort(sortKey)}
                      className={cn(
                        'standard-sort-button standard-sort-button-left',
                        active && 'standard-sort-button-active'
                      )}
                      title={
                        !active
                          ? `${col.label} 정렬 추가`
                          : sortDir === 'asc'
                            ? `${col.label} 내림차순으로 변경`
                            : `${col.label} 정렬 해제`
                      }
                    >
                      <span className="truncate">{col.label}</span>
                      <SortIcon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                      {active && sorts.length > 1 ? (
                        <span className="tabular-nums text-[10px] opacity-70">{sortIdx + 1}</span>
                      ) : null}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={FMS_LIST_COLUMNS.length} className="standard-table-empty">
                  불러오는 중…
                </td>
              </tr>
            ) : displayRows.length === 0 ? (
              <tr>
                <td colSpan={FMS_LIST_COLUMNS.length} className="standard-table-empty">
                  {error ? '데이터를 표시할 수 없습니다.' : FMS_EMPTY_LIST_MESSAGE}
                </td>
              </tr>
            ) : (
              displayRows.map((row) => {
                const isSelected = selectedDetailId === row.id
                return (
                  <tr
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleRowSelect(row.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleRowSelect(row.id)
                      }
                    }}
                    className={cn('standard-list-row', isSelected && 'standard-list-row-selected')}
                  >
                    <td className="standard-table-td-text" title={row.facilKind}>
                      {row.facilKind || '—'}
                    </td>
                    <td className="standard-table-td-text font-medium" title={row.facilNm}>
                      {row.facilNm || '—'}
                    </td>
                    <td className="standard-table-td-text-muted" title={row.facilOwner}>
                      {row.facilOwner || '—'}
                    </td>
                    <td className="standard-table-td-text-muted" title={row.addrFull}>
                      {row.addrFull || '—'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
        </div>
        <div className="standard-list-footer">
          {displayRows.length.toLocaleString()}건
        </div>
      </div>
    </div>
  )
}
