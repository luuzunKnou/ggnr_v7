'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, X } from 'lucide-react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useMapContext } from '../../../_mapComponents/MapContext'
import { MapSideListPanel } from '../../../_mapComponents/MapSideListPanel'
import { WtlFacilityDetailPanel } from './WtlFacilityDetailPanel'
import {
  initialFacilityListSortDir,
  WtlFacilityListView,
  type WtlFacilityListRow,
  type WtlFacilityListSortSpec,
} from './WtlFacilityListView'
import {
  facilityTabLabel,
  isSangsuLayerGroup,
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
const LIST_PAGE_SIZE = 500
const LIST_SCROLL_LOAD_THRESHOLD_PX = 240

export type WtlFacilityShellCatalog = {
  /** 탭 키 = define_table_name(영문) */
  tabs: readonly string[]
  isTabEnabled: (tab: string) => boolean
  listGroupOptions: (tab: string) => WtlFacilityGroupOption[]
  listUndergroundTableNames: () => string[]
  /** 탭 버튼 문구 — tables.json 한글명 */
  tabLabel: (tab: string) => string
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
  /** 미지정 시 시설관리 탭·그룹 카탈로그 (탭 목록은 adminTabs.json) */
  catalog?: WtlFacilityShellCatalog
  /** 레이어 그룹 옵션 — facility·equipment 모두 define_table_group 모음 */
  layerGroupsMode?: 'facility' | 'equipment'
}

const DEFAULT_CATALOG_BASE = {
  listGroupOptions: listFacilityGroupOptions,
  tabLabel: facilityTabLabel,
  emptyNoTab: '활성화된 시설 레이어가 없습니다.',
  emptyNoLayer: '선택한 탭에 등록된 레이어가 없습니다.',
  emptyNoQuery: '시설을 조회할 수 없습니다.',
} as const

function firstEnabledTab(
  tabs: readonly string[],
  isEnabled: (tab: string) => boolean
): string | null {
  return tabs.find((t) => isEnabled(t)) ?? null
}

export function WtlFacilityShell({
  leftOffsetPx,
  onTotalWidthChange,
  onClose,
  title = '시설관리',
  catalog: catalogProp,
  layerGroupsMode = 'facility',
}: Props) {
  const mapContext = useMapContext()
  const [listWidth, setListWidth] = useState(LIST_DEFAULT)
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT)
  /** catalog 미지정(시설관리)일 때 JSON 탭 — 서버 fs 런타임 */
  const [facilityTabs, setFacilityTabs] = useState<string[]>([])
  /** tables.json 등록 + DB 존재 탭 (서버) */
  const [enabledTabs, setEnabledTabs] = useState<string[]>([])
  const [tabsLoading, setTabsLoading] = useState(() => !catalogProp)
  const [groupsLoading, setGroupsLoading] = useState(false)

  const usesExternalCatalog = catalogProp != null
  const enabledTabSet = useMemo(() => new Set(enabledTabs), [enabledTabs])

  const catalog = useMemo<WtlFacilityShellCatalog>(() => {
    if (catalogProp) return catalogProp
    return {
      ...DEFAULT_CATALOG_BASE,
      tabs: facilityTabs,
      isTabEnabled: (name: string) => enabledTabSet.has(String(name ?? '').trim()),
      listUndergroundTableNames: () => listAllFacilityUndergroundTableNames(facilityTabs),
    }
  }, [catalogProp, enabledTabSet, facilityTabs])

  const isTabEnabled = useCallback(
    (name: string) => catalog.isTabEnabled(name),
    [catalog]
  )

  const tabsKey = catalog.tabs.join('\0')
  const enabledTabsKey = enabledTabs.join('\0')
  const catalogRef = useRef(catalog)
  catalogRef.current = catalog

  const [tab, setTab] = useState<string | null>(null)
  /** DB 존재 확인된 레이어 그룹 (서버) */
  const [groupOptions, setGroupOptions] = useState<WtlFacilityGroupOption[]>([])
  const [group, setGroup] = useState<string>('')
  const [keywordDraft, setKeywordDraft] = useState('')
  const [keyword, setKeyword] = useState('')
  const [emdSelected, setEmdSelected] = useState('')
  const [riSelected, setRiSelected] = useState('')
  const [supplyBlock, setSupplyBlock] = useState('')
  const [areaWkts5181, setAreaWkts5181] = useState<string[]>([])
  const [emdOptions, setEmdOptions] = useState<{ code: string; name: string }[]>([])
  const [riOptions, setRiOptions] = useState<{ code: string; name: string }[]>([])
  const [supplyBlockOptions, setSupplyBlockOptions] = useState<
    { value: string; label: string }[]
  >([])
  const [rows, setRows] = useState<WtlFacilityListRow[]>([])
  const [total, setTotal] = useState(0)
  /** 점용허가 목록과 동일 — thead 다중 정렬 */
  const [sorts, setSorts] = useState<WtlFacilityListSortSpec[]>([])
  const [fieldsTable, setFieldsTable] = useState<string | null>(null)
  const [fieldsTableFallback, setFieldsTableFallback] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** 목록에 없어도 상세·하이라이트 유지 (지도 선택 시 rows 앞에 끼워 넣지 않음) */
  const [selectedRow, setSelectedRow] = useState<WtlFacilityListRow | null>(null)
  const rowsLenRef = useRef(0)
  const totalRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const loadSourceKeyRef = useRef('')
  const tabScrollRef = useRef<HTMLDivElement>(null)
  const [canScrollTabLeft, setCanScrollTabLeft] = useState(false)
  const [canScrollTabRight, setCanScrollTabRight] = useState(false)

  const updateTabScrollState = useCallback(() => {
    const el = tabScrollRef.current
    if (!el) {
      setCanScrollTabLeft(false)
      setCanScrollTabRight(false)
      return
    }
    const { scrollLeft, scrollWidth, clientWidth } = el
    setCanScrollTabLeft(scrollLeft > 1)
    setCanScrollTabRight(scrollLeft + clientWidth < scrollWidth - 1)
  }, [])

  const scrollTabs = useCallback((dir: -1 | 1) => {
    const el = tabScrollRef.current
    if (!el) return
    el.scrollBy({
      left: dir * Math.max(120, Math.floor(el.clientWidth * 0.6)),
      behavior: 'smooth',
    })
  }, [])

  const showTabSlide = canScrollTabLeft || canScrollTabRight

  const selectedSource: WtlFacilityGroupOption | null = useMemo(() => {
    if (!groupOptions.length) return null
    return groupOptions.find((g) => g.group === group) ?? groupOptions[0] ?? null
  }, [group, groupOptions])

  const showLocationFilter = isSangsuLayerGroup(selectedSource)

  const selected =
    selectedRow && selectedId && selectedRow.id === selectedId ? selectedRow : null

  const clearLocationFilters = useCallback(() => {
    setEmdSelected('')
    setRiSelected('')
    setSupplyBlock('')
    setAreaWkts5181([])
    mapContext?.setSpatialFilterWkt?.(null)
  }, [mapContext?.setSpatialFilterWkt])
  const detailOpen = selected != null
  const totalWidth = listWidth + (detailOpen ? detailWidth : 0)

  useWtlFacilityMapHighlight(selected)

  const selectFacilityRow = useCallback(
    (row: WtlFacilityListRow | null, opts?: { fly?: boolean }) => {
      if (!row) {
        setSelectedId(null)
        setSelectedRow(null)
        return
      }
      setSelectedId(row.id)
      setSelectedRow(row)
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
    // tabsKey: catalog 객체 참조 대신 탭 목록 내용만 추적
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tabsKey mirrors catalog.tabs
    [tabsKey]
  )

  const onTotalWidthChangeRef = useRef(onTotalWidthChange)
  onTotalWidthChangeRef.current = onTotalWidthChange

  /** 콜백 참조만 ref — deps에 넣으면 부모 리렌더 루프. Strict Mode 정리(0) 후에도 totalWidth로 재통지 */
  useEffect(() => {
    onTotalWidthChangeRef.current(totalWidth)
  }, [totalWidth])

  useEffect(() => {
    return () => onTotalWidthChangeRef.current(0)
  }, [])

  useEffect(() => {
    updateTabScrollState()
    const el = tabScrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => updateTabScrollState())
    ro.observe(el)
    el.addEventListener('scroll', updateTabScrollState, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', updateTabScrollState)
    }
  }, [listWidth, tabsKey, updateTabScrollState])

  useEffect(() => {
    const el = tabScrollRef.current
    if (!el || !tab) return
    const active = el.querySelector<HTMLElement>(
      `[data-facility-tab="${CSS.escape(tab)}"]`
    )
    active?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
    requestAnimationFrame(updateTabScrollState)
  }, [tab, updateTabScrollState])

  /** 시설관리 기본 카탈로그 — adminTabs.json wtlFacility + DB 활성 탭 */
  useEffect(() => {
    if (usesExternalCatalog) return
    let cancelled = false
    setTabsLoading(true)
    void call('', 'POST', {
      service: 'wtlFacilityService',
      action: 'listFacilityTabs',
      params: {},
    })
      .then((res) => {
        if (cancelled) return
        const data = res?.data ?? res
        const tabs = Array.isArray(data?.tabs)
          ? data.tabs.map((t: unknown) => String(t ?? '').trim()).filter(Boolean)
          : []
        const enabled = Array.isArray(data?.enabledTabs)
          ? data.enabledTabs.map((t: unknown) => String(t ?? '').trim()).filter(Boolean)
          : []
        setFacilityTabs((prev) => (prev.join('\0') === tabs.join('\0') ? prev : tabs))
        setEnabledTabs((prev) =>
          prev.join('\0') === enabled.join('\0') ? prev : enabled
        )
      })
      .catch(() => {
        if (!cancelled) {
          setFacilityTabs((prev) => (prev.length === 0 ? prev : []))
          setEnabledTabs((prev) => (prev.length === 0 ? prev : []))
        }
      })
      .finally(() => {
        if (!cancelled) setTabsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [usesExternalCatalog])

  /** 탭·활성 목록 로드 후 선택 (비활성 탭은 선택하지 않음) */
  useEffect(() => {
    if (tabsLoading) return
    const cat = catalogRef.current
    setTab((prev) => {
      if (prev && cat.tabs.includes(prev) && isTabEnabled(prev)) return prev
      return firstEnabledTab(cat.tabs, isTabEnabled)
    })
  }, [tabsKey, enabledTabsKey, tabsLoading, isTabEnabled])

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

  /** 탭 변경 시 목록·필터 초기화 + DB에 있는 레이어 그룹만 조회 */
  useEffect(() => {
    setKeywordDraft('')
    setKeyword('')
    setSelectedId(null)
    setSelectedRow(null)
    setRows([])
    setTotal(0)
    setError(null)
    clearLocationFilters()
    if (!tab || !isTabEnabled(tab)) {
      setGroupOptions([])
      setGroup('')
      setGroupsLoading(false)
      return
    }
    let cancelled = false
    setGroupOptions([])
    setGroup('')
    setGroupsLoading(true)
    void call('', 'POST', {
      service: 'wtlFacilityService',
      action: 'listFacilityLayerGroups',
      params: { tableName: tab, mode: layerGroupsMode },
    })
      .then((res) => {
        if (cancelled) return
        const data = res?.data ?? res
        const raw = Array.isArray(data?.options) ? data.options : []
        const opts: WtlFacilityGroupOption[] = raw
          .map((o: Record<string, unknown>) => ({
            group: String(o?.group ?? '').trim(),
            tableName: String(o?.tableName ?? '')
              .trim()
              .toLowerCase(),
            schema:
              String(o?.schema ?? 'layer')
                .trim()
                .toLowerCase() || 'layer',
            defineTableGroup: String(
              o?.defineTableGroup ?? o?.group ?? ''
            ).trim(),
          }))
          .filter((o: WtlFacilityGroupOption) => o.group && o.tableName)
        setGroupOptions(opts)
        setGroup(opts[0]?.group ?? '')
      })
      .catch(() => {
        if (cancelled) return
        setGroupOptions([])
        setGroup('')
      })
      .finally(() => {
        if (!cancelled) setGroupsLoading(false)
      })
    return () => {
      cancelled = true
    }
    // clearLocationFilters는 mapContext 불안정 시 루프 유발 → tab·mode만 의존
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, layerGroupsMode, isTabEnabled])

  useEffect(() => {
    if (!showLocationFilter) {
      clearLocationFilters()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLocationFilter])

  useEffect(() => {
    let cancelled = false
    void call('', 'POST', {
      service: 'devTestService',
      action: 'getEmdRiOptions',
      params: {},
    })
      .then((res) => {
        if (cancelled) return
        const data = res?.data ?? res
        setEmdOptions(Array.isArray(data?.emd) ? data.emd : [])
      })
      .catch(() => {
        if (!cancelled) setEmdOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void call('', 'POST', {
      service: 'wtlNetworkService',
      action: 'listWtlSupplyBlockOptions',
      params: {},
    })
      .then((res) => {
        if (cancelled) return
        const data = res?.data ?? res
        setSupplyBlockOptions(Array.isArray(data?.options) ? data.options : [])
      })
      .catch(() => {
        if (!cancelled) setSupplyBlockOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!emdSelected) {
      setRiOptions([])
      setRiSelected('')
      return
    }
    let cancelled = false
    void call('', 'POST', {
      service: 'devTestService',
      action: 'getRiOptionsByEmd',
      params: { emdCode: emdSelected },
    })
      .then((res) => {
        if (cancelled) return
        const data = res?.data ?? res
        setRiOptions(Array.isArray(data?.ri) ? data.ri : [])
        setRiSelected('')
      })
      .catch(() => {
        if (!cancelled) {
          setRiOptions([])
          setRiSelected('')
        }
      })
    return () => {
      cancelled = true
    }
  }, [emdSelected])

  /** 읍면동·리·급수블록 → 5181 WKT */
  useEffect(() => {
    if (!showLocationFilter) return
    let cancelled = false
    const emd = emdSelected.trim()
    const ri = riSelected.trim()
    const block = supplyBlock.trim()
    if (!emd && !ri && !block) {
      setAreaWkts5181([])
      mapContext?.setSpatialFilterWkt?.(null)
      return
    }
    ;(async () => {
      const wkts: string[] = []
      try {
        if (ri) {
          const res = await call('', 'POST', {
            service: 'devTestService',
            action: 'getRiGeometry',
            params: { riCode: ri },
          })
          const w = String((res?.data ?? res)?.wkt ?? '').trim()
          if (w) wkts.push(w)
        } else if (emd) {
          const res = await call('', 'POST', {
            service: 'devTestService',
            action: 'getEmdGeometry',
            params: { emdCode: emd },
          })
          const w = String((res?.data ?? res)?.wkt ?? '').trim()
          if (w) wkts.push(w)
        }
        if (block) {
          const res = await call('', 'POST', {
            service: 'wtlNetworkService',
            action: 'getWtlSupplyBlockGeometry',
            params: { block },
          })
          const w = String((res?.data ?? res)?.wkt ?? '').trim()
          if (w) wkts.push(w)
        }
      } catch {
        /* keep partial */
      }
      if (cancelled) return
      setAreaWkts5181(wkts)
      let filterWkt: string | null = wkts[0] ?? null
      if (wkts.length > 1) {
        try {
          const ures = await call('', 'POST', {
            service: 'devTestService',
            action: 'unionWkts5181',
            params: { wkts },
          })
          const uw = String((ures?.data ?? ures)?.wkt ?? '').trim()
          if (uw) filterWkt = uw
        } catch {
          /* keep first */
        }
      }
      if (!cancelled) mapContext?.setSpatialFilterWkt?.(filterWkt)
    })()
    return () => {
      cancelled = true
    }
  }, [
    emdSelected,
    mapContext?.setSpatialFilterWkt,
    riSelected,
    showLocationFilter,
    supplyBlock,
  ])

  useEffect(() => {
    return () => {
      mapContext?.setSpatialFilterWkt?.(null)
    }
  }, [mapContext?.setSpatialFilterWkt])

  rowsLenRef.current = rows.length
  totalRef.current = total

  const loadRows = useCallback(async () => {
    if (!selectedSource) {
      loadSourceKeyRef.current = ''
      setRows([])
      setTotal(0)
      setFieldsTable(null)
      setFieldsTableFallback(null)
      setSelectedId(null)
      setSelectedRow(null)
      setLoading(false)
      setLoadingMore(false)
      loadingMoreRef.current = false
      setError(null)
      return
    }
    const sourceKey = `${selectedSource.schema}.${selectedSource.tableName}`
    const sourceChanged = sourceKey !== loadSourceKeyRef.current
    loadSourceKeyRef.current = sourceKey
    if (sourceChanged) {
      setRows([])
      setSelectedId(null)
      setSelectedRow(null)
      if (sorts.length > 0) setSorts([])
    }
    const requestSorts = sourceChanged ? [] : sorts
    setLoading(true)
    setLoadingMore(false)
    loadingMoreRef.current = false
    setError(null)
    try {
      const res = await call('', 'POST', {
        service: 'wtlFacilityService',
        action: 'listFacilityRows',
        params: {
          table: selectedSource.tableName,
          schema: selectedSource.schema,
          keyword,
          areaWkts5181:
            showLocationFilter && areaWkts5181.length > 0 ? areaWkts5181 : null,
          sorts: requestSorts,
          limit: LIST_PAGE_SIZE,
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
      setSelectedRow((prev) => {
        if (!prev) return null
        return nextRows.find((r) => r.id === prev.id) ?? null
      })
    } catch {
      setRows([])
      setTotal(0)
      setSelectedId(null)
      setSelectedRow(null)
      setError('목록을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [areaWkts5181, keyword, selectedSource, showLocationFilter, sorts])

  const loadMoreRows = useCallback(() => {
    if (!selectedSource) return
    if (loading || loadingMoreRef.current) return
    const offset = rowsLenRef.current
    if (offset >= totalRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    void call('', 'POST', {
      service: 'wtlFacilityService',
      action: 'listFacilityRows',
      params: {
        table: selectedSource.tableName,
        schema: selectedSource.schema,
        keyword,
        areaWkts5181:
          showLocationFilter && areaWkts5181.length > 0 ? areaWkts5181 : null,
        sorts,
        limit: LIST_PAGE_SIZE,
        offset,
      },
    })
      .then((res) => {
        const data = (res?.data ?? res) as
          | {
              rows?: WtlFacilityListRow[]
              total?: number
            }
          | undefined
        const next = Array.isArray(data?.rows) ? data.rows : []
        if (next.length === 0) {
          // 더 이상 없음 — 선택 행 추적 loadMore 루프 방지
          setTotal((t) => Math.min(t, rowsLenRef.current))
          return
        }
        let appendedCount = 0
        setRows((prev) => {
          const seen = new Set(prev.map((r) => r.id))
          const appended = next.filter((r) => !seen.has(r.id))
          appendedCount = appended.length
          return appended.length ? [...prev, ...appended] : prev
        })
        if (appendedCount === 0) {
          setTotal((t) => Math.min(t, rowsLenRef.current))
        } else if (typeof data?.total === 'number') {
          setTotal(Number(data.total) || 0)
        }
      })
      .catch(() => {
        /* keep existing rows */
      })
      .finally(() => {
        loadingMoreRef.current = false
        setLoadingMore(false)
      })
  }, [areaWkts5181, keyword, loading, selectedSource, showLocationFilter, sorts])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  const toggleListSort = useCallback((field: string) => {
    const key = String(field ?? '').trim()
    if (!key) return
    const initial = initialFacilityListSortDir(key)
    setSorts((prev) => {
      const idx = prev.findIndex((s) => s.field.toLowerCase() === key.toLowerCase())
      if (idx < 0) return [...prev, { field: key, dir: initial }]
      const cur = prev[idx]!
      if (cur.dir === initial) {
        const next = [...prev]
        next[idx] = { field: key, dir: initial === 'asc' ? 'desc' : 'asc' }
        return next
      }
      return prev.filter((_, i) => i !== idx)
    })
  }, [])

  const resetFilters = () => {
    const first = groupOptions[0]?.group ?? ''
    setGroup(first)
    setKeywordDraft('')
    setKeyword('')
    setSorts([])
    setSelectedId(null)
    setSelectedRow(null)
    clearLocationFilters()
  }

  const handleTabClick = (name: string) => {
    if (!isTabEnabled(name)) return
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
          contentClassName="overflow-hidden"
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
                <div className="flex items-stretch border-b border-border">
                  {showTabSlide ? (
                    <button
                      type="button"
                      title="이전 탭"
                      aria-label="이전 탭"
                      disabled={!canScrollTabLeft}
                      onClick={() => scrollTabs(-1)}
                      className={cn(
                        'inline-flex h-7 w-6 shrink-0 cursor-pointer items-center justify-center border-b-2 border-transparent text-muted-foreground hover:text-foreground',
                        !canScrollTabLeft && 'cursor-not-allowed opacity-30 hover:text-muted-foreground'
                      )}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  ) : null}
                  <div
                    ref={tabScrollRef}
                    className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                  >
                    {catalog.tabs.map((name) => {
                      const enabled = isTabEnabled(name)
                      const on = tab === name
                      const label = catalog.tabLabel(name) || name
                      return (
                        <button
                          key={name}
                          type="button"
                          data-facility-tab={name}
                          title={enabled ? label : '데이터가 없습니다'}
                          disabled={!enabled}
                          className={cn(
                            'h-7 shrink-0 whitespace-nowrap border-b-2 -mb-px px-2 text-center text-[11px]',
                            !enabled && 'cursor-not-allowed opacity-40',
                            enabled && on
                              ? 'border-primary font-semibold text-primary'
                              : enabled
                                ? 'cursor-pointer border-transparent text-muted-foreground hover:text-foreground'
                                : 'border-transparent text-muted-foreground'
                          )}
                          onClick={() => handleTabClick(name)}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                  {showTabSlide ? (
                    <button
                      type="button"
                      title="다음 탭"
                      aria-label="다음 탭"
                      disabled={!canScrollTabRight}
                      onClick={() => scrollTabs(1)}
                      className={cn(
                        'inline-flex h-7 w-6 shrink-0 cursor-pointer items-center justify-center border-b-2 border-transparent text-muted-foreground hover:text-foreground',
                        !canScrollTabRight && 'cursor-not-allowed opacity-30 hover:text-muted-foreground'
                      )}
                    >
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  ) : null}
                </div>
                {tab && isTabEnabled(tab) && groupOptions.length > 0 ? (
                  <div className="mt-2 space-y-1.5">
                    {groupOptions.length >= 2 ? (
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
                            setSelectedRow(null)
                          }}
                        >
                          {groupOptions.map((opt) => (
                            <option key={opt.group} value={opt.group}>
                              {opt.group}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                    {showLocationFilter ? (
                      <div className="flex items-center gap-1">
                        <span className="standard-detail-hit-label w-16 !text-foreground">위치</span>
                        <div className="grid min-w-0 flex-1 grid-cols-3 gap-1">
                          <select
                            value={emdSelected}
                            onChange={(e) => setEmdSelected(e.target.value)}
                            className="standard-detail-input h-7 min-w-0 cursor-pointer px-1 text-[11px]"
                            title="읍면동"
                            aria-label="읍면동"
                          >
                            <option value="">읍면동</option>
                            {emdOptions.map((opt) => (
                              <option key={opt.code} value={opt.code}>
                                {opt.name}
                              </option>
                            ))}
                          </select>
                          <select
                            value={riSelected}
                            onChange={(e) => setRiSelected(e.target.value)}
                            disabled={!emdSelected}
                            className="standard-detail-input h-7 min-w-0 cursor-pointer px-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-60"
                            title={emdSelected ? '리' : '읍면동을 먼저 선택하세요'}
                            aria-label="리"
                          >
                            <option value="">리</option>
                            {riOptions.map((opt) => (
                              <option key={opt.code} value={opt.code}>
                                {opt.name}
                              </option>
                            ))}
                          </select>
                          <select
                            value={supplyBlock}
                            onChange={(e) => setSupplyBlock(e.target.value)}
                            className="standard-detail-input h-7 min-w-0 cursor-pointer px-1 text-[11px]"
                            title="급수블록"
                            aria-label="급수블록"
                          >
                            <option value="">급수블록</option>
                            {supplyBlockOptions.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ) : null}
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
                ) : groupsLoading || tabsLoading ? null : (
                  <p className="mt-2 px-0.5 text-[11px] text-muted-foreground">
                    {catalog.emptyNoTab ?? DEFAULT_CATALOG_BASE.emptyNoTab}
                  </p>
                )}
              </div>
              {tab && isTabEnabled(tab) && selectedSource ? (
                <WtlFacilityListView
                  rows={rows}
                  total={total}
                  loading={loading}
                  loadingMore={loadingMore}
                  error={error}
                  fieldsTable={fieldsTable}
                  fieldsTableFallback={fieldsTableFallback}
                  selectedId={selectedId}
                  onSelect={(row) => selectFacilityRow(row, { fly: true })}
                  onScrollNearEnd={loadMoreRows}
                  scrollLoadThresholdPx={LIST_SCROLL_LOAD_THRESHOLD_PX}
                  sorts={sorts}
                  onToggleSort={toggleListSort}
                />
              ) : (
                <div className="flex min-h-0 flex-1 items-center justify-center px-3">
                  <p className="text-xs text-muted-foreground">
                    {catalog.emptyNoQuery ?? DEFAULT_CATALOG_BASE.emptyNoQuery}
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
              onClose={() => {
                setSelectedId(null)
                setSelectedRow(null)
              }}
              onUpdated={(next) => {
                setRows((prev) => prev.map((r) => (r.id === next.id ? next : r)))
                setSelectedRow((prev) => (prev?.id === next.id ? next : prev))
              }}
              onDeleted={(id) => {
                setRows((prev) => prev.filter((r) => r.id !== id))
                setTotal((t) => Math.max(0, t - 1))
                setSelectedId(null)
                setSelectedRow(null)
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
