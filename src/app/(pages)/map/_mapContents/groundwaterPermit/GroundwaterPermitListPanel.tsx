'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from 'lucide-react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  groundwaterPermitStatusClass,
  type GroundwaterPermitStatusCode,
} from '@/lib/groundwaterPermitStatus'
import { useMapContext } from '../../_mapComponents/MapContext'
import { useGroundwaterPermitMapHighlight } from './useGroundwaterPermitMapHighlight'
import { GROUNDWATER_PERMIT_WMS_LAYER_ID } from './groundwaterPermitLayerId'
import {
  initialGroundwaterPermitSortDir,
  sortGroundwaterPermitListRows,
  type GroundwaterPermitListSortKey,
  type GroundwaterPermitListSortSpec,
} from './groundwaterPermitListSort'

type ListRow = {
  id: string
  nameOrTrade: string
  developLocation: string
  permitStartDate: string
  permitEndDate: string
  statusCode: GroundwaterPermitStatusCode
  statusLabel: string
}

type SortDir = GroundwaterPermitListSortSpec['dir']

const SORT_COLUMNS: {
  key: GroundwaterPermitListSortKey
  label: string
  align?: 'left' | 'center'
}[] = [
  { key: 'nameOrTrade', label: '상호또는성명' },
  { key: 'developLocation', label: '개발위치' },
  { key: 'permitStartDate', label: '허가유효시작일' },
  { key: 'permitEndDate', label: '허가유효종료일' },
  { key: 'statusLabel', label: '상태', align: 'center' },
]

type Props = {
  onClose: () => void
  selectedDetailId: string | null
  onSelectDetailId: (id: string) => void
}

export function GroundwaterPermitListPanel({
  onClose,
  selectedDetailId,
  onSelectDetailId,
}: Props) {
  const mapContext = useMapContext()
  const setVisibleLayerNames = mapContext?.setVisibleLayerNames

  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [sorts, setSorts] = useState<GroundwaterPermitListSortSpec[]>([])
  const [rows, setRows] = useState<ListRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { clearHighlight } = useGroundwaterPermitMapHighlight()

  /** 패널이 열려 있으면 지하수 개발허가 레이어를 항상 켠다. 닫을 때 끄지 않는다. */
  useEffect(() => {
    if (!setVisibleLayerNames) return
    const lid = GROUNDWATER_PERMIT_WMS_LAYER_ID.toLowerCase()
    setVisibleLayerNames((prev) => {
      for (const n of prev) {
        if (n.toLowerCase() === lid) return prev
      }
      return new Set(prev).add(lid)
    })
  }, [setVisibleLayerNames])

  const handleClose = useCallback(() => {
    clearHighlight()
    onClose()
  }, [clearHighlight, onClose])

  const handleRowSelect = useCallback(
    (id: string) => {
      onSelectDetailId(id)
    },
    [onSelectDetailId]
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
      service: 'groundwaterPermitService',
      action: 'getGroundwaterPermitList',
      params: { keyword: debouncedKeyword },
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
  }, [debouncedKeyword])

  const sortedRows = useMemo(
    () => sortGroundwaterPermitListRows(rows, sorts),
    [rows, sorts]
  )

  const toggleSort = (key: GroundwaterPermitListSortKey) => {
    const initial = initialGroundwaterPermitSortDir(key)
    setSorts((prev) => {
      const idx = prev.findIndex((s) => s.key === key)
      if (idx < 0) return [...prev, { key, dir: initial }]
      const cur = prev[idx]
      if (cur.dir === initial) {
        const next = [...prev]
        next[idx] = { key, dir: initial === 'asc' ? 'desc' : 'asc' }
        return next
      }
      return prev.filter((s) => s.key !== key)
    })
  }

  return (
    <div className="standard-panel-root">
      <div className="standard-panel-header">
        <span className="standard-panel-title">지하수 개발허가</span>
        <button
          type="button"
          onClick={handleClose}
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
            placeholder="검색 (상호, 위치, 상태…)"
            className="standard-search-input"
          />
        </div>
      </div>

      <div className="standard-list-body">
        {error ? (
          <div className="shrink-0 border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}
        <div className="standard-list-scroll">
          <table className="standard-list-table min-w-[640px]">
            <thead className="standard-table-thead">
              <tr>
                {SORT_COLUMNS.map((col) => {
                  const sortIdx = sorts.findIndex((s) => s.key === col.key)
                  const active = sortIdx >= 0
                  const sortDir: SortDir | null = active ? sorts[sortIdx].dir : null
                  const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown
                  const initial = initialGroundwaterPermitSortDir(col.key)
                  const alignRight = col.align === 'center'
                  return (
                    <th
                      key={col.key}
                      className={cn(
                        'standard-table-th',
                        alignRight ? 'standard-table-th-center' : 'standard-table-th-left'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          'standard-sort-button',
                          alignRight ? 'standard-sort-button-center' : 'standard-sort-button-left',
                          active && 'standard-sort-button-active'
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
              {loading && sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="standard-table-empty">
                    불러오는 중…
                  </td>
                </tr>
              ) : sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="standard-table-empty">
                    {error ? '데이터를 표시할 수 없습니다.' : '조회된 항목이 없습니다.'}
                  </td>
                </tr>
              ) : (
                sortedRows.map((row) => {
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
                        'standard-list-row',
                        isSelected && 'standard-list-row-selected'
                      )}
                    >
                      <td className="standard-table-td-text font-medium">{row.nameOrTrade || '—'}</td>
                      <td className="standard-table-td-text max-w-[220px] truncate" title={row.developLocation}>
                        {row.developLocation || '—'}
                      </td>
                      <td className="standard-table-td-date">{row.permitStartDate || '—'}</td>
                      <td className="standard-table-td-date">{row.permitEndDate || '—'}</td>
                      <td className="standard-table-td-compact text-center">
                        <span
                          className={cn(
                            'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
                            groundwaterPermitStatusClass(row.statusCode)
                          )}
                        >
                          {row.statusLabel}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="standard-list-footer">{sortedRows.length.toLocaleString()}건</div>
      </div>
    </div>
  )
}
