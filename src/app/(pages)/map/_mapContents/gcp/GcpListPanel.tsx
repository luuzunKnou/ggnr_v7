'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Plus, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LAYER_ROW_NEW_ID, LayerRowPanelButton } from '../../_mapComponents/layerRowEdit'
import { clearGcpCreate, setGcpCreateGeom, startGcpCreate } from './gcpCreateDraft'
import type { GcpPoint } from './gcpTypes'
import { useGcpMapLayer } from './useGcpMapLayer'
import { useGcpData } from './useGcpData'

type Props = {
  onClose: () => void
  selectedDetailId: string | null
  onSelectDetailId: (id: string | null) => void
  listRefreshKey?: number
}

type SortKey = 'gcpnum' | 'placeNote'
type SortDir = 'asc' | 'desc'
type SortSpec = { key: SortKey; dir: SortDir }

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'gcpnum', label: '번호' },
  { key: 'placeNote', label: '위치설명' },
]

function initialSortDir(_key: SortKey): SortDir {
  return 'asc'
}

function cmpNum(a: string, b: string) {
  return a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' })
}

function comparePoints(a: GcpPoint, b: GcpPoint, spec: SortSpec) {
  let diff = 0
  if (spec.key === 'gcpnum') {
    diff = cmpNum(a.gcpnum, b.gcpnum)
  } else {
    diff = a.placeNote.localeCompare(b.placeNote, 'ko')
  }
  return spec.dir === 'asc' ? diff : -diff
}

export function GcpListPanel({
  onClose,
  selectedDetailId,
  onSelectDetailId,
  listRefreshKey = 0,
}: Props) {
  const { points, loading, error, createDraft, refresh } = useGcpData()
  const [keyword, setKeyword] = useState('')
  const [sorts, setSorts] = useState<SortSpec[]>([{ key: 'gcpnum', dir: 'asc' }])
  const isCreateOpen = selectedDetailId === LAYER_ROW_NEW_ID

  useEffect(() => {
    void refresh()
  }, [listRefreshKey, refresh])

  useGcpMapLayer({
    open: true,
    points,
    selectedId: isCreateOpen ? null : selectedDetailId,
    onSelectId: (id) => {
      clearGcpCreate()
      onSelectDetailId(id)
    },
    placeMode: isCreateOpen,
    placeCoord: createDraft?.geom5181 ?? null,
    onPlace: setGcpCreateGeom,
  })

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    const rows = points.filter((p) => {
      if (!q) return true
      return (
        p.gcpnum.toLowerCase().includes(q) ||
        p.placeNote.toLowerCase().includes(q)
      )
    })
    const specs = sorts.length ? sorts : [{ key: 'gcpnum' as const, dir: 'asc' as const }]
    return [...rows].sort((a, b) => {
      for (const spec of specs) {
        const diff = comparePoints(a, b, spec)
        if (diff !== 0) return diff
      }
      return cmpNum(a.gcpnum, b.gcpnum)
    })
  }, [points, keyword, sorts])

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

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-sm font-semibold text-foreground">GCP</span>
        <div className="flex items-center gap-1">
          <LayerRowPanelButton
            type="button"
            disabled={isCreateOpen}
            onClick={() => {
              startGcpCreate()
              onSelectDetailId(LAYER_ROW_NEW_ID)
            }}
          >
            <Plus className="h-3 w-3 shrink-0" aria-hidden />
            GCP 추가
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

      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="번호, 위치설명"
            className="h-8 w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none ring-offset-2 focus:border-border focus:ring-2 focus:ring-border"
          />
        </div>
        {error ? <p className="mt-1.5 text-[11px] text-destructive">{error}</p> : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          {loading ? '불러오는 중…' : `${filtered.length.toLocaleString()}건`}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
          <table className="w-full table-fixed border-collapse text-left text-xs">
            <colgroup>
              <col className="w-[88px]" />
              <col />
            </colgroup>
            <thead className="sticky top-0 z-[1] bg-muted shadow-[0_1px_0_0_var(--border)]">
              <tr>
                {SORT_COLUMNS.map((col) => (
                  <GcpSortHeader
                    key={col.key}
                    col={col}
                    sorts={sorts}
                    onToggle={() => toggleSort(col.key)}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-3 py-6 text-center text-xs text-muted-foreground">
                    {loading ? '목록을 불러오는 중…' : '표시할 GCP가 없습니다.'}
                  </td>
                </tr>
              ) : (
                filtered.map((point) => (
                  <GcpListRow
                    key={point.id}
                    point={point}
                    selected={selectedDetailId === point.id}
                    onSelect={() => {
                      clearGcpCreate()
                      onSelectDetailId(point.id)
                    }}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function GcpSortHeader({
  col,
  sorts,
  onToggle,
}: {
  col: { key: SortKey; label: string }
  sorts: SortSpec[]
  onToggle: () => void
}) {
  const sortIdx = sorts.findIndex((s) => s.key === col.key)
  const active = sortIdx >= 0
  const sortDir = active ? sorts[sortIdx].dir : null
  const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown
  const initial = initialSortDir(col.key)
  return (
    <th className="whitespace-nowrap border-b-0 px-1.5 py-1.5 text-center font-semibold text-foreground/90 [box-shadow:inset_0_-2px_0_0_var(--border)]">
      <button
        type="button"
        onClick={onToggle}
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
}

function GcpListRow({
  point,
  selected,
  onSelect,
}: {
  point: GcpPoint
  selected: boolean
  onSelect: () => void
}) {
  return (
    <tr
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        'cursor-pointer border-b border-border transition-colors hover:bg-muted/50',
        selected && 'bg-primary/10'
      )}
    >
      <td className="truncate px-1.5 py-1.5 text-center tabular-nums text-foreground" title={point.gcpnum}>
        {point.gcpnum}
      </td>
      <td className="truncate px-1.5 py-1.5 text-foreground/90" title={point.placeNote || '—'}>
        {point.placeNote || '—'}
      </td>
    </tr>
  )
}
