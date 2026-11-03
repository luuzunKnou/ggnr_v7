'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useMapContext } from '../../../_mapComponents/MapContext'
import { MapSideListPanel } from '../../../_mapComponents/MapSideListPanel'
import { WtlFacilityDetailPanel } from './WtlFacilityDetailPanel'
import {
  WtlFacilityListView,
  type WtlFacilityListRow,
} from './WtlFacilityListView'
import {
  FACILITY_TABS,
  isFacilityTabEnabled,
  listAllFacilityUndergroundTableNames,
  listFacilityGroupOptions,
  type WtlFacilityGroupOption,
} from './wtlFacilityCatalog'
import { flyToWtlNetworkGeom } from '../networkMap/wtlNetworkMapFly'
import { useWtlFacilityMapClick } from './useWtlFacilityMapClick'
import { useWtlFacilityMapHighlight } from './useWtlFacilityMapHighlight'

const LIST_DEFAULT = 480
const LIST_MIN = 400
const LIST_MAX = 720
const DETAIL_DEFAULT = 420
const DETAIL_MIN = 320
const DETAIL_MAX = 640

export type WtlFacilityShellCatalog = {
  tabs: readonly string[]
  isTabEnabled: (tab: string) => boolean
  listGroupOptions: (tab: string) => WtlFacilityGroupOption[]
  listUndergroundTableNames: () => string[]
  emptyNoTab?: string
  emptyNoLayer?: string
  emptyNoQuery?: string
}

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
  /** 패널 헤더 제목 (설비관리 등에서 재사용) */
  title?: string
  /** 미지정 시 시설관리 탭·그룹 카탈로그 */
  catalog?: WtlFacilityShellCatalog
}

const DEFAULT_CATALOG: WtlFacilityShellCatalog = {
  tabs: FACILITY_TABS,
  isTabEnabled: isFacilityTabEnabled,
  listGroupOptions: listFacilityGroupOptions,
  listUndergroundTableNames: listAllFacilityUndergroundTableNames,
  emptyNoTab: '활성화된 시설 레이어가 없습니다.',
  emptyNoLayer: '선택한 탭에 등록된 레이어가 없습니다.',
  emptyNoQuery: '시설을 조회할 수 없습니다.',
}

function firstEnabledTab(catalog: WtlFacilityShellCatalog): string | null {
  return catalog.tabs.find((t) => catalog.isTabEnabled(t)) ?? null
}

