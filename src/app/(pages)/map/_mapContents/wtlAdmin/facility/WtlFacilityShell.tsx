'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pentagon, RefreshCw, X } from 'lucide-react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useMapContext } from '../../../_mapComponents/MapContext'
import { canStartMapDrawInteraction } from '../../../_mapComponents/mapDrawInteraction'
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
import {
  groupRelatedLayersByCategory,
  PIPE_CATEGORY,
  RELATED_FACILITY_CATEGORY,
  resolveRelatedLayers,
} from './wtlFacilityRelatedLayers'
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../../_mapComponents/config/mapDefaults'
import {
  extent3857FromGeoJson4326,
  scheduleFitMapToExtent3857,
} from '../../../_mapComponents/config/mapAutoNavigation'
import { useEnsureMapCenterInSggOnMount } from '../useEnsureMapCenterInSggOnMount'
import { WtlLayerMark } from '../networkMap/WtlLayerMark'
import { exportWtlFacilityExcel } from './exportWtlFacilityExcel'
import {
  loadWtlDefineDisplayBundle,
} from '../networkMap/wtlNetworkDefineDisplayCache'
import { claimMapLayerClickDetailHighlight } from '@/lib/mapLayerClickDetailHighlight'
import { useWtlFacilityMapClick } from './useWtlFacilityMapClick'
import { useWtlFacilityMapHighlight } from './useWtlFacilityMapHighlight'
import { notifyLayerClickDetailMatchClose } from '../../layerClickDetail/notifyLayerClickDetailMatchClose'
import {
  clearLayerClickDetailMatchCloseDirectNames,
  setLayerClickDetailMatchCloseDirectNames,
  type LayerClickDetailMatchCloseDirectSlot,
} from '../../layerClickDetail/layerClickDetailMatchClose'
import { WtlFacilityInfoPreviewFloat } from './WtlFacilityInfoPreviewFloat'
import {
  loadEquipmentFacilityInfoPreview,
  resolveEquipmentFacilityInfoTarget,
  type EquipmentFacilityInfoPreview,
} from './resolveEquipmentFacilityInfoPreview'

const RELATED_BTN =
  'standard-layer-toggle-chip !w-[120px] !max-w-[120px] !min-w-[120px] shrink-0 cursor-pointer'
