'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  CADASTRAL_CONTROL_POINT_TYPES,
  getCadastralControlPointType,
  type CadastralControlPointType,
} from './cadastralControlPointConfig'
import type { CadastralControlPoint } from './cadastralControlPointTypes'
import { useCadastralControlPointData } from './useCadastralControlPointData'
import { useCadastralControlPointLayer } from './useCadastralControlPointLayer'

type SortKey = 'type' | 'name' | 'address'
type SortSpec = { key: SortKey; dir: 'asc' | 'desc' }

const ALL = '' as const

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: 'type', label: '종류', className: 'w-[22%]' },
  { key: 'name', label: '기준점명', className: 'w-[28%]' },
  { key: 'address', label: '주소', className: 'w-[50%]' },
]

function comparePoint(a: CadastralControlPoint, b: CadastralControlPoint, key: SortKey): number {
  switch (key) {
    case 'type':
      return a.typeLabel.localeCompare(b.typeLabel, 'ko')
    case 'name':
      return a.name.localeCompare(b.name, 'ko', { numeric: true })
    case 'address':
      return a.address.localeCompare(b.address, 'ko')
  }
}

type Props = {
  onClose: () => void
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function CadastralControlPointListPanel({ onClose, selectedId, onSelect }: Props) {
  const { points: all, loading, error } = useCadastralControlPointData()
  const [typeFilter, setTypeFilter] = useState<CadastralControlPointType | typeof ALL>(ALL)
  const [keyword, setKeyword] = useState('')
  const [sort, setSort] = useState<SortSpec>({ key: 'name', dir: 'asc' })

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const rows = all.filter((p) => {
      if (typeFilter && p.type !== typeFilter) return false
      if (
        kw &&
        !`${p.name} ${p.typeLabel} ${p.emd} ${p.address} ${p.landLoc} ${p.pointNo}`
          .toLowerCase()
          .includes(kw)
      ) {
        return false
      }
      return true
    })
    const sign = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => sign * comparePoint(a, b, sort.key))
  }, [all, typeFilter, keyword, sort])

  const { fitToPoint } = useCadastralControlPointLayer({
    typeFilter,
    selectedId,
    onSelect: (id) => onSelect(id),
  })

  useEffect(() => {
    if (selectedId && !filtered.some((p) => p.id === selectedId)) onSelect(null)
  }, [filtered, selectedId, onSelect])

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    )
  }

  const handleRowSelect = useCallback(
    (id: string) => {
      onSelect(id)
      fitToPoint(id)
    },
    [onSelect, fitToPoint]
  )

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title">지적기준점</span>
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
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setTypeFilter(ALL)}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              typeFilter === ALL
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            전체
          </button>
          {CADASTRAL_CONTROL_POINT_TYPES.map((t) => (
            <button
              key={t.code}
              type="button"
              onClick={() => setTypeFilter(t.code)}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                typeFilter === t.code
                  ? 'text-white'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}
              style={
                typeFilter === t.code
                  ? { backgroundColor: t.color }
                  : undefined
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="standard-search-wrap">
          <Search className="standard-search-icon" />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="검색 (기준점명, 주소)"
            className="standard-search-input"
          />
        </div>
        {error ? (
          <p className="px-0.5 text-[11px] text-destructive">{error}</p>
        ) : loading ? (
          <p className="px-0.5 text-[11px] text-muted-foreground">불러오는 중…</p>
        ) : (
          <p className="px-0.5 text-[11px] text-muted-foreground">
            전체 {all.length.toLocaleString()}건
          </p>
        )}
      </div>

      <div className="standard-list-body">
        <div className="standard-list-scroll">
          <table className="standard-list-table">
            <thead className="standard-table-thead">
              <tr>
                {COLUMNS.map((col) => {
                  const active = sort.key === col.key
                  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
                  return (
                    <th
                      key={col.key}
                      className={cn('standard-table-th standard-table-th-left', col.className)}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          'standard-sort-button standard-sort-button-left',
                          active && 'standard-sort-button-active'
                        )}
                        title={`${col.label} 정렬`}
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
              {loading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="standard-table-empty">
                    불러오는 중…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="standard-table-empty">
                    조회된 기준점이 없습니다.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => {
                  const t = getCadastralControlPointType(p.type)
                  const isSelected = selectedId === p.id
                  return (
                    <tr
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleRowSelect(p.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleRowSelect(p.id)
                        }
                      }}
                      className={cn('standard-list-row', isSelected && 'standard-list-row-selected')}
                    >
                      <td className="standard-table-td-compact">
                        <span
                          className="standard-status-badge max-w-full truncate"
                          style={{
                            backgroundColor: `${t.color}33`,
                            color: t.color,
                            boxShadow: `inset 0 0 0 1px ${t.color}80`,
                          }}
                          title={t.label}
                        >
                          {t.label}
                        </span>
                      </td>
                      <td className="standard-table-td-text font-medium" title={p.name}>
                        {p.name || '—'}
                      </td>
                      <td className="standard-table-td-text-muted" title={p.address}>
                        {p.address || '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="standard-list-footer">
          <span>{filtered.length.toLocaleString()}건</span>
        </div>
      </div>
    </div>
  )
}