export function WtlFacilityShell({
  leftOffsetPx,
  onTotalWidthChange,
  onClose,
  title = '시설관리',
  catalog: catalogProp,
}: Props) {
  const catalog = catalogProp ?? DEFAULT_CATALOG
  const mapContext = useMapContext()
  const [listWidth, setListWidth] = useState(LIST_DEFAULT)
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT)
  const [tab, setTab] = useState<string | null>(() => firstEnabledTab(catalog))
  const groupOptions = useMemo(
    () => (tab ? catalog.listGroupOptions(tab) : []),
    [catalog, tab]
  )
  const [group, setGroup] = useState<string>(() => groupOptions[0]?.group ?? '')
  const [keywordDraft, setKeywordDraft] = useState('')
  const [keyword, setKeyword] = useState('')
  const [rows, setRows] = useState<WtlFacilityListRow[]>([])
  const [total, setTotal] = useState(0)
  const [fieldsTable, setFieldsTable] = useState<string | null>(null)
  const [fieldsTableFallback, setFieldsTableFallback] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selectedSource: WtlFacilityGroupOption | null = useMemo(() => {
    if (!groupOptions.length) return null
    return groupOptions.find((g) => g.group === group) ?? groupOptions[0] ?? null
  }, [group, groupOptions])

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId]
  )
  const detailOpen = selected != null
  const totalWidth = listWidth + (detailOpen ? detailWidth : 0)

  useWtlFacilityMapHighlight(selected)

  const selectFacilityRow = useCallback(
    (row: WtlFacilityListRow | null, opts?: { fly?: boolean }) => {
      if (!row) {
        setSelectedId(null)
        return
      }
      setRows((prev) => (prev.some((r) => r.id === row.id) ? prev : [row, ...prev]))
      setSelectedId(row.id)
      if (opts?.fly) {
        const map = mapContext?.mapInstanceRef?.current
        flyToWtlNetworkGeom(
          map,
          row.geom,
          () => mapContext?.applyMapViewPaddingRef?.current?.()
        )
      }
    },
    [mapContext?.applyMapViewPaddingRef, mapContext?.mapInstanceRef]
  )

  useWtlFacilityMapClick({
    source: selectedSource
      ? { tableName: selectedSource.tableName, schema: selectedSource.schema }
      : null,
    onSelect: (row) => selectFacilityRow(row),
  })

  const managedUndergroundTables = useMemo(
    () => catalog.listUndergroundTableNames(),
    [catalog]
  )

  useEffect(() => {
    onTotalWidthChange(totalWidth)
  }, [totalWidth, onTotalWidthChange])

  useEffect(() => {
    return () => onTotalWidthChange(0)
  }, [onTotalWidthChange])

  /**
   * 선택 레이어 그룹의 시설 테이블 ↔ 지하시설물(visibleLayerNames) 동기화.
   * 시설관리가 다루는 테이블만 교체하고 그 외 UF 선택은 유지.
   */
  useEffect(() => {
    const setVisible = mapContext?.setVisibleLayerNames
    if (!setVisible) return
    const wanted = String(selectedSource?.tableName ?? '')
      .trim()
      .toLowerCase()
    setVisible((prev) => {
      const next = new Set(prev)
      for (const t of managedUndergroundTables) next.delete(t)
      if (wanted) next.add(wanted)
      if (next.size === prev.size) {
        let same = true
        for (const n of next) {
          if (!prev.has(n)) {
            same = false
            break
          }
        }
        if (same) return prev
      }
      return next
    })
  }, [mapContext?.setVisibleLayerNames, managedUndergroundTables, selectedSource?.tableName])

  useEffect(() => {
    const setVisible = mapContext?.setVisibleLayerNames
    if (!setVisible) return
    return () => {
      setVisible((prev) => {
        let changed = false
        const next = new Set(prev)
        for (const t of managedUndergroundTables) {
          if (next.delete(t)) changed = true
        }
        return changed ? next : prev
      })
    }
  }, [mapContext?.setVisibleLayerNames, managedUndergroundTables])

  useEffect(() => {
    const opts = tab ? catalog.listGroupOptions(tab) : []
    setGroup(opts[0]?.group ?? '')
    setKeywordDraft('')
    setKeyword('')
    setSelectedId(null)
    setRows([])
    setTotal(0)
    setError(null)
  }, [catalog, tab])

  const loadRows = useCallback(async () => {
    if (!selectedSource) {
      setRows([])
      setTotal(0)
      setFieldsTable(null)
      setFieldsTableFallback(null)
      setSelectedId(null)
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await call('', 'POST', {
        service: 'wtlFacilityService',
        action: 'listFacilityRows',
        params: {
          table: selectedSource.tableName,
          schema: selectedSource.schema,
          keyword,
          limit: 500,
          offset: 0,
        },
      })
      const data = (res?.data ?? res) as
        | {
            rows?: WtlFacilityListRow[]
            total?: number
            fieldsTable?: string
            fieldsTableFallback?: string | null
          }
        | undefined
      const nextRows = Array.isArray(data?.rows) ? data.rows : []
      setRows(nextRows)
      setTotal(Number(data?.total ?? nextRows.length) || nextRows.length)
      setFieldsTable(String(data?.fieldsTable ?? selectedSource.tableName) || null)
      setFieldsTableFallback(
        data?.fieldsTableFallback != null
          ? String(data.fieldsTableFallback)
          : null
      )
      setSelectedId((prev) => {
        if (prev && nextRows.some((r) => r.id === prev)) return prev
        return null
      })
    } catch {
      setRows([])
      setTotal(0)
      setSelectedId(null)
      setError('목록을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [keyword, selectedSource])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  const resetFilters = () => {
    const first = groupOptions[0]?.group ?? ''
    setGroup(first)
    setKeywordDraft('')
    setKeyword('')
    setSelectedId(null)
  }

  const handleTabClick = (name: string) => {
    if (!catalog.isTabEnabled(name)) return
    setTab(name)
  }

  return (
    <>
      <div className="pointer-events-auto shrink-0">
        <MapSideListPanel
          width={listWidth}
          minWidth={LIST_MIN}
          maxWidth={LIST_MAX}
          leftOffsetPx={leftOffsetPx}
          onWidthChange={setListWidth}
        >
          <div className="standard-panel-root">
            <div className="standard-panel-header">
              <span className="standard-panel-title">{title}</span>
              <button
                type="button"
                className="standard-panel-close cursor-pointer"
                onClick={onClose}
                aria-label="닫기"
                title="닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="standard-filter-section shrink-0 border-b-0 !pb-[13px]">
                <div className="flex border-b border-border">
                  {catalog.tabs.map((name) => {
                    const enabled = catalog.isTabEnabled(name)
                    const on = tab === name
                    return (
                      <button
                        key={name}
                        type="button"
                        title={enabled ? name : `${name} (레이어 없음)`}
                        disabled={!enabled}
                        className={cn(
                          'h-7 min-w-0 flex-1 truncate border-b-2 -mb-px px-0.5 text-center text-[11px]',
                          !enabled && 'cursor-not-allowed opacity-40',
                          enabled && on
                            ? 'border-primary font-semibold text-primary'
                            : enabled
                              ? 'cursor-pointer border-transparent text-muted-foreground hover:text-foreground'
                              : 'border-transparent text-muted-foreground'
                        )}
                        onClick={() => handleTabClick(name)}
                      >
                        {name}
                      </button>
                    )
                  })}
                </div>
                {tab && groupOptions.length > 0 ? (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center gap-1">
                      <span className="standard-detail-hit-label w-16 !text-foreground">레이어 그룹</span>
                      <select
                        className="standard-detail-hit-select"
                        value={group || groupOptions[0]?.group || ''}
                        title="레이어 그룹"
                        aria-label="레이어 그룹"
                        onChange={(e) => {
                          setGroup(e.target.value)
                          setSelectedId(null)
                        }}
                      >
                        {groupOptions.map((opt) => (
                          <option key={opt.group} value={opt.group}>
                            {opt.group}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="standard-detail-hit-label w-16 !text-foreground">통합검색</span>
                      <input
                        type="search"
                        value={keywordDraft}
                        onChange={(e) => setKeywordDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return
                          e.preventDefault()
                          setKeyword(keywordDraft.trim())
                        }}
                        placeholder="통합검색 · Enter로 검색"
                        title="통합검색 · Enter로 검색"
                        aria-label="통합검색"
                        className="standard-detail-input h-7 min-w-0 flex-1 py-0 text-[11px]"
                      />
                      <button
                        type="button"
                        title="필터 초기화"
                        onClick={resetFilters}
                        className="standard-detail-action-btn inline-flex h-7 shrink-0 cursor-pointer items-center gap-0.5 px-1.5"
                      >
                        <RefreshCw className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
                        초기화
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 px-0.5 text-[11px] text-muted-foreground">
                    {tab
                      ? (catalog.emptyNoLayer ?? DEFAULT_CATALOG.emptyNoLayer)
                      : (catalog.emptyNoTab ?? DEFAULT_CATALOG.emptyNoTab)}
                  </p>
                )}
              </div>
              {tab && selectedSource ? (
                <WtlFacilityListView
                  rows={rows}
                  total={total}
                  loading={loading}
                  error={error}
                  fieldsTable={fieldsTable}
                  fieldsTableFallback={fieldsTableFallback}
                  selectedId={selectedId}
                  onSelect={(row) => selectFacilityRow(row, { fly: true })}
                />
              ) : (
                <div className="flex min-h-0 flex-1 items-center justify-center px-3">
                  <p className="text-xs text-muted-foreground">
                    {catalog.emptyNoQuery ?? DEFAULT_CATALOG.emptyNoQuery}
                  </p>
                </div>
              )}
            </div>
          </div>
        </MapSideListPanel>
      </div>

      {detailOpen && selected && (
        <div className="pointer-events-auto shrink-0">
          <MapSideListPanel
            width={detailWidth}
            minWidth={DETAIL_MIN}
            maxWidth={DETAIL_MAX}
            leftOffsetPx={leftOffsetPx + listWidth}
            onWidthChange={setDetailWidth}
            contentClassName="overflow-hidden"
          >
            <WtlFacilityDetailPanel
              row={selected}
              schema={selectedSource?.schema}
              onClose={() => setSelectedId(null)}
              onUpdated={(next) => {
                setRows((prev) => prev.map((r) => (r.id === next.id ? next : r)))
              }}
              onDeleted={(id) => {
                setRows((prev) => prev.filter((r) => r.id !== id))
                setTotal((t) => Math.max(0, t - 1))
                setSelectedId(null)
              }}
              onHistoryReverted={() => {
                void loadRows()
              }}
            />
          </MapSideListPanel>
        </div>
      )}
    </>
  )
}
