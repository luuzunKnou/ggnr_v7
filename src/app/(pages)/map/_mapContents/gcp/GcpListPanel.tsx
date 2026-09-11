'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ClipboardList, Plus, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LAYER_ROW_NEW_ID, LayerRowPanelButton } from '../../_mapComponents/layerRowEdit'
import { GCP_MAP_COLORS, GCP_STATUS_FILTERS, type GcpStatusFilter } from './gcpConfig'
import { displayStatusOf, statusBadgeClass, type GcpPoint } from './gcpDummyData'
import { clearGcpCreate, setGcpCreateGeom, startGcpCreate } from './gcpProtoStore'
import { useGcpMapLayer } from './useGcpMapLayer'
import { useGcpProtoState } from './useGcpProtoState'

type Props = {
  onClose: () => void
  selectedDetailId: string | null
  onSelectDetailId: (id: string | null) => void
  onInspect: (ids: string[]) => void
}

type SortKey = 'status' | 'gcpnum' | 'lastInspect'
type SortDir = 'asc' | 'desc'
type SortSpec = { key: SortKey; dir: SortDir }

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'status', label: '상태' },
  { key: 'gcpnum', label: '번호' },
  { key: 'lastInspect', label: '최근 점검' },
]

const STATUS_RANK: Record<string, number> = {
  비정상: 0,
  점검필요: 1,
  정상: 2,
}

function initialSortDir(_key: SortKey): SortDir {
  return 'asc'
}

function cmpNum(a: string, b: string) {
  return a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' })
}

function cmpInspectDate(a: string, b: string) {
  const left = a || '0000-00-00'
  const right = b || '0000-00-00'
  return left.localeCompare(right)
}

function comparePoints(a: GcpPoint, b: GcpPoint, spec: SortSpec) {
  let diff = 0
  if (spec.key === 'status') {
    diff = (STATUS_RANK[displayStatusOf(a)] ?? 9) - (STATUS_RANK[displayStatusOf(b)] ?? 9)
  } else if (spec.key === 'gcpnum') {
    diff = cmpNum(a.gcpnum, b.gcpnum)
  } else {
    diff = cmpInspectDate(a.lastInspectDate, b.lastInspectDate)
  }
  return spec.dir === 'asc' ? diff : -diff
}

