'use client'

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ChevronLeft,
  Crosshair,
  Pin,
  Search,
  SquareArrowOutUpRight,
  X,
} from 'lucide-react'
import { call } from '@/lib/api'
import { appFetch } from '@/lib/basePath'
import { useSerWriteAccess } from '@/hooks/useSerWriteAccess'
import {
  formatBooleanYeobu,
  shouldUseBooleanCheckbox,
} from '@/lib/defineBooleanField'
import {
  formatDefineFieldDisplayValue,
  parseDefineBooleanValue,
} from '@/lib/defineLayerCodeDisplay'
import { MapDetailFloatingPanel } from '../../_mapComponents/MapDetailFloatingPanel'
import {
  MAP_DETAIL_FLOAT_MINIMIZED_WIDTH,
  computeMapDetailDockPin,
} from '../../_mapComponents/mapDetailFloatingDock'
import { getLegendUrl } from '../../_mapComponents/hooks/useFeatureIdentify'
import { cn } from '@/lib/utils'
import {
  getDefineFieldDisplayLabel,
  getRowValueByField,
  isDefineFieldFlagTrue,
  isGeomLikeDefineFieldName,
  selectDefineLayerDetailFields,
  selectDefineLayerListFields,
  type DefineFieldLike,
} from '../../_mapComponents/standard/defineLayerRowUtils'
import { useDefineLayerCodes } from '../../_mapComponents/standard/useDefineLayerCodes'
import { useMapContext } from '../../_mapComponents/MapContext'
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../_mapComponents/config/mapDefaults'
import {
  extent3857FromGeoJson4326,
  scheduleAnimateMapToCenter3857,
} from '../../_mapComponents/config/mapAutoNavigation'
import {
  WtlMappedFacilityFloating,
  type WtlMappedFacilityTarget,
} from '../wtlAdmin/facility/WtlFacilityRelatedDetailFloating'
import type { LayerClickHit } from './useLayerClickDetail'
import { claimMapLayerClickDetailHighlight } from '@/lib/mapLayerClickDetailHighlight'
import {
  pickLayerClickHitGeom,
  useLayerClickDetailMapHighlight,
} from './useLayerClickDetailMapHighlight'
import { LayerClickDetailRelatedTabs } from './LayerClickDetailRelatedTabs'
import { layerClickHitToNetworkRow } from './layerClickHitToNetworkRow'
import {
  buildFacilityInfoByFtrIdnTarget,
  lookupFacilityByShowTitleValue,
  shouldShowFacilityInfoSearch,
} from './layerClickFacilityInfo'
import { resolveWtlNetworkRowEditTarget } from '../wtlAdmin/networkMap/WtlNetworkMapAttachmentSection'
import { openLayerClickDetailBlank } from './openLayerClickDetailBlank'
import { recordDataViewLog } from '@/lib/recordDataViewLog'

const DETAIL_WIDTH = 'min(520px, calc(100vw - 2rem))'
const DETAIL_WIDTH_FALLBACK_PX = 520
/** 다중 레이어 선택 목록 — 우측 보기 버튼 공간 포함 */
const PICK_LIST_WIDTH = 'min(256px, calc(100vw - 2rem))'
const PICK_LIST_WIDTH_FALLBACK_PX = 256
/** 상세보기/간소화 보기 선택 — 브라우저 유지 */
const DETAIL_EXPANDED_STORAGE_KEY = 'ggnr.mapLayerClickDetail.expanded'
/** 최초 닫기 여부 — localStorage (브라우저 유지) */
const DETAIL_UI_TIP_STORAGE_KEY = 'ggnr.mapLayerClickDetail.uiTipSeen'
/** 최초 이후 세션당 1회 — sessionStorage */
const DETAIL_UI_TIP_SESSION_KEY = 'ggnr.mapLayerClickDetail.uiTipSessionSeen'
/** 최초 닫은 뒤 자동 닫힘(ms) */
const DETAIL_UI_TIP_MS = 8000

function readUiTipFirstClosed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(DETAIL_UI_TIP_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeUiTipFirstClosed(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DETAIL_UI_TIP_STORAGE_KEY, '1')
  } catch {
    /* ignore */
  }
}

function readUiTipSessionSeen(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(DETAIL_UI_TIP_SESSION_KEY) === '1'
  } catch {
    return false
  }
}

function writeUiTipSessionSeen(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(DETAIL_UI_TIP_SESSION_KEY, '1')
  } catch {
    /* ignore */
  }
}

/** null = 아직 저장 없음 */
function readDetailExpandedPref(): boolean | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(DETAIL_EXPANDED_STORAGE_KEY)
    if (raw === '1') return true
    if (raw === '0') return false
    return null
  } catch {
    return null
  }
}

function writeDetailExpandedPref(expanded: boolean) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DETAIL_EXPANDED_STORAGE_KEY, expanded ? '1' : '0')
  } catch {
    /* ignore */
  }
}

const PANEL_EDGE_PAD = 8
/** 기본정보 본문은 내용 높이 — 아래 값은 배치 추정·상한용 */
const SIMPLE_MAIN_ESTIMATE_PX = 160
const DETAIL_MAIN_ESTIMATE_PX = 350
/** 하단 연관 탭 본문(지도 기본 모달 200px) + 탭바·패딩 */
const DETAIL_RELATED_TABS_HEIGHT_PX = 200 + 48
/** 헤더+푸터 대략치 — 실측 전 좌하단 등 모서리 계산용 */
const SIMPLE_CHROME_HEIGHT_PX = 88
/** 상세보기 배치 추정 높이 — 기본정보(추정) + 탭 + 크롬 (사분면 배치용, 실제 maxHeight와 무관) */
const DETAIL_PANEL_HEIGHT_PX =
  DETAIL_MAIN_ESTIMATE_PX + DETAIL_RELATED_TABS_HEIGHT_PX + SIMPLE_CHROME_HEIGHT_PX
/** 상세·간소화 공통 화면 상한 — 내용이 적으면 줄어들고, 많으면 이 안에서 속성 스크롤 */
const DETAIL_MAX_HEIGHT = 'min(92vh, calc(100vh - 1.5rem))'
const PANEL_H_ESTIMATE_PX = SIMPLE_MAIN_ESTIMATE_PX + SIMPLE_CHROME_HEIGHT_PX

/**
 * 클릭점 기준 배치 — 기본 우하단, 자리 없으면 좌/상으로 뒤집기.
 * 반환값은 패널 좌상단.
 */
