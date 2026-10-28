'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMapContext } from '../../_mapComponents/MapContext'
import { scheduleAnimateMapToCenter3857 } from '../../_mapComponents/config/mapAutoNavigation'
import { MAP_LOCAL_VIEW_MIN_ZOOM } from '../../_mapComponents/config/mapDefaults'
import {
  formatParcelDocSummary,
  formatRecordAddress,
  getCadastralParcels,
  type CadastralRecordParcel,
} from './cadastralRecordMock'

type SortKey = 'address' | 'docs'
type SortSpec = { key: SortKey; dir: 'asc' | 'desc' }

const ALL = ''

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: 'address', label: '소재지', className: 'w-[58%]' },
  { key: 'docs', label: '문서', className: 'w-[42%]' },
]

function compareRow(a: CadastralRecordParcel, b: CadastralRecordParcel, key: SortKey): number {
  switch (key) {
    case 'address':
      return formatRecordAddress(a).localeCompare(formatRecordAddress(b), 'ko')
    case 'docs':
      return a.docs.length - b.docs.length
  }
}

type Props = {
  onClose: () => void
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function CadastralRecordListPanel({ onClose, selectedId, onSelect }: Props) {
  const all = useMemo(() => getCadastralParcels(), [])
  const mapContext = useMapContext()
  const [emd, setEmd] = useState(ALL)
  const [keyword, setKeyword] = useState('')
  const [sort, setSort] = useState<SortSpec>({ key: 'address', dir: 'asc' })

  const emdOptions = useMemo(
    () => [...new Set(all.map((d) => d.emd))].sort((a, b) => a.localeCompare(b, 'ko')),
    [all]
  )

  const filtered = useMemo(() => {
    const kw = keyword.trim()
    const rows = all.filter((d) => {
      if (emd && d.emd !== emd) return false
      if (kw && !d.jibun.replace(/\s+/g, '').includes(kw.replace(/\s+/g, ''))) return false
      return true
    })
    const sign = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => sign * compareRow(a, b, sort.key))
  }, [all, emd, keyword, sort])

  useEffect(() => {
    if (selectedId && !filtered.some((d) => d.id === selectedId)) onSelect(null)
  }, [filtered, selectedId, onSelect])

  const flyToParcel = useCallback(
    (id: string) => {
      const parcel = all.find((p) => p.id === id)
      const map = mapContext?.mapInstanceRef?.current
      if (!parcel || !map) return
      const current = map.getView().getZoom()
      const zoom = Math.max(
        Number.isFinite(current) ? (current as number) : 0,
        MAP_LOCAL_VIEW_MIN_ZOOM
      )
      scheduleAnimateMapToCenter3857(map, parcel.center3857, zoom, {
        applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
      })
    },
    [all, mapContext?.applyMapViewPaddingRef, mapContext?.mapInstanceRef]
  )

  const handleRowSelect = useCallback(
    (id: string) => {
      onSelect(id)
      flyToParcel(id)
    },
    [onSelect, flyToParcel]
  )

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    )
  }

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title">지적기록물</span>
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
        <div className="flex items-center gap-1.5">
          <select
            className="standard-filter-select max-w-none w-[8.5rem] shrink-0"
            value={emd}
            onChange={(e) => setEmd(e.target.value)}
            aria-label="읍면동"
          >
            <option value={ALL}>전체 읍면동</option>
            {emdOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <div className="standard-search-wrap min-w-0 flex-1">
            <Search className="standard-search-icon" />
            <input
              type="search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="지번"
              className="standard-search-input"
            />
          </div>
        </div>
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
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="standard-table-empty">
                    조회된 필지가 없습니다.
                  </td>
                </tr>
              ) : (
                filtered.map((d) => {
                  const isSelected = selectedId === d.id
                  const address = formatRecordAddress(d)
                  const docLabel = formatParcelDocSummary(d.docs)
                  return (
                    <tr
                      key={d.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleRowSelect(d.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleRowSelect(d.id)
                        }
                      }}
                      className={cn('standard-list-row', isSelected && 'standard-list-row-selected')}
                    >
                      <td className="standard-table-td-text font-medium" title={address}>
                        {address}
                      </td>
                      <td className="standard-table-td-text-muted" title={docLabel}>
                        {docLabel}
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