export function GcpListPanel({
  onClose,
  selectedDetailId,
  onSelectDetailId,
  onInspect,
}: Props) {
  const { points, createDraft } = useGcpProtoState()
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<GcpStatusFilter>('전체')
  const [checked, setChecked] = useState<string[]>([])
  const [sorts, setSorts] = useState<SortSpec[]>([{ key: 'lastInspect', dir: 'asc' }])
  const isCreateOpen = selectedDetailId === LAYER_ROW_NEW_ID

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
      const shown = displayStatusOf(p)
      if (statusFilter !== '전체' && shown !== statusFilter) return false
      if (!q) return true
      return (
        p.gcpnum.toLowerCase().includes(q) ||
        p.placeNote.toLowerCase().includes(q) ||
        p.address.toLowerCase().includes(q) ||
        shown.includes(keyword.trim())
      )
    })
    const specs = sorts.length ? sorts : [{ key: 'lastInspect' as const, dir: 'asc' as const }]
    return [...rows].sort((a, b) => {
      for (const spec of specs) {
        const diff = comparePoints(a, b, spec)
        if (diff !== 0) return diff
      }
      return cmpNum(a.gcpnum, b.gcpnum)
    })
  }, [points, keyword, statusFilter, sorts])

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

  const toggleCheck = (id: string) => {
    setChecked((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]))
  }

  const allFilteredChecked = filtered.length > 0 && filtered.every((p) => checked.includes(p.id))

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-sm font-semibold text-foreground">지상기준점</span>
        <div className="flex items-center gap-1">
          <LayerRowPanelButton
            type="button"
            disabled={checked.length === 0}
            onClick={() => {
              clearGcpCreate()
              onInspect(checked)
            }}
          >
            <ClipboardList className="h-3 w-3 shrink-0" aria-hidden />
            점검 추가
          </LayerRowPanelButton>
          <LayerRowPanelButton
            type="button"
            disabled={isCreateOpen}
            onClick={() => {
              startGcpCreate()
              onSelectDetailId(LAYER_ROW_NEW_ID)
            }}
          >
            <Plus className="h-3 w-3 shrink-0" aria-hidden />
            기준점 추가
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
              placeholder="번호, 주소, 상태"
              className="h-8 w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none ring-offset-2 focus:border-border focus:ring-2 focus:ring-border"
            />
          </div>
          <div
            className="flex shrink-0 rounded-md border border-border bg-muted/50 p-0.5"
            role="group"
            aria-label="상태 필터"
          >
            {GCP_STATUS_FILTERS.map((filter) => {
              const active = statusFilter === filter
              return (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setStatusFilter(filter)}
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
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={allFilteredChecked}
              onChange={() => {
                if (allFilteredChecked) {
                  setChecked((prev) => prev.filter((id) => !filtered.some((p) => p.id === id)))
                } else {
                  setChecked((prev) => [...new Set([...prev, ...filtered.map((p) => p.id)])])
                }
              }}
            />
            전체 선택
          </label>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1">
              <i className="inline-block h-2 w-2 rounded-full" style={{ background: GCP_MAP_COLORS.ok }} />
              정상
            </span>
            <span className="inline-flex items-center gap-1">
              <i className="inline-block h-2 w-2 rounded-full" style={{ background: GCP_MAP_COLORS.warn }} />
              점검필요
            </span>
            <span className="inline-flex items-center gap-1">
              <i className="inline-block h-2 w-2 rounded-full" style={{ background: GCP_MAP_COLORS.bad }} />
              비정상
            </span>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
          <table className="w-full table-fixed border-collapse text-left text-xs">
            <colgroup>
              <col className="w-[36px]" />
              <col className="w-[72px]" />
              <col className="w-[56px]" />
              <col />
              <col className="w-[96px]" />
            </colgroup>
            <thead className="sticky top-0 z-[1] bg-muted shadow-[0_1px_0_0_var(--border)]">
              <tr>
                <th className="px-1.5 py-1.5 text-center font-semibold text-foreground/90 [box-shadow:inset_0_-2px_0_0_var(--border)]" />
                {SORT_COLUMNS.slice(0, 2).map((col) => (
                  <GcpSortHeader
                    key={col.key}
                    col={col}
                    sorts={sorts}
                    onToggle={() => toggleSort(col.key)}
                  />
                ))}
                <th className="whitespace-nowrap px-1.5 py-1.5 text-center font-semibold text-foreground/90 [box-shadow:inset_0_-2px_0_0_var(--border)]">
                  주소
                </th>
                <GcpSortHeader
                  col={SORT_COLUMNS[2]}
                  sorts={sorts}
                  onToggle={() => toggleSort('lastInspect')}
                />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground">
                    표시할 기준점이 없습니다.
                  </td>
                </tr>
              ) : (
                filtered.map((point) => (
                  <GcpListRow
                    key={point.id}
                    point={point}
                    checked={checked.includes(point.id)}
                    selected={selectedDetailId === point.id}
                    onToggleCheck={() => toggleCheck(point.id)}
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
        <div className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          {filtered.length.toLocaleString()}건
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
  checked,
  selected,
  onToggleCheck,
  onSelect,
}: {
  point: GcpPoint
  checked: boolean
  selected: boolean
  onToggleCheck: () => void
  onSelect: () => void
}) {
  const shown = displayStatusOf(point)
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
      <td className="px-1.5 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={onToggleCheck} />
      </td>
      <td className="px-1.5 py-1.5 text-center">
        <span className={cn('inline-block rounded-full px-1.5 py-0.5 text-[11px] font-semibold', statusBadgeClass(shown))}>
          {shown}
        </span>
      </td>
      <td className="truncate px-1.5 py-1.5 text-center tabular-nums text-foreground" title={point.gcpnum}>
        {point.gcpnum}
      </td>
      <td className="truncate px-1.5 py-1.5 text-foreground/90" title={point.address}>
        {point.address}
      </td>
      <td className="truncate px-1 py-1.5 tabular-nums text-foreground/90" title={point.lastInspectDate || '없음'}>
        {point.lastInspectDate || '없음'}
      </td>
    </tr>
  )
}