function computeQuadrantPanelTopLeft(
  clickX: number,
  clickY: number,
  viewportW: number,
  viewportH: number,
  panelW: number,
  panelH: number
): { top: number; left: number } {
  const spaceRight = viewportW - clickX - PANEL_EDGE_PAD
  const spaceBottom = viewportH - clickY - PANEL_EDGE_PAD
  const placeLeft = spaceRight < panelW
  const placeTop = spaceBottom < panelH
  let left = placeLeft ? clickX - panelW : clickX
  let top = placeTop ? clickY - panelH : clickY
  const maxLeft = Math.max(PANEL_EDGE_PAD, viewportW - panelW - PANEL_EDGE_PAD)
  const maxTop = Math.max(PANEL_EDGE_PAD, viewportH - panelH - PANEL_EDGE_PAD)
  return {
    left: Math.min(maxLeft, Math.max(PANEL_EDGE_PAD, left)),
    top: Math.min(maxTop, Math.max(PANEL_EDGE_PAD, top)),
  }
}

type Props = {
  open: boolean
  hits: LayerClickHit[]
  selected: LayerClickHit | null
  minimized: boolean
  onMinimizedChange: (minimized: boolean) => void
  focusToken?: number
  /** 클릭 화면 좌표 — 사분면별 모달 모서리 기준 */
  anchorLeftPx: number
  anchorTopPx?: number
  viewportW: number
  viewportH: number
  onSelectHit: (key: string) => void
  /** 다중 상세 → 레이어 선택 목록 */
  onBackToList?: () => void
  onClose: () => void
  onActivate?: () => void
  /** 새 창으로 분리된 킵 모달 */
  kept?: boolean
  /** 새 창으로 분리 (primary만). origin=현재 패널 좌상단 */
  onDetach?: (
    origin?: { top: number; left: number },
    hitKey?: string | null
  ) => void
  /**
   * true면 항상 목록(간소) 필드만 표시.
   * 하단 «상세보기»는 토글이 아니라 onOpenFullDetail 호출.
   * origin = 현재 패널 좌상단(우하단으로 키울 때 기준).
   */
  forceListOnly?: boolean
  onOpenFullDetail?: (origin?: { top: number; left: number }) => void
  /**
   * localStorage에 저장된 보기가 없을 때만 초기값을 간소화로 둔다.
   * 선택·조회 데이터가 바뀌어도 저장된 상세/간소화는 유지한다.
   */
  startAsSimple?: boolean
  /** true면 anchor를 패널 좌상단으로 사용(사분면 배치 생략) */
  placementAsTopLeft?: boolean
  /** 최소화 하단 도킹 슬롯 (여러 모달 겹침 방지) */
  dockIndex?: number
  dockLeftStartPx?: number
  /**
   * 지하시설물 가용 테이블명 집합.
   * 있으면 해당 집합에 속한 레이어만 상세 탭·Search 노출.
   * 미전달이면 탭·Search 비활성.
   */
  undergroundFacilityTableNames?: ReadonlySet<string> | null
  /** 쓰기 권한 검사 ser_eng (예: wtlNetworkMap, dataQuery). 없으면 수정 버튼 숨김 */
  writeSerEng?: string
  /** 속성 저장 후 선택 hit 갱신 */
  onSelectedUpdated?: (hit: LayerClickHit) => void
}

