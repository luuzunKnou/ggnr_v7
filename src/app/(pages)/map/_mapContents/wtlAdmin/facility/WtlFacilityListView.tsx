'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { formatDefineFieldDisplayValue } from '@/lib/defineLayerCodeDisplay'
import { cn } from '@/lib/utils'
import {
  getDefineFieldDisplayLabel,
  getRowValueByField,
  selectDefineLayerListFields,
  type DefineFieldLike,
} from '../../../_mapComponents/standard/defineLayerRowUtils'
import {
  loadWtlDefineDisplayBundle,
  peekWtlDefineDisplayBundle,
  type WtlDefineDisplayBundle,
} from '../networkMap/wtlNetworkDefineDisplayCache'
import { WtlFacilityTableLoadingRow } from './WtlFacilityTableLoadingRow'

export type WtlFacilityListRow = {
  id: string
  ogcFid: number | null
  name: string
  record: Record<string, unknown>
  geom: unknown | null
  tableName: string
  fieldsTable: string
  fieldsTableFallback: string | null
  relatedParentKey: string
  layerKey: string
}

export type WtlFacilityListSortDir = 'asc' | 'desc'

export type WtlFacilityListSortSpec = {
  field: string
  dir: WtlFacilityListSortDir
}

type Props = {
  rows: WtlFacilityListRow[]
  total: number
  loading: boolean
  loadingMore?: boolean
  error: string | null
  fieldsTable: string | null
  fieldsTableFallback: string | null
  selectedId: string | null
  onSelect: (row: WtlFacilityListRow | null) => void
  onScrollNearEnd?: () => void
  scrollLoadThresholdPx?: number
  /** 점용허가 목록과 동일 — thead 다중 정렬 */
  sorts?: WtlFacilityListSortSpec[]
  onToggleSort?: (field: string) => void
}

function fallbackListFields(record: Record<string, unknown> | null): DefineFieldLike[] {
  if (!record) return []
  return Object.keys(record)
    .filter((k) => {
      const lower = k.toLowerCase()
      return lower !== 'geom' && lower !== 'geometry' && lower !== 'the_geom'
    })
    .slice(0, 6)
    .map((name, idx) => ({
      define_field_name: name,
      define_field_kor_name: name,
      define_field_idx: idx,
      define_field_show_list: true,
      define_field_show_detail: true,
      define_field_type: 'TEXT',
    }))
}

export function initialFacilityListSortDir(_field: string): WtlFacilityListSortDir {
  return 'asc'
}

