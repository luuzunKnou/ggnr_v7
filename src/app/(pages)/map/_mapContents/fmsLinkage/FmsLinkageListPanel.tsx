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

type SortKey = 'facilNo' | 'facilKind' | 'facilNm' | 'facilOwner'
type SortDir = 'asc' | 'desc'
type SortSpec = { key: SortKey; dir: SortDir }

const SORTABLE_KEYS = new Set<string>(['facilNo', 'facilKind', 'facilNm', 'facilOwner'])

type Props = {
  onClose: () => void
  selectedDetailId: string | null
  onSelectDetailId: (id: string) => void
  onGeomToast?: (message: string | null) => void
}

/** 서버 기본 정렬과 동일 — 번호 속 연도(4자리) → 접두 영문 제거 후 나머지 */
function compareFacilNo(a: string, b: string): number {
  const yearOf = (v: string) => {
    const m = String(v ?? '').match(/[0-9]{4}/)
    return m ? Number(m[0]) : Number.POSITIVE_INFINITY
  }
  const restOf = (v: string) => String(v ?? '').replace(/^[A-Za-z]+/, '')
  const ya = yearOf(a)
  const yb = yearOf(b)
  if (ya !== yb) return ya - yb
  return restOf(a).localeCompare(restOf(b), 'ko')
}

function compareText(a: string, b: string): number {
  return String(a ?? '').localeCompare(String(b ?? ''), 'ko', { sensitivity: 'base' })
}

function compareRows(a: ListRow, b: ListRow, key: SortKey): number {
  if (key === 'facilNo') return compareFacilNo(a.facilNo, b.facilNo)
  if (key === 'facilKind') return compareText(a.facilKind, b.facilKind)
  if (key === 'facilOwner') return compareText(a.facilOwner, b.facilOwner)
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
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-sm font-semibold text-foreground">{FMS_LIST_TITLE}</span>
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

      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="시설명, 번호, 소유자, 주소 검색"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-border focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div
            className="flex min-w-0 flex-wrap items-center gap-1"
            role="group"
            aria-label="시스템 필터"
          >
            {FMS_LIST_SYSTEM_FILTERS.map((opt) => {
              const active = systemFilter === opt.value
              return (
                <button
                  key={opt.value || '__all__'}
                  type="button"
                  onClick={() => setSystemFilter(opt.value)}
                  aria-pressed={active}
                  className={cn(
                    'rounded border px-2 py-1 text-[11px] font-medium transition-colors',
                    active
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-background text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground'
                  )}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
          <p className="shrink-0 text-xs text-muted-foreground">
            총 {rows.length.toLocaleString()}건
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        {error && (
          <div className="shrink-0 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <table className="w-full table-fixed border-collapse text-left text-xs">
          <colgroup>
            <col className="w-[100px]" />
            <col className="w-[100px]" />
            <col className="w-[90px]" />
            <col className="w-[90px]" />
          </colgroup>
          <thead className="sticky top-0 z-[1] bg-muted/50">
            <tr>
              {FMS_LIST_COLUMNS.map((col) => {
                if (!isSortKey(col.key)) {
                  return (
                    <th
                      key={col.key}
                      className="whitespace-nowrap border-b-0 px-1.5 py-1.5 text-center font-semibold text-foreground/90 [box-shadow:inset_0_-2px_0_0_var(--border)]"
                    >
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
                  <th
                    key={sortKey}
                    className="whitespace-nowrap border-b-0 px-1.5 py-1.5 text-center font-semibold text-foreground/90 [box-shadow:inset_0_-2px_0_0_var(--border)]"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(sortKey)}
                      className={cn(
                        'inline-flex max-w-full items-center justify-center gap-0.5 rounded px-0.5 py-0.5 transition-colors hover:bg-muted',
                        active ? 'text-primary' : 'text-foreground/90'
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
                <td colSpan={FMS_LIST_COLUMNS.length} className="px-3 py-8 text-center text-muted-foreground">
                  불러오는 중…
                </td>
              </tr>
            ) : displayRows.length === 0 ? (
              <tr>
                <td colSpan={FMS_LIST_COLUMNS.length} className="px-3 py-8 text-center text-muted-foreground">
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
                    className={cn(
                      'cursor-pointer border-b border-border transition-colors',
                      isSelected ? 'bg-primary/10 dark:bg-primary/25' : 'hover:bg-muted/50'
                    )}
                  >
                    <td className="truncate px-2 py-2 tabular-nums text-foreground" title={row.facilNo}>
                      {row.facilNo || '—'}
                    </td>
                    <td className="truncate px-2 py-2 text-foreground" title={row.facilKind}>
                      {row.facilKind || '—'}
                    </td>
                    <td className="truncate px-2 py-2 font-medium text-foreground" title={row.facilNm}>
                      {row.facilNm || '—'}
                    </td>
                    <td className="truncate px-2 py-2 text-foreground" title={row.facilOwner}>
                      {row.facilOwner || '—'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