function parseFieldMaxLength(raw: unknown): number {
  const n = parseInt(String(raw ?? '').trim(), 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function hitLabel(hit: LayerClickHit): string {
  const title = hit.titleValue || '—'
  return hit.korName ? `${hit.korName} — ${title}` : title
}

/** 필드 로딩 — 속성 표 형태 스켈레톤 */
function LayerClickDetailAttrSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div
      className="standard-detail-attr-table w-full"
      aria-busy
      aria-label="속성 불러오는 중"
      title="속성 불러오는 중"
    >
      {Array.from({ length: Math.max(1, rows) }, (_, i) => (
        <div key={i} className="contents">
          <div className="standard-detail-attr-label standard-detail-attr-cell-border">
            <div
              className="h-3 animate-pulse rounded bg-muted"
              style={{ width: `${42 + ((i * 11) % 28)}%` }}
            />
          </div>
          <div className="standard-detail-attr-value standard-detail-attr-cell-border">
            <div
              className="h-3 animate-pulse rounded bg-muted/80"
              style={{ width: `${58 + ((i * 17) % 32)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export function LayerClickDetailFloating({
  open,
  hits,
  selected,
  minimized,
  onMinimizedChange,
  focusToken = 0,
  anchorLeftPx,
  anchorTopPx = 72,
  viewportW,
  viewportH,
  onSelectHit,
  onBackToList,
  onClose,
  onActivate,
  kept = false,
  onDetach,
  forceListOnly = false,
  onOpenFullDetail,
  startAsSimple = false,
  placementAsTopLeft = false,
  dockIndex = 0,
  dockLeftStartPx,
  undergroundFacilityTableNames = null,
  writeSerEng,
  onSelectedUpdated,
}: Props) {
  const mapContext = useMapContext()
  useLayerClickDetailMapHighlight(open ? selected : null)
  const canWrite = useSerWriteAccess(writeSerEng)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [uiTipVisible, setUiTipVisible] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [facilityInfo, setFacilityInfo] = useState<WtlMappedFacilityTarget | null>(
    null
  )
  const [facilityInfoCollapsed, setFacilityInfoCollapsed] = useState(false)
  const [facilityInfoAnchor, setFacilityInfoAnchor] = useState<{
    top: number
    left: number
  } | null>(null)
  const [facilityLookupBusy, setFacilityLookupBusy] = useState(false)
  const [facilityLookupError, setFacilityLookupError] = useState<string | null>(
    null
  )
  /** 다중 목록 하이라이트만 — 상세 전환과 분리 */
  const [listHighlightKey, setListHighlightKey] = useState<string | null>(null)
  /**
   * 상세 펼침·모달 오픈 직후 레이아웃 이동으로 Search가 오클릭되는 것 방지.
   * Date.now() 이전까지 시설 상세보기 클릭 무시.
   */
  const facilitySearchGuardUntilRef = useRef(0)
  const armFacilitySearchGuard = (ms = 450) => {
    facilitySearchGuardUntilRef.current = Date.now() + ms
  }
  /** false=목록(show_list) · true=상세(show_detail) — localStorage 유지 */
  const [detailExpanded, setDetailExpanded] = useState(() => {
    if (forceListOnly) return false
    const pref = readDetailExpandedPref()
    if (pref != null) return pref
    // 저장 없음 → 간소화 (startAsSimple 은 호환용, 기본과 동일)
    if (startAsSimple) return false
    return false
  })
  const viewModeKey = !forceListOnly && detailExpanded ? 'd' : 's'
  const pickListModeEarly = hits.length > 1 && !selected
  const panelWEstimatePx = pickListModeEarly
    ? PICK_LIST_WIDTH_FALLBACK_PX
    : DETAIL_WIDTH_FALLBACK_PX
  const panelHEstimatePx =
    viewModeKey === 'd' && !pickListModeEarly
      ? DETAIL_PANEL_HEIGHT_PX
      : PANEL_H_ESTIMATE_PX
  const estW = Math.min(panelWEstimatePx, Math.max(160, viewportW - 32))
  const estH = Math.min(panelHEstimatePx, Math.max(120, viewportH - 32))
  const [panelSize, setPanelSize] = useState({ w: estW, h: estH })
  /**
   * 실측 후 확정 위치. 추정 높이로 먼저 잠그면 클릭점에서 붕 떠 보임.
   * 앵커·간소화/상세 모드 변경 시 초기화. 연관탭 등 높이 증가 시에는 화면 안으로만 보정.
   */
  const [settledTopLeft, setSettledTopLeft] = useState<{
    top: number
    left: number
  } | null>(null)
  const settleAnchorKey = `${placementAsTopLeft ? 'tl' : 'q'}:${viewModeKey}:${anchorLeftPx}:${anchorTopPx ?? 72}:${viewportW}x${viewportH}`
  const [placementKey, setPlacementKey] = useState(settleAnchorKey)
  if (placementKey !== settleAnchorKey) {
    setPlacementKey(settleAnchorKey)
    setSettledTopLeft(null)
    setPanelSize({ w: estW, h: estH })
  }

  const handleActivate = () => {
    const map = mapContext?.mapInstanceRef?.current
    if (map) claimMapLayerClickDetailHighlight(map, 'layerClickDetail')
    onActivate?.()
  }

  const tableName = selected ? String(selected.tableName ?? '').trim() : ''
  const fieldsTableKey = selected
    ? String(selected.fieldsTable ?? selected.tableName ?? '').trim()
    : ''
  const [fields, setFields] = useState<DefineFieldLike[]>([])
  const [fieldsLoading, setFieldsLoading] = useState(false)
  const [fieldsTable, setFieldsTable] = useState('')
  /** 물리 컬럼명(소문자) → PG data_type — BOOLEAN 체크박스 판별 */
  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({})
  const [columnTypesReady, setColumnTypesReady] = useState(false)
  /** 고정창 분리 시 행 재조회 중 — 속성 스켈레톤 */
  const [keptRowRefetching, setKeptRowRefetching] = useState(false)
  const keptRowFetchedKeyRef = useRef<string | null>(null)

  const isUndergroundFacilityLayer = useMemo(() => {
    if (!undergroundFacilityTableNames || undergroundFacilityTableNames.size === 0) {
      return false
    }
    const availableLc = new Set(
      [...undergroundFacilityTableNames].map((s) =>
        String(s ?? '')
          .trim()
          .toLowerCase()
      )
    )
    const candidates = [tableName, fieldsTableKey]
      .map((s) => String(s ?? '').trim().toLowerCase())
      .filter(Boolean)
    return candidates.some((c) => availableLc.has(c))
  }, [undergroundFacilityTableNames, tableName, fieldsTableKey])

  const showUfDetailExtras = !forceListOnly && detailExpanded && isUndergroundFacilityLayer

  // 조회·선택 데이터 변경 시 상세/간소화를 바꾸지 않는다 (localStorage 유지).
  // forceListOnly만 강제 간소화.
  useEffect(() => {
    if (forceListOnly) setDetailExpanded(false)
  }, [forceListOnly])

  useEffect(() => {
    setFacilityInfo(null)
    setFacilityInfoAnchor(null)
    setFacilityLookupError(null)
    setFacilityLookupBusy(false)
    // 목록 클릭으로 모달이 커서 아래 뜰 때 잔여 클릭이 Search로 가는 것 방지
    armFacilitySearchGuard(500)
  }, [selected?.key, open])

  useEffect(() => {
    if (!open || selected) {
      setListHighlightKey(null)
      return
    }
    setListHighlightKey((prev) =>
      prev && hits.some((h) => h.key === prev) ? prev : hits[0]?.key ?? null
    )
  }, [open, selected, hits])

  const toggleDetailExpanded = () => {
    if (forceListOnly) return
    setDetailExpanded((prev) => {
      const next = !prev
      writeDetailExpandedPref(next)
      if (next) {
        // 상세 펼침 직후 높이·탭 추가로 Search가 클릭 위치에 생기는 오클릭 방지
        armFacilitySearchGuard(450)
      }
      return next
    })
    setFacilityInfo(null)
    setFacilityInfoAnchor(null)
    setFacilityLookupError(null)
  }

  useEffect(() => {
    if (!open || !fieldsTableKey) {
      setFields([])
      setFieldsTable('')
      setFieldsLoading(false)
      return
    }
    let cancelled = false
    setFieldsLoading(true)
    setFieldsTable(fieldsTableKey)
    void appFetch(`/api/config/defineLayer/fields/${encodeURIComponent(fieldsTableKey)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`fields ${r.status}`)
        return (await r.json()) as { data?: DefineFieldLike[] }
      })
      .then((body) => {
        if (cancelled) return
        setFields(Array.isArray(body?.data) ? body.data : [])
      })
      .catch(() => {
        if (!cancelled) setFields([])
      })
      .finally(() => {
        if (!cancelled) setFieldsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, fieldsTableKey])

  useEffect(() => {
    const physical = String(tableName || fieldsTableKey || '')
      .trim()
      .replace(/^.*\./, '')
      .toLowerCase()
    if (!open || !physical) {
      setColumnTypes({})
      setColumnTypesReady(false)
      return
    }
    let cancelled = false
    setColumnTypesReady(false)
    void call('', 'POST', {
      service: 'layerRowService',
      action: 'listTableColumnTypes',
      params: { table: physical, schema: 'layer' },
    })
      .then((res) => {
        if (cancelled) return
        const data = (res?.data ?? res) as
          | { columns?: Array<{ name?: string; dataType?: string }> }
          | undefined
        const next: Record<string, string> = {}
        for (const c of Array.isArray(data?.columns) ? data.columns : []) {
          const name = String(c?.name ?? '')
            .trim()
            .toLowerCase()
          const dataType = String(c?.dataType ?? '')
            .trim()
            .toLowerCase()
          if (name && dataType) next[name] = dataType
        }
        setColumnTypes(next)
        setColumnTypesReady(true)
      })
      .catch(() => {
        if (cancelled) return
        setColumnTypes({})
        setColumnTypesReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, tableName, fieldsTableKey, selected?.key])

  /** 고정창 — identify 복사본 대신 DB 행 재조회 */
  useEffect(() => {
    if (!open || !kept || !selected) {
      keptRowFetchedKeyRef.current = null
      setKeptRowRefetching(false)
      return
    }
    if (fieldsLoading || fields.length === 0) return
    if (keptRowFetchedKeyRef.current === selected.key) return

    const networkItem = layerClickHitToNetworkRow(selected)
    const target = resolveWtlNetworkRowEditTarget(networkItem, fields)
    if (!target) {
      keptRowFetchedKeyRef.current = selected.key
      setKeptRowRefetching(false)
      return
    }

    let cancelled = false
    keptRowFetchedKeyRef.current = selected.key
    setKeptRowRefetching(true)
    const baseHit = selected
    void call('', 'POST', {
      service: 'layerRowService',
      action: 'getTableRowForEdit',
      params: {
        table: target.table,
        schema: target.schema,
        keyValue: target.keyValue,
        keyField: target.keyField,
      },
    })
      .then((res) => {
        if (cancelled) return
        const data = (res?.data ?? res) as
          | { row?: Record<string, unknown> | null; error?: string }
          | undefined
        const row = data?.row
        if (!row || typeof row !== 'object' || data?.error) return
        onSelectedUpdated?.({
          ...baseHit,
          data: { ...baseHit.data, ...row },
        })
      })
      .catch(() => {
        /* 재조회 실패 시 identify 복사본 유지 */
      })
      .finally(() => {
        if (
          !cancelled &&
          keptRowFetchedKeyRef.current === baseHit.key
        ) {
          setKeptRowRefetching(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    open,
    kept,
    selected,
    fieldsLoading,
    fields,
    onSelectedUpdated,
  ])

  const listFields = useMemo(() => selectDefineLayerListFields(fields), [fields])
  const detailFields = useMemo(
    () => selectDefineLayerDetailFields(fields),
    [fields]
  )
  const useExpanded = !forceListOnly && detailExpanded
  const displayFields = useExpanded
    ? detailFields.length > 0
      ? detailFields
      : listFields
    : listFields
  const codeFallback =
    tableName && fieldsTable && tableName.toLowerCase() !== fieldsTable.toLowerCase()
      ? tableName
      : null
  const codesByField = useDefineLayerCodes(
    fieldsTable || null,
    // fields 전체 — 헤더 show_title(CODE) 한글화 포함
    (fields.length > 0 ? fields : displayFields) as Array<{
      define_field_name?: string
      define_field_type?: unknown
    }>,
    { fallbackTableName: codeFallback }
  )

  /** 헤더 title-below — define show_title 필드 값 (없으면 identify titleValue) */
  const headerShowTitleValue = useMemo(() => {
    if (!selected) return ''
    const titleField = fields.find((f) =>
      isDefineFieldFlagTrue(f.define_field_show_title)
    )
    if (titleField) {
      const key = String(titleField.define_field_name ?? '').trim()
      if (key) {
        const raw = getRowValueByField(selected.data, key)
        const formatted = formatDefineFieldDisplayValue(
          raw,
          titleField.define_field_type,
          codesByField[key.toLowerCase()],
          ''
        )
        if (formatted.trim()) return formatted.trim()
        if (raw != null && String(raw).trim()) return String(raw).trim()
      }
    }
    return String(selected.titleValue ?? '').trim()
  }, [selected, fields, codesByField])

  const pinPosition = useMemo(() => {
    if (!minimized) return null
    // 리스트·상세 패널 폭(mapPaddingLeft)이 늘면 하단 독도 같이 오른쪽으로 이동
    const padLeft = mapContext?.mapPaddingLeft ?? 0
    const dockLeftStart = Math.max(
      padLeft + 8,
      dockLeftStartPx ?? 0,
      8
    )
    return computeMapDetailDockPin({
      dockIndex,
      dockLeftStart,
      viewportW,
      viewportH,
    })
  }, [
    minimized,
    dockIndex,
    dockLeftStartPx,
    mapContext?.mapPaddingLeft,
    viewportW,
    viewportH,
  ])

  const provisionalTopLeft = useMemo(() => {
    if (placementAsTopLeft) {
      return { top: anchorTopPx ?? 72, left: anchorLeftPx }
    }
    return computeQuadrantPanelTopLeft(
      anchorLeftPx,
      anchorTopPx ?? 72,
      viewportW,
      viewportH,
      panelSize.w,
      panelSize.h
    )
  }, [
    placementAsTopLeft,
    anchorLeftPx,
    anchorTopPx,
    viewportW,
    viewportH,
    panelSize.w,
    panelSize.h,
  ])
  const panelTopLeft = settledTopLeft ?? provisionalTopLeft

  const sourceTableKey = String(fieldsTableKey || tableName)
    .trim()
    .toLowerCase()

  const selectedFtrIdn = useMemo(() => {
    if (!selected) return ''
    const fromRecord = getRowValueByField(selected.data, 'ftr_idn')
    return fromRecord != null ? String(fromRecord).trim() : ''
  }, [selected])

  type AttrRow = {
    key: string
    label: string
    value: string
    rawValue: unknown
    korName: unknown
    title: boolean
    facilitySearch: 'byFtrIdn' | 'byNameLookup' | null
    useBoolCheck: boolean
    boolChecked: boolean
    maxLength: number
    editable: boolean
  }

  const attrRows = useMemo(() => {
    if (!selected) {
      return [] as AttrRow[]
    }
    const record = selected.data
    if (displayFields.length > 0) {
      return displayFields.map((f, i) => {
        const key = String(f.define_field_name ?? '').trim() || `f-${i}`
        const label = getDefineFieldDisplayLabel(key, f.define_field_kor_name)
        const raw = getRowValueByField(record, key)
        const useBoolCheck = shouldUseBooleanCheckbox(
          f.define_field_type,
          columnTypes[key.toLowerCase()],
          columnTypesReady
        )
        const value = useBoolCheck
          ? formatBooleanYeobu(raw, '—')
          : formatDefineFieldDisplayValue(
              raw,
              f.define_field_type,
              codesByField[key.toLowerCase()],
              '—'
            )
        const facilitySearch =
          showUfDetailExtras
            ? shouldShowFacilityInfoSearch({
                sourceTableKey,
                fieldName: key,
                korName: f.define_field_kor_name,
                fields,
              })
            : null
        const isKey = isDefineFieldFlagTrue(
          (f as DefineFieldLike & { define_field_is_key?: unknown }).define_field_is_key
        )
        const readOnly =
          isKey ||
          isDefineFieldFlagTrue(
            (f as DefineFieldLike & { define_field_read_only?: unknown })
              .define_field_read_only
          ) ||
          isGeomLikeDefineFieldName(key)
        return {
          key,
          label,
          value,
          rawValue: raw,
          korName: f.define_field_kor_name,
          title: isDefineFieldFlagTrue(f.define_field_show_title),
          facilitySearch,
          useBoolCheck,
          boolChecked: useBoolCheck ? parseDefineBooleanValue(raw) : false,
          maxLength: parseFieldMaxLength(f.define_field_max_length),
          editable: Boolean(key) && !readOnly && !useBoolCheck,
        }
      })
    }
    if (fieldsLoading) return []
    return Object.entries(record)
      .filter(([k]) => !isGeomLikeDefineFieldName(k) && k.toLowerCase() !== 'gid')
      .map(([k, v], i) => ({
        key: k || `auto-${i}`,
        label: getDefineFieldDisplayLabel(k),
        value: formatDefineFieldDisplayValue(v, undefined, undefined, '—'),
        rawValue: v,
        korName: undefined as unknown,
        title: false,
        facilitySearch: null as 'byFtrIdn' | 'byNameLookup' | null,
        useBoolCheck: false,
        boolChecked: false,
        maxLength: 0,
        editable: false,
      }))
  }, [
    selected,
    displayFields,
    codesByField,
    fieldsLoading,
    showUfDetailExtras,
    sourceTableKey,
    fields,
    columnTypes,
    columnTypesReady,
  ])

  const packedAttrRows = useMemo(() => {
    type Pack = { cells: AttrRow[]; fullWidth: boolean }
    const out: Pack[] = []
    let pending: AttrRow[] = []
    for (const row of attrRows) {
      // 최대길이 100 이상 — 값 유무와 관계없이 행 전체 (빈 값도 100과 동일 판정)
      if (row.maxLength >= 100) {
        if (pending.length > 0) {
          out.push({ cells: pending, fullWidth: false })
          pending = []
        }
        out.push({ cells: [row], fullWidth: true })
        continue
      }
      pending.push(row)
      if (pending.length === 2) {
        out.push({ cells: pending, fullWidth: false })
        pending = []
      }
    }
    if (pending.length > 0) out.push({ cells: pending, fullWidth: false })
    return out
  }, [attrRows])

  const networkItem = useMemo(
    () => (selected ? layerClickHitToNetworkRow(selected) : null),
    [selected]
  )
  const editTarget = useMemo(() => {
    if (!networkItem || !fields.length) return null
    return resolveWtlNetworkRowEditTarget(networkItem, fields)
  }, [networkItem, fields])

  const viewLogServiceName =
    writeSerEng === 'wtlNetworkMap' ? '관망조회' : '데이터조회'

  // 데이터 이력관리에 조회 저장을 위해 추가
  // 레이어명 = 화면 레이어(define). fields 로딩 후 1회(키 확정)
  useEffect(() => {
    if (!open || !editTarget || !selected || fieldsLoading) return
    const logTable = String(selected.tableName ?? '')
      .trim()
      .replace(/^.*\./, '')
      .toLowerCase()
    if (!logTable) return
    recordDataViewLog({
      tableName: logTable,
      keyField: editTarget.keyField,
      keyValue: editTarget.keyValue,
      tableKorName: String(selected.korName ?? '').trim() || undefined,
      serviceName: viewLogServiceName,
    })
  }, [
    open,
    fieldsLoading,
    selected?.key,
    selected?.tableName,
    selected?.korName,
    editTarget?.keyField,
    editTarget?.keyValue,
    viewLogServiceName,
  ])

  const showEditButton =
    Boolean(writeSerEng) &&
    canWrite &&
    Boolean(selected?.data) &&
    Boolean(editTarget) &&
    detailExpanded &&
    !forceListOnly &&
    attrRows.some((r) => r.editable)

  useEffect(() => {
    setEditing(false)
    setDraft({})
    setEditError(null)
  }, [selected?.key])

  const beginEdit = useCallback(() => {
    if (!showEditButton || !selected?.data) return
    const next: Record<string, string> = {}
    for (const row of attrRows) {
      if (!row.editable) continue
      const raw = getRowValueByField(selected.data, row.key)
      next[row.key] = raw == null ? '' : String(raw)
    }
    setDraft(next)
    setEditError(null)
    setEditing(true)
  }, [showEditButton, selected, attrRows])

  const cancelEdit = useCallback(() => {
    setEditing(false)
    setDraft({})
    setEditError(null)
  }, [])

  const handleSave = useCallback(async () => {
    if (!selected || !editTarget || !selected.data) return
    setSaving(true)
    setEditError(null)
    try {
      const res = await call('', 'POST', {
        service: 'layerRowService',
        action: 'updateTableRowByKey',
        params: {
          table: editTarget.table,
          schema: editTarget.schema,
          keyValue: editTarget.keyValue,
          keyField: editTarget.keyField,
          changes: draft,
          includeHiddenDetail: false,
        },
      })
      const data = res?.data ?? res
      if (data?.error || data?.success === false) {
        setEditError(String(data?.error ?? '수정에 실패했습니다.'))
        return
      }
      const updated: LayerClickHit = {
        ...selected,
        data: { ...selected.data, ...draft },
      }
      onSelectedUpdated?.(updated)
      setEditing(false)
      setDraft({})
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : '수정에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }, [selected, editTarget, draft, onSelectedUpdated])

  const handleFacilitySearch = async (
    kind: 'byFtrIdn' | 'byNameLookup',
    fieldKey: string,
    korName: unknown,
    rawValue: unknown,
    anchor?: { top: number; left: number } | null
  ) => {
    if (Date.now() < facilitySearchGuardUntilRef.current) return
    setFacilityLookupError(null)
    setFacilityInfoAnchor(anchor ?? null)
    if (kind === 'byFtrIdn') {
      const target = buildFacilityInfoByFtrIdnTarget(
        fieldKey,
        korName,
        selectedFtrIdn,
        'layer'
      )
      if (!target) {
        setFacilityLookupError('시설 정보를 찾을 수 없습니다.')
        return
      }
      setFacilityInfo(target)
      setFacilityInfoCollapsed(false)
      return
    }
    const value = rawValue != null ? String(rawValue).trim() : ''
    setFacilityLookupBusy(true)
    try {
      const { target, error } = await lookupFacilityByShowTitleValue({
        value,
        schema: 'layer',
      })
      if (!target) {
        setFacilityLookupError(error || '일치하는 시설을 찾을 수 없습니다.')
        return
      }
      setFacilityInfo(target)
      setFacilityInfoCollapsed(false)
    } finally {
      setFacilityLookupBusy(false)
    }
  }

  const canToggleDetail =
    !forceListOnly && !fieldsLoading && detailFields.length > 0
  const showOpenFullDetail = forceListOnly && Boolean(onOpenFullDetail)

  const isSimpleView = !useExpanded

  useLayoutEffect(() => {
    if (!open || minimized) return
    const el = panelRef.current
    if (!el) return
    const measureAndSettle = () => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      if (w <= 0 || h <= 0) return
      setPanelSize((prev) =>
        prev.w === w && prev.h === h ? prev : { w, h }
      )
      if (placementAsTopLeft) return
      // 기본정보 높이=내용 → 필드 로드 후 실측 정착
      if (fieldsLoading) return
      setSettledTopLeft((prev) => {
        if (!prev) {
          return computeQuadrantPanelTopLeft(
            anchorLeftPx,
            anchorTopPx ?? 72,
            viewportW,
            viewportH,
            w,
            h
          )
        }
        // 상세·연관탭으로 키가 커져 하단이 잘리면 top/left만 화면 안으로 당김
        const maxLeft = Math.max(PANEL_EDGE_PAD, viewportW - w - PANEL_EDGE_PAD)
        const maxTop = Math.max(PANEL_EDGE_PAD, viewportH - h - PANEL_EDGE_PAD)
        const next = {
          left: Math.min(maxLeft, Math.max(PANEL_EDGE_PAD, prev.left)),
          top: Math.min(maxTop, Math.max(PANEL_EDGE_PAD, prev.top)),
        }
        if (next.left === prev.left && next.top === prev.top) return prev
        return next
      })
    }
    measureAndSettle()
    const raf = requestAnimationFrame(measureAndSettle)
    return () => cancelAnimationFrame(raf)
  }, [
    open,
    minimized,
    selected?.key,
    detailExpanded,
    forceListOnly,
    isSimpleView,
    showUfDetailExtras,
    attrRows.length,
    fieldsLoading,
    hits.length,
    placementAsTopLeft,
    placementKey,
    anchorLeftPx,
    anchorTopPx,
    viewportW,
    viewportH,
  ])

  const handleGoToLocation = () => {
    if (!selected) return
    const map = mapContext?.mapInstanceRef?.current
    if (!map) return
    const geom = pickLayerClickHitGeom(selected.data)
    const extent = extent3857FromGeoJson4326(geom)
    if (!extent) return
    const center: [number, number] = [
      (extent[0] + extent[2]) / 2,
      (extent[1] + extent[3]) / 2,
    ]
    const zoom = map.getView().getZoom() ?? MAP_AUTO_NAV_MAX_ZOOM
    scheduleAnimateMapToCenter3857(map, center, zoom, {
      duration: 450,
      applyMapViewPadding: () =>
        mapContext?.applyMapViewPaddingRef?.current?.(),
    })
  }

  const handleBackToList = () => {
    if (editing) cancelEdit()
    if (minimized) onMinimizedChange(false)
    onBackToList?.()
  }

  const dismissUiTip = useCallback(() => {
    setUiTipVisible(false)
    writeUiTipFirstClosed()
    writeUiTipSessionSeen()
  }, [])

  const pickListMode = hits.length > 1 && !selected

  // 최초(localStorage 없음): 닫기까지 유지.
  // 이후: 세션당 1회·8초 자동 닫힘 (닫으면 같은 세션에 다시 안 뜸)
  // 다중 레이어 선택 목록에서는 표시하지 않음
  useEffect(() => {
    if (!open || kept || minimized || pickListMode) {
      setUiTipVisible(false)
      return
    }
    const firstClosed = readUiTipFirstClosed()
    if (!firstClosed) {
      setUiTipVisible(true)
      return
    }
    if (readUiTipSessionSeen()) {
      setUiTipVisible(false)
      return
    }
    setUiTipVisible(true)
    const t = window.setTimeout(() => {
      setUiTipVisible(false)
      writeUiTipSessionSeen()
    }, DETAIL_UI_TIP_MS)
    return () => {
      window.clearTimeout(t)
    }
  }, [open, kept, minimized, pickListMode])

  if (!open || hits.length === 0) return null

  const multi = hits.length > 1
  const layerLine = selected ? String(selected.korName ?? '').trim() : ''
  // 상세(단일·다중): 현재 선택 레이어 제목. 목록 최소화만 N건
  const titleLine = pickListMode
    ? minimized
      ? `${hits.length}건`
      : '레이어 선택'
    : headerShowTitleValue || '—'
  const showLayer =
    !pickListMode && Boolean(layerLine && layerLine !== titleLine)

  const placementReady = placementAsTopLeft || settledTopLeft != null || minimized

  const uiTipOverlay =
    uiTipVisible && !minimized && !pickListMode ? (
      <div
        className="pointer-events-none absolute left-0 top-0 z-10 -translate-x-full pr-1"
        role="status"
      >
        <div className="pointer-events-auto flex max-w-[min(420px,calc(100vw-2rem))] items-start gap-2 rounded-[5px] border border-amber-200 bg-amber-50/95 px-3 py-1.5 text-[12px] font-medium text-amber-900 shadow-md">
          <div className="min-w-0 space-y-0.5 whitespace-normal">
            <p className="m-0">제목을 두 번 클릭하면 최소화됩니다</p>
            <p className="m-0">제목을 끌면 창을 옮길 수 있습니다</p>
            <p className="m-0">
              헤더에서 고정창·새 창으로 열 수 있습니다
            </p>
          </div>
          <button
            type="button"
            title="튜토리얼 닫기"
            aria-label="튜토리얼 닫기"
            className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded p-0.5 text-amber-900 hover:bg-amber-200/50"
            onClick={dismissUiTip}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
    ) : null

  return (
    <>
    <MapDetailFloatingPanel
      key={
        placementAsTopLeft
          ? 'tl'
          : settledTopLeft
            ? `s-${settledTopLeft.left}-${settledTopLeft.top}`
            : `p-${placementKey}`
      }
      layer={showLayer ? layerLine : null}
      title={titleLine}
      minimized={minimized}
      onMinimizedChange={onMinimizedChange}
      onClose={onClose}
      pinPosition={pinPosition}
      focusToken={focusToken}
      onActivate={handleActivate}
      panelRef={panelRef}
      overlay={uiTipOverlay}
      width={pickListMode ? PICK_LIST_WIDTH : DETAIL_WIDTH}
      minimizedWidth={MAP_DETAIL_FLOAT_MINIMIZED_WIDTH}
      maxHeight={DETAIL_MAX_HEIGHT}
      defaultPosition={{ top: panelTopLeft.top, left: panelTopLeft.left }}
      flushViewportClamp={!placementAsTopLeft}
      variant={pickListMode ? 'mapFloat' : 'default'}
      className={placementReady ? undefined : 'invisible'}
      hideHeading={false}
      headerStart={
        <>
          {multi && selected && onBackToList ? (
            <button
              type="button"
              title="레이어 선택으로"
              aria-label="레이어 선택으로"
              onClick={handleBackToList}
              className="standard-panel-close mr-0.5 cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
          {kept ? (
            <span
              className="mr-1 inline-flex shrink-0 items-center text-primary"
              title="분리된 창"
              aria-label="분리된 창"
            >
              <Pin className="h-3.5 w-3.5" aria-hidden />
            </span>
          ) : null}
        </>
      }
      headerLeading={null}
      headerActionsAlways={
        selected ? (
          <button
            type="button"
            title="위치 이동"
            aria-label="위치 이동"
            onClick={handleGoToLocation}
            className={
              minimized
                ? 'standard-panel-close cursor-pointer'
                : 'standard-detail-hdr-btn cursor-pointer'
            }
          >
            <Crosshair className="h-3.5 w-3.5" aria-hidden />
            {minimized ? null : '위치 이동'}
          </button>
        ) : null
      }
      onHeaderOpenInScreen={
        selected && !kept && onDetach
          ? () => {
              const el = panelRef.current
              const rect = el?.getBoundingClientRect()
              const origin =
                rect && rect.width > 0 && rect.height > 0
                  ? {
                      top: Math.round(rect.top),
                      left: Math.round(rect.left),
                    }
                  : undefined
              onDetach(origin)
            }
          : undefined
      }
      onHeaderOpenInNewWindow={
        selected
          ? () => {
              openLayerClickDetailBlank(selected, fields)
            }
          : undefined
      }
      headerActions={
        pickListMode && !minimized ? (
          <span
            className="shrink-0 px-1 text-[10px] tabular-nums text-slate-500 dark:text-white/60"
            title={`${hits.length}건`}
          >
            {hits.length}건
          </span>
        ) : null
      }
    >
      {pickListMode ? (
        <div className="scrollbar-thin max-h-[240px] min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1">
          <ul className="m-0 list-none p-0" role="listbox" aria-label="레이어 선택">
            {hits.map((hit) => {
              const label = hitLabel(hit)
              const legendSrc = getLegendUrl(hit.tableName)
              const highlighted = listHighlightKey === hit.key
              return (
                <li key={hit.key} className="m-0 p-0">
                  <div
                    role="option"
                    aria-selected={highlighted}
                    title={label}
                    tabIndex={0}
                    onClick={() => {
                      setListHighlightKey(hit.key)
                      onSelectHit(hit.key)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setListHighlightKey(hit.key)
                        onSelectHit(hit.key)
                      }
                    }}
                    className="standard-map-float-row-hover flex w-full cursor-pointer items-center justify-between gap-2 py-0.5 pl-2 pr-2 text-left"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <img
                        src={legendSrc}
                        alt=""
                        className="h-5 w-5 shrink-0 rounded border border-slate-200 object-contain dark:border-white/20"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-slate-700 dark:text-white/90">
                        {hit.korName ? (
                          <>
                            <span>{hit.korName}</span>
                            {hit.titleValue ? (
                              <>
                                <span className="mx-1 text-slate-400 dark:text-white/40">
                                  |
                                </span>
                                <span className="text-slate-500 dark:text-white/60">
                                  {hit.titleValue}
                                </span>
                              </>
                            ) : null}
                          </>
                        ) : (
                          hit.titleValue || '—'
                        )}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        title="고정창으로 전환"
                        aria-label="고정창으로 전환"
                        onClick={(e) => {
                          e.stopPropagation()
                          setListHighlightKey(hit.key)
                          if (!onDetach) {
                            onSelectHit(hit.key)
                            return
                          }
                          const el = panelRef.current
                          const rect = el?.getBoundingClientRect()
                          const origin =
                            rect && rect.width > 0 && rect.height > 0
                              ? {
                                  top: Math.round(rect.top),
                                  left: Math.round(rect.left),
                                }
                              : undefined
                          onDetach(origin, hit.key)
                        }}
                        className="standard-map-float-header-close inline-flex h-6 w-6 items-center justify-center text-primary"
                      >
                        <Pin className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        title="새 창으로 보기"
                        aria-label="새 창으로 보기"
                        onClick={(e) => {
                          e.stopPropagation()
                          setListHighlightKey(hit.key)
                          openLayerClickDetailBlank(hit)
                        }}
                        className="standard-map-float-header-close inline-flex h-6 w-6 items-center justify-center text-primary"
                      >
                        <SquareArrowOutUpRight
                          className="h-3.5 w-3.5"
                          aria-hidden
                        />
                      </button>
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <>
      <div
        className={cn(
          'px-3 py-2 text-xs',
          isSimpleView
            ? 'h-auto shrink-0 grow-0'
            : 'min-h-0 flex-1 overflow-y-auto scrollbar-thin'
        )}
        style={isSimpleView ? { flex: 'none' } : undefined}
      >
        {fieldsLoading ||
        (kept &&
          selected &&
          (keptRowRefetching ||
            keptRowFetchedKeyRef.current !== selected.key)) ? (
          <LayerClickDetailAttrSkeleton
            rows={isSimpleView ? 5 : 10}
          />
        ) : attrRows.length === 0 ? (
          <p className="standard-detail-attr-empty">표시할 속성이 없습니다.</p>
        ) : (
          <table className="standard-detail-attr-table">
            <tbody>
              {packedAttrRows.map((pack, packIdx) => (
                <tr key={`pack-${packIdx}`}>
                  {pack.cells.map((row) => {
                    const tdColSpan = pack.fullWidth || pack.cells.length === 1 ? 3 : 1
                    return (
                      <Fragment key={row.key}>
                        <th
                          scope="row"
                          className="standard-detail-attr-label standard-detail-attr-cell-border"
                          title={row.label}
                        >
                          {row.label}
                        </th>
                        <td
                          colSpan={tdColSpan}
                          className={cn(
                            'standard-detail-attr-value standard-detail-attr-cell-border',
                            row.facilitySearch && !editing && 'flex items-center gap-1',
                            row.title
                              ? 'standard-detail-attr-value-title'
                              : 'text-foreground'
                          )}
                          title={editing && row.editable ? undefined : row.value}
                        >
                          {editing && row.editable ? (
                            <input
                              type="text"
                              title={row.label}
                              aria-label={row.label}
                              value={draft[row.key] ?? ''}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  [row.key]: e.target.value,
                                }))
                              }
                              className="standard-detail-input h-6 w-full min-w-0"
                            />
                          ) : row.useBoolCheck ? (
                            <input
                              type="checkbox"
                              className="pointer-events-none h-3.5 w-3.5 accent-primary"
                              title={row.value}
                              aria-label={row.label}
                              aria-readonly="true"
                              checked={row.boolChecked}
                              readOnly
                              tabIndex={-1}
                              onChange={() => {}}
                            />
                          ) : (
                            <span className="min-w-0 flex-1 break-all">{row.value}</span>
                          )}
                          {!editing && row.facilitySearch ? (
                            <button
                              type="button"
                              title="시설 상세보기"
                              aria-label="시설 상세보기"
                              disabled={facilityLookupBusy}
                              onPointerDown={(e) => {
                                e.stopPropagation()
                              }}
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                if (Date.now() < facilitySearchGuardUntilRef.current) {
                                  return
                                }
                                const rect = e.currentTarget.getBoundingClientRect()
                                const anchor =
                                  rect.width > 0 && rect.height > 0
                                    ? {
                                        top: Math.round(rect.top),
                                        left: Math.round(rect.left),
                                      }
                                    : null
                                void handleFacilitySearch(
                                  row.facilitySearch!,
                                  row.key,
                                  row.korName,
                                  row.rawValue,
                                  anchor
                                )
                              }}
                              className="ml-auto inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-primary hover:bg-primary/10 disabled:opacity-50"
                            >
                              <Search className="h-3.5 w-3.5" aria-hidden />
                            </button>
                          ) : null}
                        </td>
                      </Fragment>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {facilityLookupError ? (
          <p className="px-2 py-1 text-[11px] text-destructive" role="alert">
            {facilityLookupError}
          </p>
        ) : null}
        {editError ? (
          <p className="px-2 py-1 text-[11px] text-destructive" role="alert">
            {editError}
          </p>
        ) : null}
      </div>
      {showUfDetailExtras && selected && !editing ? (
        <LayerClickDetailRelatedTabs
          hit={selected}
          fields={fields}
          relatedChildAsModal
          relatedModalAnchorHostRef={panelRef}
          serviceName={viewLogServiceName}
        />
      ) : null}
      {showOpenFullDetail || canToggleDetail || showEditButton || editing ? (
        <div
          className={cn(
            'standard-detail-edit-footer gap-1',
            editing || showEditButton ? 'justify-between' : 'justify-start'
          )}
        >
          <div className="flex items-center gap-1">
            {showOpenFullDetail ? (
              <button
                type="button"
                title="상세보기"
                aria-label="상세보기"
                onClick={() => {
                  const el = panelRef.current
                  const rect = el?.getBoundingClientRect()
                  const origin =
                    rect && rect.width > 0 && rect.height > 0
                      ? {
                          top: Math.round(rect.top),
                          left: Math.round(rect.left),
                        }
                      : undefined
                  onOpenFullDetail?.(origin)
                }}
                className="standard-detail-hdr-btn cursor-pointer"
              >
                상세보기
              </button>
            ) : canToggleDetail && !editing ? (
              <button
                type="button"
                title={detailExpanded ? '간략보기' : '상세보기'}
                aria-label={detailExpanded ? '간략보기' : '상세보기'}
                onClick={toggleDetailExpanded}
                className="standard-detail-hdr-btn cursor-pointer"
              >
                {detailExpanded ? '간략보기' : '상세보기'}
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {editing ? (
              <>
                <button
                  type="button"
                  title="취소"
                  disabled={saving}
                  onClick={cancelEdit}
                  className="standard-detail-hdr-btn cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="button"
                  title={saving ? '저장 중…' : '저장'}
                  disabled={saving}
                  onClick={() => void handleSave()}
                  className="standard-detail-hdr-btn-save cursor-pointer"
                >
                  {saving ? '저장 중…' : '저장'}
                </button>
              </>
            ) : showEditButton ? (
              <button
                type="button"
                title="수정"
                onClick={beginEdit}
                className="standard-detail-hdr-btn cursor-pointer"
              >
                수정
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
        </>
      )}
    </MapDetailFloatingPanel>
    {facilityInfo ? (
      <WtlMappedFacilityFloating
        target={facilityInfo}
        serviceName={viewLogServiceName}
        onClose={() => {
          setFacilityInfo(null)
          setFacilityInfoAnchor(null)
        }}
        collapsed={facilityInfoCollapsed}
        onToggleCollapsed={() => setFacilityInfoCollapsed((v) => !v)}
        anchorPosition={facilityInfoAnchor}
      />
    ) : null}
    </>
  )
}