export function WtlFacilityListView({
  rows,
  total,
  loading,
  loadingMore = false,
  error,
  fieldsTable,
  fieldsTableFallback,
  selectedId,
  onSelect,
  onScrollNearEnd,
  scrollLoadThresholdPx = 240,
  sorts = [],
  onToggleSort,
}: Props) {
  const [bundle, setBundle] = useState<WtlDefineDisplayBundle | null>(null)
  const listScrollRef = useRef<HTMLDivElement>(null)
  /** 지도 선택 후 페이징으로 아직 안 온 행 — 이어서 받다가 스크롤 */
  const scrollTargetIdRef = useRef<string | null>(null)

  const onListScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      if (!onScrollNearEnd) return
      const el = e.currentTarget
      const remain = el.scrollHeight - el.scrollTop - el.clientHeight
      if (remain < scrollLoadThresholdPx) onScrollNearEnd()
    },
    [onScrollNearEnd, scrollLoadThresholdPx]
  )

  useEffect(() => {
    if (!selectedId) {
      scrollTargetIdRef.current = null
      return
    }
    scrollTargetIdRef.current = selectedId

    const scrollToSelected = () => {
      if (scrollTargetIdRef.current !== selectedId) return
      const scroller = listScrollRef.current
      if (!scroller) return
      const el = Array.from(
        scroller.querySelectorAll<HTMLElement>('[data-facility-row]')
      ).find((node) => node.getAttribute('data-facility-row') === selectedId)
      if (!el) return
      const scrollerRect = scroller.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      const delta =
        elRect.top + elRect.height / 2 - (scrollerRect.top + scrollerRect.height / 2)
      if (Math.abs(delta) < 4) return
      scroller.scrollBy({ top: delta, behavior: 'smooth' })
    }

    if (rows.some((r) => r.id === selectedId)) {
      scrollToSelected()
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(scrollToSelected)
      })
      return () => cancelAnimationFrame(raf)
    }
    if (loading || loadingMore) return
    if (rows.length < total) onScrollNearEnd?.()
  }, [selectedId, rows, total, loading, loadingMore, onScrollNearEnd])

  useEffect(() => {
    const table = String(fieldsTable ?? '').trim()
    if (!table) {
      setBundle(null)
      return
    }
    const peeked = peekWtlDefineDisplayBundle(table, fieldsTableFallback)
    if (peeked) {
      setBundle(peeked)
      return
    }
    let cancelled = false
    void loadWtlDefineDisplayBundle(table, fieldsTableFallback).then((b) => {
      if (!cancelled) setBundle(b)
    })
    return () => {
      cancelled = true
    }
  }, [fieldsTable, fieldsTableFallback])

  const listFields = useMemo(() => {
    const all = bundle?.fields ?? []
    const selectedFields = selectDefineLayerListFields(all)
    if (selectedFields.length > 0) return selectedFields
    if (all.length > 0) {
      return all
        .filter((f) => {
          const name = String(f.define_field_name ?? '')
            .trim()
            .toLowerCase()
          return name && name !== 'geom' && name !== 'ogc_fid'
        })
        .slice(0, 6)
    }
    return fallbackListFields(rows[0]?.record ?? null)
  }, [bundle, rows])

  const codesByField = bundle?.codesByField ?? {}
  const colCount = Math.max(1, listFields.length)
  const showInitialLoading = loading && rows.length === 0
  const showTable =
    showInitialLoading || error != null || listFields.length > 0 || rows.length > 0
  const sortEnabled = typeof onToggleSort === 'function'

  const footerText = showInitialLoading
    ? '조회 중…'
    : loading && rows.length > 0
      ? `${rows.length} / ${total}건 · 조회 중…`
      : loadingMore
        ? `${rows.length} / ${total}건 · 추가 조회 중…`
        : rows.length < total
          ? `${rows.length} / ${total}건`
          : `${total}건`

  return (
    <div className="standard-list-body">
      <div ref={listScrollRef} className="standard-list-scroll" onScroll={onListScroll}>
        {!showTable ? (
          <p className="standard-table-empty">표시할 필드가 없습니다.</p>
        ) : (
          <table className="standard-list-table">
            <thead className="standard-table-thead">
              <tr>
                {listFields.length > 0 ? (
                  listFields.map((f, i) => {
                    const key = String(f.define_field_name ?? '').trim()
                    const label = getDefineFieldDisplayLabel(key, f.define_field_kor_name)
                    const sortIdx = key
                      ? sorts.findIndex((s) => s.field.toLowerCase() === key.toLowerCase())
                      : -1
                    const active = sortIdx >= 0
                    const sortDir = active ? sorts[sortIdx]!.dir : null
                    const Icon = !active
                      ? ArrowUpDown
                      : sortDir === 'asc'
                        ? ArrowUp
                        : ArrowDown
                    const initial = initialFacilityListSortDir(key)
                    return (
                      <th
                        key={key || `h-${i}`}
                        className="standard-table-th standard-table-th-left max-w-none"
                        title={label}
                      >
                        {sortEnabled && key ? (
                          <button
                            type="button"
                            onClick={() => onToggleSort(key)}
                            className={cn(
                              'standard-sort-button standard-sort-button-left max-w-none whitespace-nowrap',
                              active && 'standard-sort-button-active'
                            )}
                            title={
                              !active
                                ? `${label} 정렬 추가`
                                : sortDir === initial
                                  ? `${label} 방향 바꾸기`
                                  : `${label} 정렬 해제`
                            }
                          >
                            <span className="truncate">{label}</span>
                            <Icon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                          </button>
                        ) : (
                          label
                        )}
                      </th>
                    )
                  })
                ) : (
                  <th className="standard-table-th standard-table-th-left">—</th>
                )}
              </tr>
            </thead>
            <tbody>
              {showInitialLoading ? (
                <WtlFacilityTableLoadingRow colSpan={colCount} />
              ) : error ? (
                <tr>
                  <td colSpan={colCount} className="standard-table-empty text-destructive">
                    {error}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="standard-table-empty">
                    조회된 시설이 없습니다.
                  </td>
                </tr>
              ) : listFields.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="standard-table-empty">
                    표시할 필드가 없습니다.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    data-facility-row={row.id}
                    className={cn(
                      'standard-list-row cursor-pointer',
                      selectedId === row.id && 'standard-list-row-selected'
                    )}
                    onClick={() => onSelect(row)}
                  >
                    {listFields.map((f, fi) => {
                      const key = String(f.define_field_name ?? '').trim()
                      const raw = getRowValueByField(row.record, key)
                      const value = formatDefineFieldDisplayValue(
                        raw,
                        f.define_field_type,
                        codesByField[key.toLowerCase()],
                        '—'
                      )
                      return (
                        <td
                          key={`${row.id}-${key || fi}`}
                          className="standard-table-td-compact"
                          title={value}
                        >
                          {value}
                        </td>
                      )
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
      <div className="standard-list-footer">{footerText}</div>
    </div>
  )
}