const RELATED_BTN_ON = 'standard-layer-toggle-chip-active'
const RELATED_BTN_OFF = 'standard-layer-toggle-chip-inactive'

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
  useEnsureMapCenterInSggOnMount()
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
  const [zoneWkt5181, setZoneWkt5181] = useState<string | null>(null)
  const [zoneDrawing, setZoneDrawing] = useState(false)
  const [emdOptions, setEmdOptions] = useState<{ code: string; name: string }[]>([])
  const [riOptions, setRiOptions] = useState<{ code: string; name: string }[]>([])
  const [supplyBlockOptions, setSupplyBlockOptions] = useState<
    { value: string; label: string }[]
  >([])
  const [rows, setRows] = useState<WtlFacilityListRow[]>([])
  const [total, setTotal] = useState(0)
  const [shpExporting, setShpExporting] = useState(false)
  const [excelExporting, setExcelExporting] = useState(false)
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
  /** 설비관리 리스트 — 시설정보 미리보기 플로팅 모달 */
  const [facilityInfoPreview, setFacilityInfoPreview] =
    useState<EquipmentFacilityInfoPreview | null>(null)
  const facilityInfoPreviewReqRef = useRef(0)
  const rowsLenRef = useRef(0)
  const totalRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const loadSourceKeyRef = useRef('')
  /** 연관 레이어 토글(물리 테이블명) — 탭·그룹 변경 시 초기화 */
  const [relatedOn, setRelatedOn] = useState<Set<string>>(() => new Set())

  const selectedSource: WtlFacilityGroupOption | null = useMemo(() => {
    if (!groupOptions.length) return null
    return groupOptions.find((g) => g.group === group) ?? groupOptions[0] ?? null
  }, [group, groupOptions])

  const showLocationFilter = isSangsuLayerGroup(selectedSource)

  const relatedLayers = useMemo(() => {
    if (!selectedSource) return []
    return resolveRelatedLayers(
      tab,
      selectedSource.defineTableGroup || selectedSource.group || null
    )
  }, [tab, selectedSource?.defineTableGroup, selectedSource?.group, selectedSource?.tableName])

  const relatedLayerGroups = useMemo(
    () => groupRelatedLayersByCategory(relatedLayers),
    [relatedLayers]
  )

  /** 버튼 표시용 — 관로는 자동 ON만 하고 토글 버튼은 숨김 (관련 설비·시설만) */
  const relatedLayerGroupsForUi = useMemo(
    () => relatedLayerGroups.filter((g) => g.category !== PIPE_CATEGORY),
    [relatedLayerGroups]
  )

  /** 설비관리 footer — 관련 시설 레이어 목록 */
  const relatedFacilityLayers = useMemo(
    () =>
      relatedLayerGroups.find((g) => g.category === RELATED_FACILITY_CATEGORY)
        ?.layers ?? [],
    [relatedLayerGroups]
  )
  const relatedFacilityLayersKey = useMemo(
    () =>
      relatedFacilityLayers
        .map((l) => `${l.tableName}\0${l.schema}`)
        .sort()
        .join('\n'),
    [relatedFacilityLayers]
  )
  /** 관련 시설 칩 건수 — tableName → total */
  const [relatedFacilityCounts, setRelatedFacilityCounts] = useState<Record<
    string,
    number
  > | null>(null)

  /** 관로(버튼 숨김·탭/그룹 진입 시 1회 ON) */
  const pipeRelatedNames = useMemo(
    () =>
      relatedLayerGroups
        .find((g) => g.category === PIPE_CATEGORY)
        ?.layers.map((l) => l.tableName)
        .filter(Boolean) ?? [],
    [relatedLayerGroups]
  )
  const pipeRelatedKey = useMemo(
    () => [...pipeRelatedNames].sort().join('\0'),
    [pipeRelatedNames]
  )

  /** 관로 외 연관(버튼) — 토글 시에만 visible 가감 */
  const toggleableRelatedNames = useMemo(() => {
    const pipeNames = new Set(pipeRelatedNames)
    return relatedLayers
      .map((l) => l.tableName)
      .filter((name) => name && !pipeNames.has(name))
  }, [pipeRelatedNames, relatedLayers])
  const toggleableRelatedKey = useMemo(
    () => [...toggleableRelatedNames].sort().join('\0'),
    [toggleableRelatedNames]
  )

  /** 연관 테이블명 서명(정렬) — relatedOnKey와 동일 형식이어야 visible sync가 진행됨 */
  const relatedLayerKeys = useMemo(
    () =>
      relatedLayers
        .map((l) => l.tableName)
        .filter(Boolean)
        .sort()
        .join('\0'),
    [relatedLayers]
  )

  const hasSelectedSource = selectedSource != null

  /**
   * 탭·그룹 확정 후 간접(연관) 레이어 전부 ON.
   * 그룹 로딩 중(hasSelectedSource=false)에는 비우지 않음 — visible 점멸 방지.
   */
  useEffect(() => {
    if (!hasSelectedSource) return
    const names = relatedLayerKeys ? relatedLayerKeys.split('\0') : []
    setRelatedOn((prev) => {
      if (prev.size === names.length && names.every((n) => prev.has(n))) return prev
      return new Set(names)
    })
  }, [relatedLayerKeys, hasSelectedSource])

  /** 설비관리 — 관련 시설 레이어별 건수 (목록 footer) */
  useEffect(() => {
    if (layerGroupsMode !== 'equipment' || title !== '설비관리') {
      setRelatedFacilityCounts(null)
      return
    }
    if (!relatedFacilityLayersKey || relatedFacilityLayers.length === 0) {
      setRelatedFacilityCounts(null)
      return
    }
    let cancelled = false
    setRelatedFacilityCounts(null)
    void (async () => {
      const next: Record<string, number> = {}
      for (const layer of relatedFacilityLayers) {
        const tableName = String(layer.tableName ?? '').trim()
        if (!tableName) continue
        try {
          const res = await call('', 'POST', {
            service: 'wtlFacilityService',
            action: 'listFacilityRows',
            params: {
              table: tableName,
              schema: layer.schema || 'layer',
              limit: 1,
              offset: 0,
            },
          })
          if (cancelled) return
          const data = (res?.data ?? res) as { total?: number } | undefined
          next[tableName] = Number(data?.total ?? 0) || 0
        } catch {
          if (cancelled) return
          next[tableName] = 0
        }
      }
      if (!cancelled) setRelatedFacilityCounts(next)
    })()
    return () => {
      cancelled = true
    }
  }, [
    layerGroupsMode,
    title,
    relatedFacilityLayers,
    relatedFacilityLayersKey,
  ])

  const selected =
    selectedRow && selectedId && selectedRow.id === selectedId ? selectedRow : null

  const clearLocationFilters = useCallback(() => {
    setEmdSelected('')
    setRiSelected('')
    setSupplyBlock('')
    setAreaWkts5181([])
    setZoneWkt5181(null)
    setZoneDrawing(false)
    mapContext?.setSpatialDrawRequest?.(null)
    mapContext?.setSpatialFilterWkt?.(null)
  }, [mapContext?.setSpatialDrawRequest, mapContext?.setSpatialFilterWkt])

  const effectiveAreaWkts5181 = useMemo(() => {
    const list = [...areaWkts5181]
    const zone = String(zoneWkt5181 ?? '').trim()
    if (zone) list.push(zone)
    return list
  }, [areaWkts5181, zoneWkt5181])
  const detailOpen = selected != null
  const totalWidth = listWidth + (detailOpen ? detailWidth : 0)

  useWtlFacilityMapHighlight(selected)

  const claimFacilityHighlight = useCallback(() => {
    const map = mapContext?.mapInstanceRef?.current
    if (map) claimMapLayerClickDetailHighlight(map, 'wtlFacility')
  }, [mapContext?.mapInstanceRef])

  const clearFacilityInfoPreview = useCallback(() => {
    facilityInfoPreviewReqRef.current += 1
    setFacilityInfoPreview(null)
  }, [])

  /** 선택 해제·탭/그룹 전환 시 시설정보 미리보기 닫기 */
  useEffect(() => {
    if (!selectedId) clearFacilityInfoPreview()
  }, [selectedId, clearFacilityInfoPreview])

  const flyToGeomAndWait = useCallback(
    async (geom: unknown) => {
      const map = mapContext?.mapInstanceRef?.current
      const extent = extent3857FromGeoJson4326(geom)
      if (!map || !extent) return
      scheduleFitMapToExtent3857(map, extent, {
        maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
        applyMapViewPadding: () =>
          mapContext?.applyMapViewPaddingRef?.current?.(),
      })
      await new Promise<void>((resolve) => {
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          window.clearTimeout(armTimer)
          window.clearTimeout(fallbackTimer)
          map.un('moveend', onMoveEnd)
          resolve()
        }
        const onMoveEnd = () => finish()
        // scheduleFit(rAF×2) 시작 뒤에 moveend 대기, 미이동 시 타임아웃
        const armTimer = window.setTimeout(() => {
          map.once('moveend', onMoveEnd)
        }, 80)
        const fallbackTimer = window.setTimeout(finish, 780)
      })
    },
    [mapContext?.applyMapViewPaddingRef, mapContext?.mapInstanceRef]
  )

  const openFacilityInfoPreviewFromList = useCallback(
    (row: WtlFacilityListRow) => {
      if (title !== '설비관리' || layerGroupsMode !== 'equipment') {
        clearFacilityInfoPreview()
        void flyToGeomAndWait(row.geom)
        return
      }
      const reqId = ++facilityInfoPreviewReqRef.current
      setFacilityInfoPreview(null)
      const schema =
        String(selectedSource?.schema ?? 'layer').trim() || 'layer'
      void (async () => {
        try {
          const target = await resolveEquipmentFacilityInfoTarget(row, schema)
          if (reqId !== facilityInfoPreviewReqRef.current) return
          if (!target) {
            await flyToGeomAndWait(row.geom)
            return
          }
          const preview = await loadEquipmentFacilityInfoPreview(target)
          if (reqId !== facilityInfoPreviewReqRef.current) return
          if (!preview) {
            await flyToGeomAndWait(row.geom)
            return
          }
          await flyToGeomAndWait(preview.geom ?? row.geom)
          if (reqId !== facilityInfoPreviewReqRef.current) return
          setFacilityInfoPreview(preview)
        } catch {
          if (reqId !== facilityInfoPreviewReqRef.current) return
          setFacilityInfoPreview(null)
          await flyToGeomAndWait(row.geom)
        }
      })()
    },
    [
      clearFacilityInfoPreview,
      flyToGeomAndWait,
      layerGroupsMode,
      selectedSource?.schema,
      title,
    ]
  )

  const selectFacilityRow = useCallback(
    (row: WtlFacilityListRow | null, opts?: { fly?: boolean }) => {
      if (!row) {
        setSelectedId(null)
        setSelectedRow(null)
        clearFacilityInfoPreview()
        return
      }
      setSelectedId(row.id)
      setSelectedRow(row)
      claimFacilityHighlight()
      notifyLayerClickDetailMatchClose({
        tableNames: [row.tableName, row.fieldsTable, row.fieldsTableFallback, row.layerKey],
        fieldsTable: row.fieldsTable,
        fieldsTableFallback: row.fieldsTableFallback,
        record: row.record,
        ogcFid: row.ogcFid,
      })
      if (opts?.fly) {
        openFacilityInfoPreviewFromList(row)
      } else {
        clearFacilityInfoPreview()
      }
    },
    [
      claimFacilityHighlight,
      clearFacilityInfoPreview,
      openFacilityInfoPreviewFromList,
    ]
  )

  useWtlFacilityMapClick({
    source: selectedSource
      ? { tableName: selectedSource.tableName, schema: selectedSource.schema }
      : null,
    tab,
    onSelect: (row) => selectFacilityRow(row),
  })

  /** 전역 클릭 상세 제외용 — 직접 레이어만 등록(연관은 전역 상세 허용) */
  useEffect(() => {
    const slot: LayerClickDetailMatchCloseDirectSlot =
      layerGroupsMode === 'equipment' ? 'wtlEquipment' : 'wtlFacility'
    const names = selectedSource
      ? [selectedSource.tableName, tab]
          .map((v) => String(v ?? '').trim())
          .filter(Boolean)
      : null
    setLayerClickDetailMatchCloseDirectNames(slot, names)
    return () => {
      clearLayerClickDetailMatchCloseDirectNames(slot)
    }
  }, [layerGroupsMode, selectedSource?.tableName, tab])

  /** 그룹 API가 완료된 탭 — 로딩 중·탭 불일치 시 visible sync 생략 */
  const groupsReadyTabRef = useRef<string | null>(null)
  /** 연관 초기 ON 반영 후에만 visible sync (직접만 먼저 켜는 2단 적용 방지) */
  const [visibleSyncReady, setVisibleSyncReady] = useState(false)

  const onTotalWidthChangeRef = useRef(onTotalWidthChange)
  onTotalWidthChangeRef.current = onTotalWidthChange
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  /** 닫기 중 — 패널을 먼저 내리고 무거운 언마운트는 뒤로 (레이어는 유지) */
  const closingRef = useRef(false)
  const [isClosing, setIsClosing] = useState(false)

  /** 콜백 참조만 ref — deps에 넣으면 부모 리렌더 루프. Strict Mode 정리(0) 후에도 totalWidth로 재통지 */
  useEffect(() => {
    if (closingRef.current) return
    onTotalWidthChangeRef.current(totalWidth)
  }, [totalWidth])

  useEffect(() => {
    return () => onTotalWidthChangeRef.current(0)
  }, [])

  /**
   * 닫기 체감 지연 완화:
   * 1) 폭 0·트리 null로 화면에서 즉시 제거
   * 2) 목록·상세·미리보기 비워 언마운트 비용 축소
   * 3) 다음 프레임에 opened 해제(부모)
   */
  const handlePanelClose = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setIsClosing(true)
    onTotalWidthChangeRef.current(0)
    facilityInfoPreviewReqRef.current += 1
    setFacilityInfoPreview(null)
    setSelectedId(null)
    setSelectedRow(null)
    setRows([])
    setTotal(0)
    requestAnimationFrame(() => {
      onCloseRef.current()
    })
  }, [])

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

  const relatedOnKey = useMemo(
    () => [...relatedOn].sort().join('\0'),
    [relatedOn]
  )

  /**
   * 직접 매칭 + 관련 설비·시설 버튼 ON/OFF → visibleLayerNames.
   * - 토글 대상만 가감한다(관로·이미 켜진 다른 레이어는 건드리지 않음).
   * - 버튼으로 끈 관련 설비·시설만 끈다.
   */
  useEffect(() => {
    const setVisible = mapContext?.setVisibleLayerNames
    if (!setVisible) return
    if (closingRef.current) return
    if (!visibleSyncReady) return
    const direct = String(selectedSource?.tableName ?? '')
      .trim()
      .toLowerCase()
    if (!direct) return
    if (!tab || groupsReadyTabRef.current !== tab) return

    const onSet = new Set(relatedOnKey ? relatedOnKey.split('\0') : [])
    const toggleable = toggleableRelatedKey
      ? toggleableRelatedKey.split('\0')
      : []

    setVisible((prev) => {
      const next = new Set(prev)
      next.add(direct)
      for (const name of toggleable) {
        if (onSet.has(name)) next.add(name)
        else next.delete(name)
      }
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
  }, [
    mapContext?.setVisibleLayerNames,
    selectedSource?.tableName,
    relatedOnKey,
    tab,
    toggleableRelatedKey,
    visibleSyncReady,
  ])

  /**
   * 관로 — 탭·그룹 확정 시에만 ON.
   * 관련 설비·시설 버튼 토글마다 관로를 다시 켜지 않는다.
   */
  useEffect(() => {
    const setVisible = mapContext?.setVisibleLayerNames
    if (!setVisible) return
    if (closingRef.current) return
    if (!visibleSyncReady) return
    const direct = String(selectedSource?.tableName ?? '')
      .trim()
      .toLowerCase()
    if (!direct) return
    if (!tab || groupsReadyTabRef.current !== tab) return

    const pipes = pipeRelatedKey ? pipeRelatedKey.split('\0') : []
    if (pipes.length === 0) return

    setVisible((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const name of pipes) {
        if (!next.has(name)) {
          next.add(name)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [
    mapContext?.setVisibleLayerNames,
    selectedSource?.tableName,
    tab,
    pipeRelatedKey,
    visibleSyncReady,
  ])

  /** 탭 변경 시 목록·필터·연관 레이어 초기화 + DB에 있는 레이어 그룹만 조회 */
  useEffect(() => {
    setKeywordDraft('')
    setKeyword('')
    setSelectedId(null)
    setSelectedRow(null)
    setRows([])
    setTotal(0)
    setError(null)
    setLoading(Boolean(tab && isTabEnabled(tab)))
    loadSourceKeyRef.current = ''
    clearLocationFilters()
    setRelatedOn(new Set())
    setVisibleSyncReady(false)
    groupsReadyTabRef.current = null
    if (!tab || !isTabEnabled(tab)) {
      setGroupOptions([])
      setGroup('')
      setGroupsLoading(false)
      setLoading(false)
      return
    }
    let cancelled = false
    // 이전 그룹을 비우지 않음 — selectedSource null 전환으로 visible 점멸 방지
    setGroupsLoading(true)
    const requestTab = tab
    const keepGroupHint = group
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
        const nextGroup =
          opts.find((o) => o.group === keepGroupHint)?.group ??
          opts[0]?.group ??
          ''
        const nextOpt =
          opts.find((o) => o.group === nextGroup) ?? opts[0] ?? null
        const related = resolveRelatedLayers(
          requestTab,
          nextOpt?.defineTableGroup || nextOpt?.group || null
        )
        // 연관 전부 ON 후 sync ready — visible·지하시설물 1회 반영
        setRelatedOn(new Set(related.map((l) => l.tableName)))
        groupsReadyTabRef.current = requestTab
        setGroupOptions(opts)
        setGroup(nextGroup)
        setVisibleSyncReady(true)
      })
      .catch(() => {
        if (cancelled) return
        groupsReadyTabRef.current = requestTab
        setRelatedOn(new Set())
        setGroupOptions([])
        setGroup('')
        setLoading(false)
        // 실패 시에도 ready — 빈 목록/안내로 전환 (로딩 고착 방지)
        setVisibleSyncReady(true)
      })
      .finally(() => {
        if (!cancelled) setGroupsLoading(false)
      })
    return () => {
      cancelled = true
    }
    // isTabEnabled·clearLocationFilters는 참조 불안정 → tab·mode만 의존 (루프·레이어 깜빡임 방지)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, layerGroupsMode])

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
    })()
    return () => {
      cancelled = true
    }
  }, [emdSelected, riSelected, showLocationFilter, supplyBlock])

  /** 행정경계 + 구역설정 → 지도 공간필터 */
  useEffect(() => {
    if (!showLocationFilter) {
      mapContext?.setSpatialFilterWkt?.(null)
      return
    }
    const wkts = effectiveAreaWkts5181
    if (wkts.length === 0) {
      mapContext?.setSpatialFilterWkt?.(null)
      return
    }
    let cancelled = false
    ;(async () => {
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
  }, [effectiveAreaWkts5181, mapContext?.setSpatialFilterWkt, showLocationFilter])

  useEffect(() => {
    return () => {
      mapContext?.setSpatialDrawRequest?.(null)
      mapContext?.setSpatialFilterWkt?.(null)
    }
  }, [mapContext?.setSpatialDrawRequest, mapContext?.setSpatialFilterWkt])

  const handleZoneTool = useCallback(() => {
    const setDraw = mapContext?.setSpatialDrawRequest
    if (zoneDrawing) {
      setDraw?.(null)
      setZoneDrawing(false)
      return
    }
    if (zoneWkt5181) {
      setZoneWkt5181(null)
      return
    }
    if (!setDraw) return
    if (!canStartMapDrawInteraction(mapContext, 'spatialSearch')) return
    setZoneDrawing(true)
    setDraw({
      type: 'polygon',
      onComplete: (wkt5181: string) => {
        const w = String(wkt5181 ?? '').trim()
        setZoneDrawing(false)
        if (w) setZoneWkt5181(w)
      },
    })
  }, [mapContext, zoneDrawing, zoneWkt5181])

  const zoneToolLabel = zoneDrawing
    ? '구역취소'
    : zoneWkt5181
      ? '구역해제'
      : '구역설정'

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
            showLocationFilter && effectiveAreaWkts5181.length > 0
              ? effectiveAreaWkts5181
              : null,
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
  }, [effectiveAreaWkts5181, keyword, selectedSource, showLocationFilter, sorts])

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
          showLocationFilter && effectiveAreaWkts5181.length > 0
            ? effectiveAreaWkts5181
            : null,
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
  }, [
    effectiveAreaWkts5181,
    keyword,
    loading,
    selectedSource,
    showLocationFilter,
    sorts,
  ])

  const handleExcelExport = useCallback(async () => {
    if (!selectedSource || excelExporting) return
    setExcelExporting(true)
    try {
      const pageSize = 500
      const allRows: WtlFacilityListRow[] = []
      let offset = 0
      let totalCount = Number.POSITIVE_INFINITY
      while (offset < totalCount) {
        const res = await call('', 'POST', {
          service: 'wtlFacilityService',
          action: 'listFacilityRows',
          params: {
            table: selectedSource.tableName,
            schema: selectedSource.schema,
            keyword,
            areaWkts5181:
              showLocationFilter && effectiveAreaWkts5181.length > 0
                ? effectiveAreaWkts5181
                : null,
            sorts,
            limit: pageSize,
            offset,
          },
        })
        const data = (res?.data ?? res) as
          | { rows?: WtlFacilityListRow[]; total?: number }
          | undefined
        const page = Array.isArray(data?.rows) ? data.rows : []
        totalCount = Number(data?.total ?? 0) || 0
        allRows.push(...page)
        if (page.length === 0) break
        offset += page.length
        if (offset >= totalCount) break
      }
      if (allRows.length === 0) {
        window.alert('내보낼 목록이 없습니다.')
        return
      }
      const sample = allRows[0]
      const bundle = await loadWtlDefineDisplayBundle(
        sample?.fieldsTable ?? selectedSource.tableName,
        sample?.fieldsTableFallback ?? null
      )
      exportWtlFacilityExcel({
        rows: allRows,
        fields: bundle.fields,
        codesByField: bundle.codesByField,
        sheetName: title,
        title,
        fileName: undefined,
      })
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '엑셀 내려받기에 실패했습니다.')
    } finally {
      setExcelExporting(false)
    }
  }, [
    excelExporting,
    selectedSource,
    keyword,
    showLocationFilter,
    effectiveAreaWkts5181,
    sorts,
    title,
  ])

  const handleShpExport = useCallback(async () => {
    if (!selectedSource || shpExporting) return
    setShpExporting(true)
    try {
      const res = await fetch('/api/download/wtl-facility-shp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: selectedSource.tableName,
          schema: selectedSource.schema,
          keyword,
          areaWkts5181:
            showLocationFilter && effectiveAreaWkts5181.length > 0
              ? effectiveAreaWkts5181
              : null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(
          typeof data?.error === 'string' ? data.error : 'SHP 다운로드 실패'
        )
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') ?? ''
      const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd)
      const rawName = m?.[1] ? decodeURIComponent(m[1]) : m?.[2]
      const fileName = rawName?.trim() || '시설목록_SHP.zip'
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = fileName
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(a.href)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'SHP 다운로드 실패')
    } finally {
      setShpExporting(false)
    }
  }, [
    shpExporting,
    selectedSource,
    keyword,
    showLocationFilter,
    effectiveAreaWkts5181,
  ])

  /**
   * 그룹·탭이 맞춰진 뒤에만 목록 조회.
   * 탭 전환 직후 이전 selectedSource로 재조회되거나, 목록만 비운 채 조회가 스킵되는 것을 막음.
   */
  useEffect(() => {
    if (!visibleSyncReady) return
    if (!tab || groupsReadyTabRef.current !== tab) return
    void loadRows()
  }, [loadRows, tab, visibleSyncReady])

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
    setRelatedOn(new Set(relatedLayers.map((l) => l.tableName)))
    clearLocationFilters()
  }

  const handleTabClick = (name: string) => {
    if (!isTabEnabled(name)) return
    setTab(name)
  }

  const toggleRelatedLayer = useCallback(
    (tableName: string) => {
      const key = String(tableName ?? '')
        .trim()
        .toLowerCase()
      if (!key) return
      // 관로는 버튼 없음·항상 ON — 토글 대상에서 제외
      if (!toggleableRelatedNames.includes(key)) return
      setRelatedOn((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    },
    [toggleableRelatedNames]
  )

  if (isClosing) return null

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
                onClick={handlePanelClose}
                aria-label="닫기"
                title="닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="standard-filter-section shrink-0 border-b-1 !pb-[13px]">
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  {catalog.tabs
                    .filter((name) => isTabEnabled(name))
                    .map((name) => {
                      const on = tab === name
                      const label = catalog.tabLabel(name) || name
                      return (
                        <button
                          key={name}
                          type="button"
                          data-facility-tab={name}
                          title={label}
                          className={cn(
                            RELATED_BTN,
                            '!w-auto !min-w-0 !max-w-none px-2',
                            on ? RELATED_BTN_ON : RELATED_BTN_OFF
                          )}
                          onClick={() => handleTabClick(name)}
                        >
                          <span className="min-w-0 truncate [word-break:keep-all]">
                            {label}
                          </span>
                        </button>
                      )
                    })}
                </div>
                {tab && isTabEnabled(tab) && groupOptions.length > 0 ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1">
                      <span className="standard-detail-hit-label w-16 !text-foreground">
                        레이어 그룹
                      </span>
                      <select
                        className="standard-detail-hit-select"
                        value={group || groupOptions[0]?.group || ''}
                        title="레이어 그룹"
                        aria-label="레이어 그룹"
                        onChange={(e) => {
                          const next = e.target.value
                          const opt =
                            groupOptions.find((o) => o.group === next) ?? null
                          const related = resolveRelatedLayers(
                            tab,
                            opt?.defineTableGroup || opt?.group || null
                          )
                          setVisibleSyncReady(false)
                          setRelatedOn(new Set(related.map((l) => l.tableName)))
                          setGroup(next)
                          setSelectedId(null)
                          setSelectedRow(null)
                          setVisibleSyncReady(true)
                        }}
                      >
                        {groupOptions.map((opt) => (
                          <option key={opt.group} value={opt.group}>
                            {opt.group}
                          </option>
                        ))}
                      </select>
                    </div>
                    {relatedLayerGroupsForUi.length > 0 ? (
                      <div className="space-y-1.5" aria-label="연관 레이어">
                        {relatedLayerGroupsForUi.map((group) => (
                          <div
                            key={group.category}
                            className="flex items-start gap-1"
                          >
                            <span
                              className="standard-detail-hit-label mt-1 w-16 shrink-0 !text-foreground"
                              title={group.category}
                            >
                              {group.category}
                            </span>
                            <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                              {group.layers.map((item) => {
                                const on = relatedOn.has(item.tableName)
                                const count =
                                  relatedFacilityCounts?.[item.tableName]
                                const countText =
                                  typeof count === 'number' ? ` (${count})` : ''
                                const label = `${item.korName}${countText}`
                                return (
                                  <button
                                    key={item.tableName}
                                    type="button"
                                    title={label}
                                    className={cn(
                                      RELATED_BTN,
                                      on ? RELATED_BTN_ON : RELATED_BTN_OFF
                                    )}
                                    onClick={() =>
                                      toggleRelatedLayer(item.tableName)
                                    }
                                  >
                                    <WtlLayerMark layerKey={item.tableName} />
                                    <span className="min-w-0 truncate [word-break:keep-all]">
                                      {label}
                                    </span>
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        ))}
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
                        <button
                          type="button"
                          title={zoneToolLabel}
                          aria-label={zoneToolLabel}
                          aria-pressed={zoneDrawing || Boolean(zoneWkt5181)}
                          onClick={handleZoneTool}
                          className={cn(
                            'inline-flex h-7 shrink-0 cursor-pointer items-center gap-0.5 rounded border px-1.5 text-[11px] font-medium transition-colors',
                            zoneDrawing || zoneWkt5181
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border bg-background text-muted-foreground hover:border-border hover:text-foreground'
                          )}
                        >
                          <Pentagon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                          {zoneToolLabel}
                        </button>
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
              {tab && isTabEnabled(tab) && (selectedSource || groupsLoading || !visibleSyncReady) ? (
                <WtlFacilityListView
                  rows={
                    visibleSyncReady && groupsReadyTabRef.current === tab
                      ? rows
                      : []
                  }
                  total={
                    visibleSyncReady && groupsReadyTabRef.current === tab
                      ? total
                      : 0
                  }
                  loading={loading || groupsLoading || !visibleSyncReady}
                  loadingMore={loadingMore}
                  error={
                    visibleSyncReady && groupsReadyTabRef.current === tab
                      ? error
                      : null
                  }
                  fieldsTable={
                    visibleSyncReady && groupsReadyTabRef.current === tab
                      ? fieldsTable
                      : null
                  }
                  fieldsTableFallback={
                    visibleSyncReady && groupsReadyTabRef.current === tab
                      ? fieldsTableFallback
                      : null
                  }
                  selectedId={
                    visibleSyncReady && groupsReadyTabRef.current === tab
                      ? selectedId
                      : null
                  }
                  onSelect={(row) => selectFacilityRow(row, { fly: true })}
                  onScrollNearEnd={loadMoreRows}
                  scrollLoadThresholdPx={LIST_SCROLL_LOAD_THRESHOLD_PX}
                  sorts={sorts}
                  onToggleSort={toggleListSort}
                  onShpDownload={() => void handleShpExport()}
                  onExcelDownload={() => void handleExcelExport()}
                  shpBusy={shpExporting}
                  excelBusy={excelExporting}
                  relatedFacilityCounts={null}
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
        <div
          className="pointer-events-auto shrink-0"
          onPointerDownCapture={claimFacilityHighlight}
        >
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
              showFacilityInfoLink={title === '설비관리' || title === '이력관리'}
              showHistoryCard={title === '설비관리' || title === '이력관리'}
              serviceName={title}
              onClose={() => {
                setSelectedId(null)
                setSelectedRow(null)
                clearFacilityInfoPreview()
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
                clearFacilityInfoPreview()
              }}
              onHistoryReverted={() => {
                void loadRows()
              }}
            />
          </MapSideListPanel>
        </div>
      )}

      {facilityInfoPreview ? (
        <WtlFacilityInfoPreviewFloat
          preview={facilityInfoPreview}
          onClose={clearFacilityInfoPreview}
        />
      ) : null}
    </>
  )
}
