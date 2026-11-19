'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
} from 'react'
import { useSession } from 'next-auth/react'
import {
  ChevronDown,
  ChevronLeft,
  FileSpreadsheet,
  MapPinned,
  Loader2,
  Pentagon,
  RefreshCw,
  SquareSplitHorizontal,
  X,
} from 'lucide-react'
import { call } from '@/lib/api'
import { useConsoleMenuAccess } from '@/hooks/useConsoleMenuAccess'
import { hasAnyDevConsoleAccess } from '@/lib/consoleMenuAccess/client'
import { isSuperUser } from '@/lib/auth/superUser'
import {
  formatDefineFieldDisplayValue,
  isDefineFieldCodeType,
  type DefineCodeRow,
} from '@/lib/defineLayerCodeDisplay'
import { formatDetailScalarValue } from '@/lib/formatDetailScalar'
import { claimMapLayerClickDetailHighlight } from '@/lib/mapLayerClickDetailHighlight'
import { cn } from '@/lib/utils'
import { useMapContext } from '../../../_mapComponents/MapContext'
import { canStartMapDrawInteraction } from '../../../_mapComponents/mapDrawInteraction'
import { computeMapDetailDockPin } from '../../../_mapComponents/mapDetailFloatingDock'
import { MAP_FLOATING_DETAIL_CLOSE_EVENT } from '../../../_mapComponents/mapFloatingDetailEvent'
import { notifyLayerClickDetailMatchClose } from '../../layerClickDetail/notifyLayerClickDetailMatchClose'
import { LayerClickDetailFloating } from '../../layerClickDetail/LayerClickDetailFloating'
import type {
  LayerClickHit,
  LayerClickKeptEntry,
} from '../../layerClickDetail/useLayerClickDetail'
import { MapSideListPanel } from '../../../_mapComponents/MapSideListPanel'
import {
  FULL_STATS_WIDTH,
  STATS_VIEW_MODE_OPTIONS,
  WtlNetworkFullLayoutPanels,
  type WtlNetworkStatsViewMode,
} from './WtlNetworkFullLayoutPanels'
import {
  getDefineFieldDisplayLabel,
  getRowValueByField,
  selectDefineLayerListFields,
  type DefineFieldLike,
} from '../../../_mapComponents/standard/defineLayerRowUtils'
import {
  useWtlNetworkMapLayer,
  type WtlNetworkDetailRelatedLayer,
} from './useWtlNetworkMapLayer'
import {
  loadWtlDefineDisplayBundle,
  peekWtlDefineDisplayBundle,
  prefetchWtlDefineDisplayBundles,
} from './wtlNetworkDefineDisplayCache'
import { WtlNetworkMapStatus } from './WtlNetworkMapStatus'
import { exportWtlNetworkMapExcel } from './exportWtlNetworkMapExcel'
import {
  WtlNetworkExportMenu,
  type WtlNetworkExportLayerOption,
  type WtlNetworkExportScope,
  type WtlNetworkToolBtnVariant,
} from './WtlNetworkExportMenu'
import { useEnsureMapCenterInSggOnMount } from '../useEnsureMapCenterInSggOnMount'
import { centerMapOnWtlNetworkGeom, flyToWtlNetworkGeom } from './wtlNetworkMapFly'
import { WtlNetworkSectionPanel } from './section/WtlNetworkSectionPanel'
import { WtlNetworkSectionDrawGuide } from './section/WtlNetworkSectionDrawGuide'
import { useWtlNetworkSection } from './section/useWtlNetworkSection'
import { WtlLayerMark } from './WtlLayerMark'
import { getWtlNetLayerDef, isWtlNetZoneLayerKey } from './wtlNetworkLayerCatalog'
import {
  getWtlNetMapSource,
  getWtlNetMapSources,
  getWtlNetPhysicalTable,
  isWtlNetMapGroupedTable,
  listWtlPipeSplitItemsInGroup,
  pickDefaultWtlNetMapSourceId,
  setWtlNetMapSources,
  setWtlNetPhysicalBySource,
  wtlNetKorNameForTable,
  WTL_PIPE_SPLIT_LOGICAL_KEYS,
  type WtlNetMapSourceId,
  type WtlNetMapSourcePayload,
} from './wtlNetworkMapSources'
import { facilityTabLabel } from '../facility/wtlFacilityCatalog'
import adminTabsJson from '@/config/wtlAdmin/adminTabs.json'
import tablesJson from '@/config/defineLayer/tables.json'
import type {
  WtlNetworkFilterMeta,
  WtlNetworkRow,
  WtlNetworkStatusListFilter,
} from './wtlNetworkTypes'


const LIST_DEFAULT = 440
const LIST_MIN = 360
const LIST_MAX = 720
const RESULT_DEFAULT = 420
const RESULT_MIN = 320
const RESULT_MAX = 680
/** 테이블 나열 페이지 건수 */
const LIST_PAGE_SIZE = 7
/** 목록 표 — 행 7개 이상일 때만 적용 (미만은 내용 높이) */
const LIST_TABLE_MIN_HEIGHT_PX = 206
/** 하단 도구(단면도·SHP·Excel) 버튼 스타일 선택 저장 */
const TOOL_BTN_VARIANT_STORAGE_KEY = 'wtl-network-map-tool-btn-variant'
const TOOL_BTN_VARIANT_OPTIONS: {
  value: WtlNetworkToolBtnVariant
  label: string
}[] = [
  { value: 'legacy', label: '기존 UI' },
  { value: 'iconLabel', label: '아이콘+라벨 UI' },
  { value: 'iconLabelColor', label: '아이콘+라벨+색 UI' },
  { value: 'fullLayout', label: '플로팅 UI' },
]

/** 전체 UI 1단 탭 — 급수구역(출처 그룹 밖) */
const FULL_LAYOUT_ZONE_TAB = '__zone__'

/** 도구 버튼 크롬 — 전체 UI는 아이콘+라벨과 동일 */
function resolveToolUiVariant(
  variant: WtlNetworkToolBtnVariant
): Exclude<WtlNetworkToolBtnVariant, 'fullLayout'> {
  return variant === 'fullLayout' ? 'iconLabel' : variant
}

function readStoredToolBtnVariant(): WtlNetworkToolBtnVariant {
  if (typeof window === 'undefined') return 'legacy'
  try {
    const raw = window.localStorage.getItem(TOOL_BTN_VARIANT_STORAGE_KEY)
    if (
      raw === 'legacy' ||
      raw === 'iconLabel' ||
      raw === 'iconLabelColor' ||
      raw === 'fullLayout'
    ) {
      return raw
    }
  } catch {
    /* ignore */
  }
  return 'legacy'
}

function networkRowToLayerClickHit(row: WtlNetworkRow): LayerClickHit {
  const tableName = String(row.layerKey ?? '').trim()
  const fieldsTable = String(row.fieldsTable ?? tableName).trim() || tableName
  const kor =
    wtlNetKorNameForTable(tableName) ||
    wtlNetKorNameForTable(fieldsTable) ||
    tableName
  const data: Record<string, unknown> = {
    ...(row.record && typeof row.record === 'object' ? { ...row.record } : {}),
  }
  if (row.geom != null) data.geom = row.geom
  return {
    key: String(row.id),
    tableName,
    fieldsTable,
    korName: kor,
    titleValue: String(row.name ?? '').trim(),
    data,
  }
}

let networkKeepModalKeySeq = 0
function nextNetworkKeepModalKey(): string {
  networkKeepModalKeySeq += 1
  return `wtl-network-keep-${networkKeepModalKeySeq}`
}

/** 상세 탭·Search용 — hit 테이블명 집합 */
function undergroundTablesFromHits(hits: LayerClickHit[]): Set<string> {
  const s = new Set<string>()
  for (const hit of hits) {
    for (const v of [hit.tableName, hit.fieldsTable]) {
      const t = String(v ?? '')
        .trim()
        .toLowerCase()
      if (t) s.add(t)
    }
  }
  return s
}

type CommonDetailState = {
  /** null = 다중 hit 레이어 선택 목록 단계 */
  item: WtlNetworkRow | null
  hitRows: WtlNetworkRow[]
  placement: 'listCenter' | 'mapClick'
  anchor?: { top: number; left: number } | null
}

type LayerBoxSlot = {
  key: string
  layerKey: string
  label: string
  geomKind: 'point' | 'line' | 'area'
  mapSources: string[]
}

type LayerBoxData = {
  rows: WtlNetworkRow[]
  total: number
  page: number
}

/** tables.json 행에서 버튼에 쓰는 필드. name이 조회·범례 키 */
type DisplayItem = {
  define_table_name: string
  define_table_kor_name: string
}

/**
 * 상단 밑줄 탭.
 * define_table_name = 조회·범례 키 (tables.json, 소문자)
 * define_table_kor_name = 버튼 한글명
 *
 * 지도 표시 경로
 * - 지하시설물 동기화: 관로·상수시설·급수구역·계량기·기타
 * - 주제도 동기화: 보호구역
 */
/** 관로 탭 — 분할관로(parents %wtl_pipe_lm) 외 고정 항목 */
const GWANRO_FIXED_ITEMS: DisplayItem[] = [
  { define_table_name: 'wtl_sply_ls', define_table_kor_name: '급수관로' },
  { define_table_name: 'wtl_valv_ps', define_table_kor_name: '변류시설' },
  { define_table_name: 'wtl_manh_ps', define_table_kor_name: '상수맨홀' },
]

const GWANRO_PIPE_FALLBACK_ITEMS: DisplayItem[] = WTL_PIPE_SPLIT_LOGICAL_KEYS.map((key) => ({
  define_table_name: key,
  define_table_kor_name: wtlNetKorNameForTable(key) || key,
}))

/** 선택 출처 그룹 내 parents_layer LIKE '%wtl_pipe_lm' + 고정 항목 */
function buildGwanroItems(sourceId: string): DisplayItem[] {
  const src = getWtlNetMapSource(sourceId)
  const pipe = listWtlPipeSplitItemsInGroup(src?.tables ?? []).map((it) => ({
    define_table_name: it.key,
    define_table_kor_name: it.kor,
  }))
  return [...(pipe.length > 0 ? pipe : GWANRO_PIPE_FALLBACK_ITEMS), ...GWANRO_FIXED_ITEMS]
}

const DISPLAY_GROUPS: { title: string; items: DisplayItem[] }[] = [
  {
    title: '관로',
    items: [...GWANRO_PIPE_FALLBACK_ITEMS, ...GWANRO_FIXED_ITEMS],
  },
  {
    title: '상수시설',
    /** 시설관리 adminTabs.wtlFacility — 한글명은 tables.json */
    items: (Array.isArray(adminTabsJson.wtlFacility) ? adminTabsJson.wtlFacility : []).map(
      (raw) => {
        const name = String(raw ?? '')
          .trim()
          .toLowerCase()
        return {
          define_table_name: name,
          define_table_kor_name:
            facilityTabLabel(name) || wtlNetKorNameForTable(name) || name,
        }
      }
    ),
  },
  {
    title: '급수구역',
    items: [
      { define_table_name: 'wtl_wtsa_as', define_table_kor_name: '급수구역' },
      { define_table_name: 'wtl_wtssa_as', define_table_kor_name: '급수분구' },
      { define_table_name: 'wtl_wtsba_as', define_table_kor_name: '급수블록' },
    ],
  },
  {
    title: '계량기',
    items: [{ define_table_name: 'wtl_meta_ps', define_table_kor_name: '급수전계량기' }],
  },
  {
    title: '보호구역',
    items: [
      {
        define_table_name: 'lsmd_cont_um710_umi100',
        define_table_kor_name: '상수원 보호구역',
      },
      {
        define_table_name: 'lsmd_cont_um711_um1100',
        define_table_kor_name: '공장설립 제한지역',
      },
    ],
  },
  {
    title: '기타',
    items: [
      { define_table_name: 'wtl_leak_ps', define_table_kor_name: '누수지점 및 복구내역' },
      { define_table_name: 'wtl_task_as', define_table_kor_name: '상수 업데이트 내역' },
    ],
  },
]

type WtlNetLayerShowMode = 'underground' | 'thematic'

const LAYER_SHOW_MODE_BY_GROUP: Record<string, WtlNetLayerShowMode> = {
  관로: 'underground',
  상수시설: 'underground',
  급수구역: 'underground',
  계량기: 'underground',
  기타: 'underground',
  보호구역: 'thematic',
}

function getLayerShowMode(key: string): WtlNetLayerShowMode {
  for (const g of DISPLAY_GROUPS) {
    if (g.items.some((i) => i.define_table_name === key)) {
      return LAYER_SHOW_MODE_BY_GROUP[g.title] ?? 'underground'
    }
  }
  return 'underground'
}

const SEARCH_TOOLS = ['구역설정', '단면도', 'SHP 다운로드', '엑셀 다운로드'] as const

function allKeysOfDisplayGroup(title: string, sourceId?: string): string[] {
  if (title === '관로' && sourceId) {
    return buildGwanroItems(sourceId).map((i) => i.define_table_name)
  }
  const g = DISPLAY_GROUPS.find((item) => item.title === title)
  return g ? g.items.map((i) => i.define_table_name) : []
}

function allKeysOfAllDisplayGroups(): string[] {
  const keys = new Set<string>()
  for (const g of DISPLAY_GROUPS) {
    if (g.title === '관로') {
      for (const k of WTL_PIPE_SPLIT_LOGICAL_KEYS) keys.add(k)
      for (const it of GWANRO_FIXED_ITEMS) keys.add(it.define_table_name)
      continue
    }
    for (const it of g.items) keys.add(it.define_table_name)
  }
  return [...keys]
}

/** 다운로드/Excel 모달 — 전체 레이어 목록 */
const EXPORT_LAYER_OPTIONS: WtlNetworkExportLayerOption[] = DISPLAY_GROUPS.flatMap(
  (g) =>
    g.items.map((item) => ({
      key: item.define_table_name,
      label: item.define_table_kor_name,
      group: g.title,
    }))
)

const INITIAL_GROUP = DISPLAY_GROUPS[0]?.title ?? '관로'
/** 전체 탭 레이어 기본 ON */
const INITIAL_LAYER_KEYS = allKeysOfAllDisplayGroups()

/**
 * 관망 레이어 키 → 지하시설물 패널 tableName
 *
 * - 관로 saa 분할(wtl_pipe_lm_saa004 등): 패널·GeoServer 발행명은 분할 키.
 *   부모 물리테이블(wtl_pipe_lm)을 visible에 넣으면 serviceLayer가 전체 관로를
 *   추가로 그려 배수·송수가 겹쳐 보인다 → 부모명은 넣지 않는다.
 * - 대진 등 remap 물리명(d_wtl_pipe_lm)만 있는 출처는 분할 자식이 없으므로 물리명 사용.
 */
function resolveUndergroundTableNames(key: string, sourceId: string): string[] {
  if (getLayerShowMode(key) !== 'underground') return []
  const def = getWtlNetLayerDef(key)
  if (!def?.table) return []

  const keyName = String(key ?? '').trim()
  const defineName = String(def.defineTable ?? '').trim()
  const baseTable = String(def.table ?? '').trim()
  // 급수구역·분구·블록 — 출처(상수/대진) 그룹 밖. 물리명으로 지하시설물 동기화
  if (isWtlNetZoneLayerKey(key)) {
    return [...new Set([baseTable, defineName, keyName].filter(Boolean))]
  }

  const isVirtualSplit =
    !!baseTable &&
    ((!!keyName && keyName.toLowerCase() !== baseTable.toLowerCase()) ||
      (!!defineName && defineName.toLowerCase() !== baseTable.toLowerCase()))

  const src = getWtlNetMapSource(sourceId)
  const out: string[] = []

  // 한글명·DB 데이터 실존 기준 물리 테이블 (저수조 tank/rsrv 등)
  // 선택 출처 그룹 tables에 있을 때만 — 타 출처 전용(수압계 등) 잔존 방지
  if (!isVirtualSplit) {
    const phys = getWtlNetPhysicalTable(key, sourceId)
    if (phys) {
      const physLow = phys.toLowerCase()
      const inSrc =
        !src ||
        src.tables.some((t) => String(t).toLowerCase() === physLow)
      if (inSrc) return [phys]
    }
  }

  if (isVirtualSplit) {
    if (src) {
      // 그룹 소속 테이블만 — 상수 논리키(wtl_pipe_lm_etc)를 대진 wanted에 넣지 않음
      for (const c of [keyName, defineName]) {
        if (!c) continue
        const remapped = src.remapTable(c)
        const hit =
          src.tables.find((t) => t.toLowerCase() === remapped.toLowerCase()) ??
          src.tables.find((t) => t.toLowerCase() === c.toLowerCase())
        if (hit) out.push(hit)
      }
      // 분할 자식이 tables에 없을 때: 대진→remap 부모, 상수→부모 실존 시 분할 논리키(WMS명)
      if (out.length === 0) {
        const remappedBase = src.remapTable(baseTable)
        const physical =
          src.tables.find((t) => t.toLowerCase() === remappedBase.toLowerCase()) ??
          src.tables.find((t) => t.toLowerCase() === baseTable.toLowerCase())
        if (physical) {
          if (physical.toLowerCase() !== baseTable.toLowerCase()) {
            out.push(physical)
          } else if (keyName) {
            out.push(keyName)
          } else if (defineName) {
            out.push(defineName)
          }
        }
      }
    } else {
      if (keyName) out.push(keyName)
      if (defineName && defineName.toLowerCase() !== keyName.toLowerCase()) {
        out.push(defineName)
      }
    }
    return [...new Set(out.filter(Boolean))]
  }

  if (src) {
    const remapped = src.remapTable(baseTable)
    const hit =
      src.tables.find((t) => t.toLowerCase() === remapped.toLowerCase()) ??
      src.tables.find((t) => t.toLowerCase() === baseTable.toLowerCase())
    if (hit) {
      out.push(hit)
    } else if (baseTable) {
      // 관망 출처 그룹(상수/대진)에 속한 테이블은 이 그룹에 없으면 동기화하지 않음
      // (수압계 등 상수 전용이 대진 전환 후에도 남는 문제 방지)
      // CCTV 등 그룹 밖 레이어만 물리명 그대로 유지
      const grouped =
        isWtlNetMapGroupedTable(baseTable) ||
        isWtlNetMapGroupedTable(keyName) ||
        isWtlNetMapGroupedTable(defineName)
      if (!grouped) out.push(baseTable)
    }
  } else if (baseTable) {
    out.push(baseTable)
  } else if (keyName) {
    out.push(keyName)
  }
  return [...new Set(out.filter(Boolean))]
}

/** 보호구역 → 주제도 tableName */
function resolveThematicTableNames(key: string): string[] {
  if (getLayerShowMode(key) !== 'thematic') return []
  const name = String(key ?? '').trim()
  return name ? [name] : []
}

/** 개발자 title용 — 선택 출처 remap·주제도·지하시설물 물리명 */
function resolveLayerEngName(key: string, sourceId: string): string {
  const mode = getLayerShowMode(key)
  if (mode === 'thematic') return resolveThematicTableNames(key)[0] ?? key
  const resolved = resolveUndergroundTableNames(key, sourceId)
  if (resolved[0]) return resolved[0]
  const def = getWtlNetLayerDef(key)
  return String(def?.defineTable ?? def?.table ?? key).trim() || key
}

function collectManagedUndergroundNames(sourceIds: readonly string[]): Set<string> {
  const managed = new Set<string>()
  for (const g of DISPLAY_GROUPS) {
    for (const item of g.items) {
      const key = item.define_table_name
      if (getLayerShowMode(key) !== 'underground') continue
      for (const sid of sourceIds) {
        for (const n of resolveUndergroundTableNames(key, sid)) managed.add(n)
        // 분할 시 wanted에는 안 넣는 부모 물리명도 관리 — 잔여 serviceLayer 전체관로 제거
        const base = String(getWtlNetLayerDef(key)?.table ?? '').trim()
        if (!base) continue
        managed.add(base)
        const src = getWtlNetMapSource(sid)
        if (!src) continue
        const remapped = src.remapTable(base)
        const hit =
          src.tables.find((t) => t.toLowerCase() === remapped.toLowerCase()) ??
          src.tables.find((t) => t.toLowerCase() === base.toLowerCase())
        if (hit) managed.add(hit)
      }
    }
  }
  return managed
}

function collectManagedThematicNames(): Set<string> {
  const managed = new Set<string>()
  for (const g of DISPLAY_GROUPS) {
    for (const item of g.items) {
      for (const n of resolveThematicTableNames(item.define_table_name)) managed.add(n)
    }
  }
  return managed
}

const GROUP_BTN = 'standard-layer-toggle-chip cursor-pointer'
const GROUP_BTN_ON = 'standard-layer-toggle-chip-active'
const GROUP_BTN_OFF = 'standard-layer-toggle-chip-inactive'

type Props = {
  leftOffsetPx: number
  onTotalWidthChange: (width: number) => void
  onClose: () => void
}

const RANGE_THUMB =
  'pointer-events-none absolute inset-x-0 top-0 h-full w-full appearance-none bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:mt-0 [&::-webkit-slider-thumb]:h-7 [&::-webkit-slider-thumb]:w-1.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-ew-resize [&::-webkit-slider-thumb]:rounded-sm [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-primary [&::-moz-range-track]:bg-transparent [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-7 [&::-moz-range-thumb]:w-1.5 [&::-moz-range-thumb]:cursor-ew-resize [&::-moz-range-thumb]:rounded-sm [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:bg-primary'

function MaterialChoices({
  names,
  selected,
  onToggle,
}: {
  names: string[]
  selected: Set<string>
  onToggle: (name: string) => void
}) {
  return (
    <div className="standard-filter-chips min-w-0 flex-1">
      {names.map((name) => {
        const on = selected.has(name)
        return (
          <button
            key={name}
            type="button"
            title={name}
            className={cn('standard-filter-chip cursor-pointer', on && 'standard-filter-chip-active')}
            onClick={() => onToggle(name)}
          >
            {name}
          </button>
        )
      })}
    </div>
  )
}

function parseRangeEnds(
  fromRaw: string,
  toRaw: string,
  min: number,
  max: number
): { from: number; to: number } | null {
  const start = Number(String(fromRaw).replace(/[^\d.]/g, ''))
  const end = Number(String(toRaw).replace(/[^\d.]/g, ''))
  if (!Number.isFinite(start) && !Number.isFinite(end)) return null
  const a = Number.isFinite(start) ? start : min
  const b = Number.isFinite(end) ? end : max
  const from = Math.min(max, Math.max(min, Math.round(Math.min(a, b))))
  const to = Math.min(max, Math.max(min, Math.round(Math.max(a, b))))
  return { from, to }
}

function DualRange({
  label,
  unit,
  min,
  max,
  from,
  to,
  onChange,
}: {
  label: string
  unit: string
  min: number
  max: number
  from: number
  to: number
  onChange: (from: number, to: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftFrom, setDraftFrom] = useState('')
  const [draftTo, setDraftTo] = useState('')
  const cancelEdit = useRef(false)
  const editWrapRef = useRef<HTMLDivElement>(null)
  const span = Math.max(max - min, 1)
  const left = ((from - min) / span) * 100
  const width = ((to - from) / span) * 100
  const text = unit ? `${from}${unit} ~ ${to}${unit}` : `${from} ~ ${to}`
  const isYearLabel = label === '연도' || label === '관로 연도'
  const startLabel = isYearLabel ? '시작년도' : `${label} 시작`
  const endLabel = isYearLabel ? '종료년도' : `${label} 종료`

  function commitDraft() {
    if (cancelEdit.current) {
      cancelEdit.current = false
      setEditing(false)
      return
    }
    const parsed = parseRangeEnds(draftFrom, draftTo, min, max)
    if (parsed) onChange(parsed.from, parsed.to)
    setEditing(false)
  }

  function onEditBlur(e: FocusEvent<HTMLInputElement>) {
    const next = e.relatedTarget
    if (next instanceof Node && editWrapRef.current?.contains(next)) return
    commitDraft()
  }

  return (
    <div className="flex items-center gap-1">
      <span className="standard-detail-hit-label w-[4.5rem] shrink-0 !text-foreground">{label}</span>
      <div
        className="relative h-7 min-w-0 flex-1"
        title={`${label} 범위 · 클릭하면 직접 입력`}
        onClick={(e) => {
          if (editing) return
          if ((e.target as HTMLElement).closest('input[type="range"]')) return
          setDraftFrom(String(from))
          setDraftTo(String(to))
          setEditing(true)
        }}
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded border border-border bg-muted/40">
          <div
            className="absolute inset-y-0 bg-primary/20"
            style={{ left: `${left}%`, width: `${width}%` }}
          />
          {!editing && (
            <span className="absolute inset-0 flex items-center justify-center px-1 text-[11px] text-foreground">
              {text}
            </span>
          )}
        </div>
        {editing ? (
          <div
            ref={editWrapRef}
            className="absolute inset-0 z-20 flex items-center gap-1 rounded border border-border bg-background px-1"
          >
            <input
              autoFocus
              inputMode="numeric"
              value={draftFrom}
              aria-label={startLabel}
              title={startLabel}
              placeholder={startLabel}
              className="h-full min-w-0 flex-1 bg-transparent text-center text-[11px] text-foreground outline-none"
              onChange={(e) => setDraftFrom(e.target.value.replace(/[^\d]/g, ''))}
              onBlur={onEditBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                  cancelEdit.current = true
                  e.currentTarget.blur()
                }
              }}
            />
            <span className="shrink-0 text-[11px] text-muted-foreground" aria-hidden>
              ~
            </span>
            <input
              inputMode="numeric"
              value={draftTo}
              aria-label={endLabel}
              title={endLabel}
              placeholder={endLabel}
              className="h-full min-w-0 flex-1 bg-transparent text-center text-[11px] text-foreground outline-none"
              onChange={(e) => setDraftTo(e.target.value.replace(/[^\d]/g, ''))}
              onBlur={onEditBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                  cancelEdit.current = true
                  e.currentTarget.blur()
                }
              }}
            />
          </div>
        ) : (
          <>
            <input
              type="range"
              min={min}
              max={max}
              value={from}
              aria-label={`${label} 부터`}
              className={RANGE_THUMB}
              onChange={(e) => onChange(Math.min(Number(e.target.value), to), to)}
            />
            <input
              type="range"
              min={min}
              max={max}
              value={to}
              aria-label={`${label} 까지`}
              className={RANGE_THUMB}
              onChange={(e) => onChange(from, Math.max(Number(e.target.value), from))}
            />
          </>
        )}
      </div>
    </div>
  )
}

type ListColumn = {
  key: string
  label: string
  field?: DefineFieldLike
}

/** 관리 도구(로그 보기)와 동일 권한: title에 한글·영문 병기 */
function dualTitle(korOrLabel: string, engName: string, showFieldKeys: boolean): string {
  const primary = String(korOrLabel ?? '').trim()
  const eng = String(engName ?? '').trim()
  if (!showFieldKeys) return primary || eng
  if (primary && eng && primary.toLowerCase() !== eng.toLowerCase()) {
    return primary + ' (' + eng + ')'
  }
  return primary || eng
}

function listHeaderTitle(col: ListColumn, showFieldKeys: boolean): string {
  const label = String(col.label ?? '').trim()
  const name = String(col.field?.define_field_name ?? col.key ?? '').trim()
  const kor = String(col.field?.define_field_kor_name ?? '').trim()
  return dualTitle(kor || label, name, showFieldKeys)
}


/** define 없을 때 임시 헤더 (show_list 로드 전·미설정) */
function fallbackListColumns(geomKind: string): ListColumn[] {
  const cols: ListColumn[] = [
    { key: 'name', label: '번호' },
    { key: 'diameter', label: '구경' },
    { key: 'material', label: '재질' },
  ]
  if (geomKind === 'line') cols.push({ key: 'length', label: '연장' })
  cols.push({ key: 'year', label: '연도' })
  return cols
}

/** define_field_show_list + define_field_idx 순 헤더. 한글화 전이면 null */
function resolveListColumns(
  sample: WtlNetworkRow | undefined,
  geomKind: string
): { columns: ListColumn[]; codesByField: Record<string, DefineCodeRow[]> } | null {
  const fieldsTable = String(sample?.fieldsTable ?? '').trim()
  const fallback = String(sample?.fieldsTableFallback ?? '').trim() || null
  if (fieldsTable) {
    const bundle = peekWtlDefineDisplayBundle(fieldsTable, fallback)
    if (!bundle) return null
      const listFields = selectDefineLayerListFields(bundle.fields)
      if (listFields.length > 0) {
        return {
          columns: listFields.map((f) => {
            const key = String(f.define_field_name ?? '').trim()
            return {
              key,
              label: getDefineFieldDisplayLabel(key, f.define_field_kor_name),
              field: f,
            }
          }),
          codesByField: bundle.codesByField,
      }
    }
  }
  return { columns: fallbackListColumns(geomKind), codesByField: {} }
}

function listCellParts(
  item: WtlNetworkRow,
  col: ListColumn,
  codesByField: Record<string, DefineCodeRow[]>,
  showFieldKeys: boolean
): { text: string; title: string } {
  if (col.field) {
    const record = item.record
    if (record) {
      const raw = getRowValueByField(record, col.key)
      const text = formatDefineFieldDisplayValue(
        raw,
        col.field.define_field_type,
        codesByField[col.key.toLowerCase()],
        '—'
      )
      if (showFieldKeys && isDefineFieldCodeType(col.field.define_field_type)) {
        const rawText = formatDetailScalarValue(raw, { empty: '—', asLiteral: true })
        if (rawText !== '—' && text !== '—' && rawText !== text) {
          return { text, title: text + ' (' + rawText + ')' }
        }
      }
      return { text, title: text }
    }
  }
  const legacyKey = col.key as keyof WtlNetworkRow
  const value = item[legacyKey]
  if (typeof value !== 'string' || value === '') return { text: '—', title: '—' }
  return { text: value, title: value }
}


const DEFAULT_META: WtlNetworkFilterMeta = {
  yearMin: 1970,
  yearMax: new Date().getFullYear(),
  diameterMin: 0,
  diameterMax: 2000,
  materials: [],
  materialLabelToCodes: {},
  materialTopCodes: [],
}

/** 슬라이더가 전체 구간이면 조건에서 빼서 지도·통계가 불필요한 비교를 하지 않게 한다. */
function narrowedRange(
  from: number,
  to: number,
  min: number,
  max: number
): { from: number | null; to: number | null } {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return { from: null, to: null }
  if (from <= min && to >= max) return { from: null, to: null }
  return { from, to }
}

/** 지도 범위의 소수점 흔들림은 같은 화면으로 본다. */
function bboxKey(bbox: [number, number, number, number] | null | undefined): string {
  if (!bbox || bbox.length !== 4) return ''
  return bbox.map((n) => Math.round(n)).join(',')
}

export function WtlNetworkMapShell({ leftOffsetPx, onTotalWidthChange, onClose }: Props) {
  const mapContext = useMapContext()
  useEnsureMapCenterInSggOnMount()

  const { data: session } = useSession()
  const { levels: consoleMenuLevels, loading: consoleAccessLoading } = useConsoleMenuAccess()
  /** 우측 «로그 보기» 버튼과 동일: 슈퍼유저 또는 개발자 콘솔 접근 */
  const showFieldKeys = useMemo(() => {
    if (isSuperUser(session?.user?.id)) return true
    if (consoleAccessLoading) return false
    return hasAnyDevConsoleAccess(consoleMenuLevels)
  }, [session?.user?.id, consoleAccessLoading, consoleMenuLevels])
  const [listWidth, setListWidth] = useState(LIST_DEFAULT)
  const [resultWidth, setResultWidth] = useState(RESULT_DEFAULT)
  const [extraOn, setExtraOn] = useState<Set<string>>(() => new Set(INITIAL_LAYER_KEYS))
  useEffect(() => {
    const offRef = mapContext?.wtlNetworkLayersOffRef
    if (!offRef) return
    offRef.current = () => setExtraOn(new Set())
    return () => {
      offRef.current = null
    }
  }, [mapContext?.wtlNetworkLayersOffRef])
  const [mapSources, setMapSources] = useState<Set<WtlNetMapSourceId>>(() => new Set())
  const [availableSourceIds, setAvailableSourceIds] = useState<string[]>([])
  /** null=미확인(잠깐 전체 허용), Set=선택 출처 기준 실테이블 있는 키만 */
  const [availableLayerKeys, setAvailableLayerKeys] = useState<Set<string> | null>(null)
  /** 출처×논리키 → 물리 테이블 (범례·지하시설물). 서버 한글명·데이터 실존 resolve */
  const [physicalBySource, setPhysicalBySource] = useState<
    Record<string, Record<string, string>>
  >({})
  /** 단면도 데이터 범례로 켠 선택자 — 패널 닫을 때 하이라이트 제거용 */
  const sectionLegendSelectionRef = useRef(false)
  /** 공통 상세 플로팅 (목록 클릭·지도 클릭 공용) */
  const [commonDetail, setCommonDetail] = useState<CommonDetailState | null>(null)
  const [commonDetailMinimized, setCommonDetailMinimized] = useState(false)
  const commonDetailRef = useRef<CommonDetailState | null>(null)
  commonDetailRef.current = commonDetail
  /** 새 창으로 분리된 킵 모달 (기본 모달과 동일) */
  const [keptModals, setKeptModals] = useState<LayerClickKeptEntry[]>([])
  
  const listPageSize = LIST_PAGE_SIZE
  const [group, setGroup] = useState(INITIAL_GROUP)
  const [keyword, setKeyword] = useState('')
  const [keywordDraft, setKeywordDraft] = useState('')
  const [meta, setMeta] = useState<WtlNetworkFilterMeta>(DEFAULT_META)
  const [diameterFrom, setDiameterFrom] = useState(DEFAULT_META.diameterMin)
  const [diameterTo, setDiameterTo] = useState(DEFAULT_META.diameterMax)
  const [materials, setMaterials] = useState<Set<string>>(() => new Set())
  const [yearFrom, setYearFrom] = useState(DEFAULT_META.yearMin)
  const [yearTo, setYearTo] = useState(DEFAULT_META.yearMax)
  const [emdSelected, setEmdSelected] = useState('')
  const [riSelected, setRiSelected] = useState('')
  const [supplyBlock, setSupplyBlock] = useState('')
  /** 읍면동·리·급수블록 경계 WKT (5181) */
  const [areaWkts5181, setAreaWkts5181] = useState<string[]>([])
  /** 구역설정(다각형 그리기) WKT — standardList 도형검색과 동일 경로 */
  const [zoneWkt5181, setZoneWkt5181] = useState<string | null>(null)
  const [zoneDrawing, setZoneDrawing] = useState(false)
  const [emdOptions, setEmdOptions] = useState<{ code: string; name: string }[]>([])
  const [supplyBlockOptions, setSupplyBlockOptions] = useState<{ value: string; label: string }[]>([])
  const [riOptions, setRiOptions] = useState<{ code: string; name: string }[]>([])
  /** 지도 하이라이트·범례 전용 선택 (활성 상세 item과 동기) */
  const [selected, setSelected] = useState<WtlNetworkRow | null>(null)
  const [detailRelatedLayer, setDetailRelatedLayer] =
    useState<WtlNetworkDetailRelatedLayer>(null)
  const [onlyInView, setOnlyInView] = useState(true)
  const bboxRef = useRef<[number, number, number, number] | null>(null)
  /** 현황 통계용 화면 범위 — onlyInView 일 때만 */
  const [statsBbox, setStatsBbox] = useState<[number, number, number, number] | null>(null)
  const listAbortRef = useRef<AbortController | null>(null)
  const moveFetchTimerRef = useRef<number | null>(null)
  const onlyInViewRef = useRef(onlyInView)
  onlyInViewRef.current = onlyInView
  const availableLayerKeysRef = useRef(availableLayerKeys)
  availableLayerKeysRef.current = availableLayerKeys
  /** 출처별 가용 레이어·물리테이블 — 패널 생애 동안 출처당 1회만 조회 */
  const layerAvailCacheRef = useRef(
    new Map<string, { keys: string[]; physical: Record<string, string> }>()
  )
  /** 선택 출처 시그니처 — 변경 시 ON 집합 재계산 */
  const appliedMapSourcesSigRef = useRef('')
  /** 직전 출처의 가용 키(A) — B 전환 시 (ON∩B)∪(B\A) 계산용 */
  const prevAvailableLayerKeysRef = useRef<Set<string> | null>(null)
  /** 같은 화면 범위·같은 검색 조건으로 목록을 두 번 돌리지 않음 */
  const listRequestKeyRef = useRef('')
  const extentKeyRef = useRef('')
  /** 행정경계·급수블록 + 구역설정 다각형 — 목록·지도 CQL 공통 */
  const effectiveAreaWkts5181 = useMemo(() => {
    const list = [...areaWkts5181]
    const zone = String(zoneWkt5181 ?? '').trim()
    if (zone) list.push(zone)
    return list
  }, [areaWkts5181, zoneWkt5181])
  const [resultOpen, setResultOpen] = useState(true)
  const [toolBtnVariant, setToolBtnVariant] =
    useState<WtlNetworkToolBtnVariant>('legacy')
  useEffect(() => {
    setToolBtnVariant(readStoredToolBtnVariant())
  }, [])
  useEffect(() => {
    try {
      window.localStorage.setItem(TOOL_BTN_VARIANT_STORAGE_KEY, toolBtnVariant)
    } catch {
      /* ignore */
    }
  }, [toolBtnVariant])
  const isFullLayout = toolBtnVariant === 'fullLayout'
  const toolUi = resolveToolUiVariant(toolBtnVariant)
  /** 플로팅 UI — 시설목록 접힘 */
  const [fullListOpen, setFullListOpen] = useState(true)
  /** 플로팅 UI — 통계 도표/그래프 표시 */
  const [statsViewMode, setStatsViewMode] =
    useState<WtlNetworkStatsViewMode>('both')
  /** 전체 UI — 시설목록 3단 탭 (지하시설물 그룹 → 분류 → 레이어) */
  const [listSourceTab, setListSourceTab] = useState('')
  const [listGroupTab, setListGroupTab] = useState('')
  const [listLayerTab, setListLayerTab] = useState('')
  /** 시설목록 레이어 박스 접힘 (key = box.key) */
  const [collapsedBoxKeys, setCollapsedBoxKeys] = useState<Set<string>>(() => new Set())
  const [excelExporting, setExcelExporting] = useState(false)
  const [shpExporting, setShpExporting] = useState(false)
  const [boxData, setBoxData] = useState<Record<string, LayerBoxData>>({})
  /** 첫 조회·디바운스 전에도 빈 목록 문구가 먼저 뜨지 않도록 true로 시작 */
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  /** define 목록 헤더 캐시 로드 후 재렌더 */
  const [defineListTick, setDefineListTick] = useState(0)

  // 전체 UI는 fixed 오버레이만 사용 — 주소검색 등 mapPadding을 밀지 않음
  const total = isFullLayout
    ? 0
    : listWidth + (resultOpen ? resultWidth : 0)
  const enabledKeys = useMemo(() => [...extraOn], [extraOn])
  const enabledKeySet = useMemo(() => new Set(enabledKeys), [enabledKeys])
  const section = useWtlNetworkSection(enabledKeys)
  /** 단면도 최소화 — 상세 도킹 뒤에 이어서 배치 */
  const [sectionMinimized, setSectionMinimized] = useState(false)
  useEffect(() => {
    if (!section.panelOpen) setSectionMinimized(false)
  }, [section.panelOpen])

  useEffect(() => {
    onTotalWidthChange(total)
  }, [total, onTotalWidthChange])

  useEffect(() => {
    return () => onTotalWidthChange(0)
  }, [onTotalWidthChange])

  /**
   * 관망 전용 WMS는 쓰지 않고 지하시설물 WMS만 표시한다.
   * (예전 suppress는 관망 WMS 대체용인데, 관망 WMS가 꺼진 뒤에도 suppress가 남아 레이어가 안 보였음)
   */
  useEffect(() => {
    const setSuppress = mapContext?.setNetworkMapSuppressUfTableNames
    if (!setSuppress) return
    setSuppress(null)
    return () => setSuppress(null)
  }, [mapContext?.setNetworkMapSuppressUfTableNames])

  useEffect(() => {
    return () => {
      mapContext?.setSpatialFilterWkt?.(null)
    }
  }, [mapContext?.setSpatialFilterWkt])

  /** 상세·단면도 플로팅 일괄 닫기 (패널 X · 다른 메뉴 전환 직전) */
  const dismissDetailUi = useCallback(() => {
    setCommonDetail(null)
    setCommonDetailMinimized(false)
    setKeptModals([])
    setSelected(null)
    setSectionMinimized(false)
    section.closePanel()
  }, [section.closePanel])

  /** origin = 기본 모달 좌상단 — 새 창은 그보다 약간 오른쪽 */
  const detachKeepDetail = useCallback(
    (origin?: { top: number; left: number } | null) => {
      const cur = commonDetailRef.current
      if (!cur?.item) return
      const curItem = cur.item
      const hitRows =
        cur.hitRows.length > 0
          ? cur.hitRows.map((r) =>
              r.id === curItem.id ? curItem : r
            )
          : [curItem]
      const hits = hitRows.map(networkRowToLayerClickHit)
      const facilityKey = String(curItem.id)
      setKeptModals((prev) => {
        const existing = prev.find((m) =>
          m.hits.some((h) => h.key === facilityKey)
        )
        if (existing) {
          return prev.map((m) =>
            m.key === existing.key
              ? {
                  ...m,
                  selectedKey: facilityKey,
                  focusToken: m.focusToken + 1,
                }
              : m
          )
        }
        const stackIndex =
          prev.reduce((max, m) => Math.max(max, m.stackIndex), -1) + 1
        const base = origin ?? cur.anchor ?? null
        const offsetX = 28 + stackIndex * 28
        const offsetY = 14 + stackIndex * 14
        return [
          ...prev,
          {
            key: nextNetworkKeepModalKey(),
            hits: hits.map((h) => ({ ...h, data: { ...h.data } })),
            selectedKey: facilityKey,
            anchor: base
              ? { left: base.left + offsetX, top: base.top + offsetY }
              : { left: 80 + offsetX, top: 72 + offsetY },
            stackIndex,
            focusToken: 0,
            minimized: false,
          },
        ]
      })
    },
    []
  )

  const closeKeepDetail = useCallback((modalKey: string) => {
    setKeptModals((prev) => prev.filter((m) => m.key !== modalKey))
  }, [])

  const setKeepDetailMinimized = useCallback(
    (modalKey: string, next: boolean) => {
      setKeptModals((prev) =>
        prev.map((m) =>
          m.key === modalKey ? { ...m, minimized: next } : m
        )
      )
    },
    []
  )

  const selectKeepDetailHit = useCallback(
    (modalKey: string, hitKey: string) => {
      setKeptModals((prev) =>
        prev.map((m) =>
          m.key === modalKey
            ? {
                ...m,
                selectedKey: hitKey,
                focusToken: m.focusToken + 1,
              }
            : m
        )
      )
    },
    []
  )

  const backKeepDetailToList = useCallback((modalKey: string) => {
    setKeptModals((prev) =>
      prev.map((m) =>
        m.key === modalKey
          ? {
              ...m,
              selectedKey: null,
              focusToken: m.focusToken + 1,
            }
          : m
      )
    )
  }, [])

  const handleClose = useCallback(() => {
    dismissDetailUi()
    onClose()
  }, [dismissDetailUi, onClose])

  /** 사이드바 메뉴 전환 등 — opened 바뀌기 전에 최소화 상세·단면 플로팅 제거 */
  useEffect(() => {
    const onCloseFloating = () => dismissDetailUi()
    window.addEventListener(MAP_FLOATING_DETAIL_CLOSE_EVENT, onCloseFloating)
    return () => {
      window.removeEventListener(MAP_FLOATING_DETAIL_CLOSE_EVENT, onCloseFloating)
    }
  }, [dismissDetailUi])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await call('', 'POST', {
          service: 'wtlNetworkService',
          action: 'getWtlNetworkFilterMeta',
          params: {
            layerKeys: [
              'wtl_pipe_lm_saa004',
              'wtl_pipe_lm_saa003',
              'wtl_sply_ls',
              'wtl_pipe_lm_etc',
              'wtl_valv_ps',
            ],
          },
        })
        const data = (res?.data ?? res) as WtlNetworkFilterMeta | undefined
        if (cancelled || !data) return
        setMeta({
          ...DEFAULT_META,
          ...data,
          materialLabelToCodes: data.materialLabelToCodes ?? {},
          materialTopCodes: data.materialTopCodes ?? [],
          materials: Array.isArray(data.materials) ? data.materials : [],
        })
        setYearFrom(data.yearMin)
        setYearTo(data.yearMax)
        setDiameterFrom(data.diameterMin)
        setDiameterTo(data.diameterMax)
      } catch {
        /* keep defaults */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await call('', 'POST', {
          service: 'wtlNetworkService',
          action: 'listWtlNetMapSources',
          params: {},
        })
        const data = (res?.data ?? res) as { sources?: WtlNetMapSourcePayload[] } | undefined
        if (cancelled) return
        const payloads = (data?.sources ?? [])
          .map((s) => ({
            id: String(s.id ?? '').trim(),
            label: String(s.label ?? s.id ?? '').trim(),
            tables: Array.isArray(s.tables) ? s.tables.map(String) : [],
          }))
          .filter((s) => s.id)
        setWtlNetMapSources(payloads)
        const ids = getWtlNetMapSources().map((src) => src.id)
        setAvailableSourceIds(ids)
        setMapSources(() => {
          const pick = pickDefaultWtlNetMapSourceId(ids)
          return pick ? new Set([pick]) : new Set()
        })
        /** 상세 CODE 한글화 — 패널 마운트 시 테이블별 한 번만 미리 로드 */
        const tables = new Set<string>()
        for (const p of payloads) {
          for (const t of p.tables) tables.add(t)
        }
        for (const g of DISPLAY_GROUPS) {
          for (const item of g.items) {
            const def = getWtlNetLayerDef(item.define_table_name)
            if (def?.table) tables.add(def.table)
            if (def?.defineTable) tables.add(def.defineTable)
            tables.add(item.define_table_name)
          }
        }
        prefetchWtlDefineDisplayBundles([...tables])
      } catch {
        if (!cancelled) {
          setWtlNetMapSources([])
          setAvailableSourceIds([])
          setMapSources(new Set())
          setAvailableLayerKeys(new Set())
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** 선택 출처 기준 — DB에 없는 탭 레이어는 비활성. 출처당 1회 조회 후 캐시 */
  useEffect(() => {
    /** 전체 UI: 탭 목록용으로 가용 출처 전체 키 로드 (출처 라디오와 무관) */
    const sourceIds = isFullLayout
      ? [...availableSourceIds]
      : availableSourceIds.filter((id) => mapSources.has(id))
    if (availableSourceIds.length === 0) {
      setAvailableLayerKeys(new Set())
      setPhysicalBySource({})
      setWtlNetPhysicalBySource({})
      return
    }
    if (sourceIds.length === 0) return

    const sourceSig = `${isFullLayout ? 'full' : 'src'}:${[...sourceIds].sort().join('\0')}`
    const sourceChanged = sourceSig !== appliedMapSourcesSigRef.current

    /**
     * 출처 A→B 전환 ON =
     * (A에서 켜짐 ∩ B 가용) ∪ (B에만 있는 키) + 보호구역 유지
     * 동일 출처 재조회: 비가용만 제거
     * 전체 UI: 지하시설물이 ON 소스 — 출처 전환형 자동 ON 안 함
     */
    const applyExtraOnForKeys = (next: Set<string>) => {
      if (isFullLayout) {
        appliedMapSourcesSigRef.current = sourceSig
        prevAvailableLayerKeysRef.current = new Set(next)
        setExtraOn((prev) => {
          const pruned = new Set(
            [...prev].filter((k) => {
              if (getLayerShowMode(k) === 'thematic') return true
              return next.has(k)
            })
          )
          if (pruned.size === prev.size) {
            let same = true
            for (const k of prev) {
              if (!pruned.has(k)) {
                same = false
                break
              }
            }
            if (same) return prev
          }
          return pruned.size > 0 ? pruned : prev
        })
        return
      }
      if (sourceChanged) {
        const availA = prevAvailableLayerKeysRef.current
        appliedMapSourcesSigRef.current = sourceSig
        setExtraOn((prev) => {
          const on = new Set<string>()
          for (const k of prev) {
            if (getLayerShowMode(k) === 'thematic') on.add(k)
          }
          for (const k of next) {
            if (getLayerShowMode(k) === 'thematic') {
              on.add(k)
              continue
            }
            const wasOn = prev.has(k)
            const onlyInB = !availA || !availA.has(k)
            if (wasOn || onlyInB) on.add(k)
          }
          return on
        })
        prevAvailableLayerKeysRef.current = new Set(next)
        return
      }
      prevAvailableLayerKeysRef.current = new Set(next)
      setExtraOn((prev) => {
        // 보호구역은 주제도 경로 — DB 가용키와 무관하게 유지
        const pruned = new Set(
          [...prev].filter((k) => {
            if (getLayerShowMode(k) === 'thematic') return true
            return next.has(k)
          })
        )
        if (pruned.size === prev.size) {
          let same = true
          for (const k of prev) {
            if (!pruned.has(k)) {
              same = false
              break
            }
          }
          if (same) return prev
        }
        // 지하 가용키가 비어도 보호구역은 남을 수 있음
        if (pruned.size > 0) return pruned
        return next
      })
    }

    /** 서버·캐시 키가 그룹에 없어도 남는 경우 대비 — 현재 출처에 매핑되는 키만 유지 */
    const filterKeysInSources = (keys: Iterable<string>, ids: string[]) => {
      const next = new Set<string>()
      for (const raw of keys) {
        const k = String(raw ?? '').trim()
        if (!k) continue
        if (getLayerShowMode(k) === 'thematic' || isWtlNetZoneLayerKey(k)) {
          next.add(k)
          continue
        }
        if (ids.some((sid) => resolveUndergroundTableNames(k, sid).length > 0)) {
          next.add(k)
        }
      }
      return next
    }

    const applyFromCache = (ids: string[]) => {
      const keys = new Set<string>()
      const phys: Record<string, Record<string, string>> = {}
      for (const id of ids) {
        const hit = layerAvailCacheRef.current.get(id)
        if (!hit) return false
        for (const k of hit.keys) keys.add(k)
        if (Object.keys(hit.physical).length > 0) phys[id] = hit.physical
      }
      const filtered = filterKeysInSources(keys, ids)
      setAvailableLayerKeys(filtered)
      setPhysicalBySource(phys)
      setWtlNetPhysicalBySource(phys)
      applyExtraOnForKeys(filtered)
      return true
    }

    if (applyFromCache(sourceIds)) return

    let cancelled = false
    /** 미캐시 출처만 스켈레톤 */
    setAvailableLayerKeys(null)
    const layerKeys = allKeysOfAllDisplayGroups()
    void call('', 'POST', {
      service: 'wtlNetworkService',
      action: 'listWtlNetworkAvailableLayerKeys',
      params: { mapSources: sourceIds, layerKeys },
    })
      .then((res) => {
        if (cancelled) return
        const data = res?.data ?? res
        const keys = Array.isArray(data?.availableKeys)
          ? data.availableKeys.map((k: unknown) => String(k).trim()).filter(Boolean)
          : []
        const next = filterKeysInSources(keys, sourceIds)
        const physRaw =
          data?.physicalBySource && typeof data.physicalBySource === 'object'
            ? (data.physicalBySource as Record<string, Record<string, string>>)
            : {}
        for (const id of sourceIds) {
          layerAvailCacheRef.current.set(id, {
            keys: [...next],
            physical: physRaw[id] ?? {},
          })
        }
        setPhysicalBySource(physRaw)
        setWtlNetPhysicalBySource(physRaw)
        setAvailableLayerKeys(next)
        applyExtraOnForKeys(next)
      })
      .catch(() => {
        if (!cancelled) {
          setAvailableLayerKeys(new Set())
          setPhysicalBySource({})
          setWtlNetPhysicalBySource({})
        }
      })
    return () => {
      cancelled = true
    }
  }, [availableSourceIds, mapSources, isFullLayout])

  /** 선택 키×출처별 목록/내보내기 슬롯 */
  const buildSlotsForKeys = useCallback(
    (
      selected: Iterable<string>,
      opts?: {
        sourceIds?: string[]
        /** 출처별 visible에 실제로 켜진 경우만 슬롯 (전체 UI) */
        visibleBySource?: Set<string> | null
      }
    ): LayerBoxSlot[] => {
      const on = new Set(
        [...selected].map((k) => String(k).trim().toLowerCase()).filter(Boolean)
      )
      const order = DISPLAY_GROUPS.flatMap((g) => g.items)
      const slots: LayerBoxSlot[] = []
      const sourceIds =
        opts?.sourceIds ??
        availableSourceIds.filter((id) => mapSources.has(id))
      const visible = opts?.visibleBySource
      const primarySource = sourceIds[0] ?? ''
      for (const item of order) {
        if (!on.has(item.define_table_name.toLowerCase())) continue
        const key = item.define_table_name
        const mode = getLayerShowMode(key)
        if (mode === 'thematic') continue
        if (!getWtlNetLayerDef(key)?.table) continue
        // 급수구역 — 출처와 무관, 슬롯 1개 (지하시설물 동기화)
        if (isWtlNetZoneLayerKey(key)) {
          const sid = primarySource || availableSourceIds[0]
          if (!sid) continue
          const zoneNames = resolveUndergroundTableNames(key, sid)
          if (zoneNames.length === 0) continue
          if (visible && !zoneNames.some((n) => visible.has(n))) continue
          slots.push({
            key: `zone:${key}`,
            layerKey: key,
            label: item.define_table_kor_name,
            geomKind: getWtlNetLayerDef(key)?.geomKind ?? 'area',
            mapSources: [sid],
          })
          continue
        }
        for (const id of sourceIds) {
          const names = resolveUndergroundTableNames(key, id)
          if (names.length === 0) continue
          if (visible && !names.some((n) => visible.has(n))) continue
          slots.push({
            key: `${id}:${key}`,
            layerKey: key,
            label: item.define_table_kor_name,
            geomKind: getWtlNetLayerDef(key)?.geomKind ?? 'point',
            mapSources: [id],
          })
        }
      }
      return slots
    },
    [availableSourceIds, mapSources]
  )

  /** 켜진 출처×레이어별 박스 (같은 카테고리도 테이블 분리) */
  const listSlots = useMemo(() => {
    if (isFullLayout) {
      const visible = mapContext?.visibleLayerNames
      // visible 준비 전엔 슬롯 없음 — 전체 출처×키 대량 조회 방지
      if (!visible) return []
      // 전체 UI: 지하시설물 visible 기준 — extraOn/출처 라디오와 무관
      const keys =
        availableLayerKeys && availableLayerKeys.size > 0
          ? availableLayerKeys
          : DISPLAY_GROUPS.flatMap((g) =>
              g.items.map((i) => i.define_table_name)
            )
      return buildSlotsForKeys(keys, {
        sourceIds: availableSourceIds,
        visibleBySource: visible,
      })
    }
    return buildSlotsForKeys(extraOn)
  }, [
    buildSlotsForKeys,
    extraOn,
    isFullLayout,
    availableSourceIds,
    availableLayerKeys,
    mapContext?.visibleLayerNames,
  ])

  const cancelListFetch = useCallback(() => {
    listAbortRef.current?.abort()
    listAbortRef.current = null
    if (moveFetchTimerRef.current != null) {
      window.clearTimeout(moveFetchTimerRef.current)
      moveFetchTimerRef.current = null
    }
  }, [])

  const fetchBoxPage = useCallback(
    async (
      slot: LayerBoxSlot,
      page: number,
      viewBbox?: [number, number, number, number] | null,
      signal?: AbortSignal,
      pageSize = listPageSize,
      scope: WtlNetworkExportScope = 'filtered'
    ) => {
      const all = scope === 'all'
      const year = narrowedRange(yearFrom, yearTo, meta.yearMin, meta.yearMax)
      const diameter = narrowedRange(
        diameterFrom,
        diameterTo,
        meta.diameterMin,
        meta.diameterMax
      )
      const res = await call(
        '',
        'POST',
        {
          service: 'wtlNetworkService',
          action: 'getWtlNetworkList',
          params: {
            layerKeys: [slot.layerKey],
            mapSources: slot.mapSources,
            bbox: all ? null : (viewBbox ?? null),
            keyword: all ? '' : keyword,
            yearFrom: all ? null : year.from,
            yearTo: all ? null : year.to,
            diameterFrom: all ? null : diameter.from,
            diameterTo: all ? null : diameter.to,
            materials: all ? [] : [...materials],
            emdCode: all ? null : emdSelected || null,
            riCode: all ? null : riSelected || null,
            supplyBlock: all ? null : supplyBlock || null,
            areaWkts5181:
              all || effectiveAreaWkts5181.length === 0 ? null : effectiveAreaWkts5181,
            page,
            pageSize,
          },
        },
        { signal }
      )
      const data = res?.data ?? res
      const rows = Array.isArray(data?.rows) ? (data.rows as WtlNetworkRow[]) : []
      const total = Number(data?.total ?? rows.length) || 0
      const resolvedPage = Number(data?.page ?? page) || page
      return { rows, total, page: resolvedPage } satisfies LayerBoxData
    },
    [
      keyword,
      yearFrom,
      yearTo,
      diameterFrom,
      diameterTo,
      meta.yearMin,
      meta.yearMax,
      meta.diameterMin,
      meta.diameterMax,
      materials,
      emdSelected,
      riSelected,
      supplyBlock,
      effectiveAreaWkts5181,
      listPageSize,
    ]
  )

  const buildExportFilterBody = useCallback(
    (
      scope: WtlNetworkExportScope,
      exportSlots: LayerBoxSlot[],
      targetSrs?: string,
      extras?: {
        includeDigitalMap?: boolean
        includeBackgroundImage?: boolean
        digitalMapFolders?: string[]
        backgroundAerialIds?: string[]
        digitalMapFormat?: 'original' | 'png'
      }
    ) => {
      const all = scope === 'all'
      const digitalMapFolders = (extras?.digitalMapFolders ?? [])
        .map((n) => String(n ?? '').trim())
        .filter(Boolean)
      const backgroundAerialIds = (extras?.backgroundAerialIds ?? [])
        .map((n) => String(n ?? '').trim())
        .filter(Boolean)
      const digitalMapFormat =
        extras?.digitalMapFormat === 'png' ? 'png' : 'original'
      const wantExtras =
        !all &&
        (Boolean(extras?.includeDigitalMap) ||
          Boolean(extras?.includeBackgroundImage) ||
          digitalMapFolders.length > 0 ||
          backgroundAerialIds.length > 0)
      const year = narrowedRange(yearFrom, yearTo, meta.yearMin, meta.yearMax)
      const diameter = narrowedRange(
        diameterFrom,
        diameterTo,
        meta.diameterMin,
        meta.diameterMax
      )
      const layerKeys = [...new Set(exportSlots.map((s) => s.layerKey))]
      const mapSourceIds = [
        ...new Set(exportSlots.flatMap((s) => s.mapSources).filter(Boolean)),
      ]
      const viewBbox =
        onlyInViewRef.current && bboxRef.current != null
          ? bboxRef.current
          : null
      /** 부가자료 범위 — 시설 «화면 내»와 무관하게 현재 화면이 있으면 전달 */
      const extrasBbox =
        wantExtras && bboxRef.current != null ? bboxRef.current : null
      const areaWkts =
        effectiveAreaWkts5181.length > 0 ? effectiveAreaWkts5181 : null
      return {
        scope,
        layerKeys,
        mapSources: mapSourceIds,
        bbox: all ? null : viewBbox,
        extrasBbox: all ? null : extrasBbox,
        keyword: all ? '' : keyword,
        yearFrom: all ? null : year.from,
        yearTo: all ? null : year.to,
        diameterFrom: all ? null : diameter.from,
        diameterTo: all ? null : diameter.to,
        materials: all ? [] : [...materials],
        emdCode: all ? null : emdSelected || null,
        riCode: all ? null : riSelected || null,
        supplyBlock: all ? null : supplyBlock || null,
        areaWkts5181: all ? null : areaWkts,
        ...(targetSrs ? { targetSrs } : {}),
        includeDigitalMap: wantExtras && digitalMapFolders.length > 0,
        includeBackgroundImage: wantExtras && backgroundAerialIds.length > 0,
        digitalMapFolders: wantExtras ? digitalMapFolders : [],
        backgroundAerialIds: wantExtras ? backgroundAerialIds : [],
        digitalMapFormat:
          wantExtras && digitalMapFolders.length > 0
            ? digitalMapFormat
            : 'original',
      }
    },
    [
      keyword,
      yearFrom,
      yearTo,
      diameterFrom,
      diameterTo,
      meta.yearMin,
      meta.yearMax,
      meta.diameterMin,
      meta.diameterMax,
      materials,
      emdSelected,
      riSelected,
      supplyBlock,
      effectiveAreaWkts5181,
    ]
  )

  const handleExcelExport = useCallback(
    async (scope: WtlNetworkExportScope, layerKeys: string[]) => {
      if (excelExporting) return
      const exportSlots = buildSlotsForKeys(layerKeys)
      if (exportSlots.length === 0) {
        window.alert('내보낼 시설목록이 없습니다.')
        return
      }
      setExcelExporting(true)
      try {
        const bbox =
          scope === 'all' ? null : onlyInViewRef.current ? bboxRef.current : null
        const pageSize = 100
        const sheets: Array<{
          sheetName: string
          rows: WtlNetworkRow[]
          fields: DefineFieldLike[]
          codesByField: Record<string, DefineCodeRow[]>
        }> = []

        for (const slot of exportSlots) {
          const allRows: WtlNetworkRow[] = []
          let page = 1
          let total = Number.POSITIVE_INFINITY
          while (allRows.length < total) {
            const data = await fetchBoxPage(
              slot,
              page,
              bbox,
              undefined,
              pageSize,
              scope
            )
            total = data.total
            if (data.rows.length === 0) break
            allRows.push(...data.rows)
            if (allRows.length >= total) break
            page += 1
          }
          if (allRows.length === 0) continue

          const sample = allRows[0]
          const bundle = await loadWtlDefineDisplayBundle(
            sample?.fieldsTable,
            sample?.fieldsTableFallback
          )
          const sourceLabel = getWtlNetMapSource(slot.mapSources[0] ?? '')?.label ?? ''
          const sheetName = sourceLabel ? `${sourceLabel}_${slot.label}` : slot.label
          sheets.push({
            sheetName,
            rows: allRows,
            fields: bundle.fields,
            codesByField: bundle.codesByField,
          })
        }

        if (sheets.length === 0) {
          window.alert('내보낼 시설목록이 없습니다.')
          return
        }
        exportWtlNetworkMapExcel(sheets)
      } catch (e) {
        window.alert(e instanceof Error ? e.message : 'Excel 내려받기에 실패했습니다.')
      } finally {
        setExcelExporting(false)
      }
    },
    [excelExporting, buildSlotsForKeys, fetchBoxPage]
  )

  const handleShpExport = useCallback(
    async (
      scope: WtlNetworkExportScope,
      layerKeys: string[],
      targetSrs?: string,
      extras?: {
        includeDigitalMap?: boolean
        includeBackgroundImage?: boolean
        digitalMapFolders?: string[]
        backgroundAerialIds?: string[]
        digitalMapFormat?: 'original' | 'png'
      }
    ) => {
      if (shpExporting) return
      const exportSlots = buildSlotsForKeys(layerKeys)
      const dmFolders = (extras?.digitalMapFolders ?? []).filter(Boolean)
      const aerialIds = (extras?.backgroundAerialIds ?? []).filter(Boolean)
      const wantExtras =
        scope === 'filtered' &&
        (dmFolders.length > 0 ||
          aerialIds.length > 0 ||
          Boolean(extras?.includeDigitalMap) ||
          Boolean(extras?.includeBackgroundImage))
      if (exportSlots.length === 0 && !wantExtras) {
        window.alert('내보낼 시설목록이 없습니다.')
        return
      }
      if (wantExtras) {
        const hasArea = effectiveAreaWkts5181.length > 0
        const hasViewBbox =
          onlyInViewRef.current && bboxRef.current != null
        if (!hasArea && !hasViewBbox) {
          window.alert(
            '수치지형도·배경영상은 구역설정 또는 «화면 내 시설만 표시»가 필요합니다.'
          )
          return
        }
      }
      type ShpExtras = NonNullable<typeof extras>
      const downloadOnce = async (exportExtras?: ShpExtras) => {
        const res = await fetch('/api/download/wtl-network-shp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            buildExportFilterBody(scope, exportSlots, targetSrs, exportExtras)
          ),
        })
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string
            code?: string
          }
          const errMsg =
            typeof data?.error === 'string' ? data.error : 'SHP 다운로드 실패'
          const isDmEmpty =
            data?.code === 'DIGITAL_MAP_EMPTY' ||
            errMsg.includes('겹치는 수치지형도가 없습니다')
          const askedDm =
            Boolean(exportExtras?.includeDigitalMap) ||
            (exportExtras?.digitalMapFolders?.length ?? 0) > 0
          const hasOther =
            exportSlots.length > 0 ||
            Boolean(exportExtras?.includeBackgroundImage) ||
            (exportExtras?.backgroundAerialIds?.length ?? 0) > 0
          if (isDmEmpty && askedDm && hasOther) {
            const ok = window.confirm(
              `${errMsg}\n\n수치지형도를 제외하고 다운로드할까요?`
            )
            if (!ok) return
            await downloadOnce({
              ...exportExtras,
              includeDigitalMap: false,
              digitalMapFolders: [],
            })
            return
          }
          throw new Error(errMsg)
        }
        const blob = await res.blob()
        const cd = res.headers.get('Content-Disposition') ?? ''
        const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd)
        const rawName = m?.[1] ? decodeURIComponent(m[1]) : m?.[2]
        const fileName = rawName?.trim() || '관망조회_SHP.zip'
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = fileName
        a.rel = 'noopener'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(a.href)
        const warn = res.headers.get('X-Wtl-Export-Warning')
        if (warn) {
          window.alert(decodeURIComponent(warn))
        }
      }
      setShpExporting(true)
      try {
        await downloadOnce(extras)
      } catch (e) {
        window.alert(e instanceof Error ? e.message : 'SHP 다운로드 실패')
      } finally {
        setShpExporting(false)
      }
    },
    [shpExporting, buildSlotsForKeys, buildExportFilterBody, effectiveAreaWkts5181]
  )

  const fetchList = useCallback(
    async (
      viewBbox?: [number, number, number, number] | null
    ): Promise<'done' | 'skip' | 'aborted'> => {
      if (onlyInViewRef.current && (!viewBbox || viewBbox.length !== 4)) return 'skip'
      const year = narrowedRange(yearFrom, yearTo, meta.yearMin, meta.yearMax)
      const diameter = narrowedRange(
        diameterFrom,
        diameterTo,
        meta.diameterMin,
        meta.diameterMax
      )
      const requestKey = [
        onlyInViewRef.current ? bboxKey(viewBbox) : 'all',
        keyword,
        year.from ?? '',
        year.to ?? '',
        diameter.from ?? '',
        diameter.to ?? '',
        [...materials].sort().join(','),
        emdSelected,
        riSelected,
        supplyBlock,
        effectiveAreaWkts5181.join('|'),
        listSlots.map((slot) => slot.key).join('|'),
      ].join('\u0001')
      if (listRequestKeyRef.current === requestKey) return 'skip'
      listRequestKeyRef.current = requestKey
      if (listSlots.length === 0) {
        cancelListFetch()
        setBoxData({})
        setListLoading(false)
        return 'done'
      }
      cancelListFetch()
      const ac = new AbortController()
      listAbortRef.current = ac
      setListLoading(true)
      setListError('')
      // 조회 중 기존 rows 유지 — 빈 테이블로 깜빡이지 않음. 완료 시 일괄 교체
      const nextBoxData: Record<string, LayerBoxData> = {}
      let failed = 0
      await Promise.all(
        listSlots.map(async (slot) => {
          try {
            const data = await fetchBoxPage(slot, 1, viewBbox, ac.signal)
            if (ac.signal.aborted || listAbortRef.current !== ac) return
            if (data.total <= 0 && data.rows.length === 0) return
            nextBoxData[slot.key] = data
          } catch (e) {
            if (ac.signal.aborted || listAbortRef.current !== ac) return
            if (e instanceof DOMException && e.name === 'AbortError') return
            failed += 1
            if (failed === 1) {
              setListError(e instanceof Error ? e.message : '목록 조회 실패')
            }
          }
        })
      )
      if (ac.signal.aborted || listAbortRef.current !== ac) {
        if (listRequestKeyRef.current === requestKey) listRequestKeyRef.current = ''
        return 'aborted'
      }
      setBoxData(nextBoxData)
      setListLoading(false)
      return 'done'
    },
    [
      listSlots,
      fetchBoxPage,
      cancelListFetch,
      keyword,
      yearFrom,
      yearTo,
      diameterFrom,
      diameterTo,
      meta.yearMin,
      meta.yearMax,
      meta.diameterMin,
      meta.diameterMax,
      materials,
      emdSelected,
      riSelected,
      supplyBlock,
      effectiveAreaWkts5181,
    ]
  )

  const scheduleListFetch = useCallback(() => {
    if (moveFetchTimerRef.current != null) {
      window.clearTimeout(moveFetchTimerRef.current)
    }
    // 디바운스·bbox 대기 구간에도 «조회된 항목이 없습니다» 대신 로딩 표시
    setListLoading(true)
    moveFetchTimerRef.current = window.setTimeout(() => {
      moveFetchTimerRef.current = null
      if (availableLayerKeysRef.current == null) return
      const inView = onlyInViewRef.current
      const bbox = bboxRef.current
      if (inView && !bbox) return
      void (async () => {
        const result = await fetchList(inView ? bbox : null)
        if (result === 'skip') setListLoading(false)
        if (result !== 'done' || !onlyInViewRef.current) return
        setStatsBbox(bboxRef.current)
      })()
    }, 450)
  }, [fetchList])

  const goBoxPage = useCallback(
    async (slot: LayerBoxSlot, page: number) => {
      const cur = boxData[slot.key]
      const totalPages = Math.max(1, Math.ceil((cur?.total ?? 0) / listPageSize))
      const nextPage = Math.min(Math.max(1, page), totalPages)
      if (cur && cur.page === nextPage && cur.rows.length > 0) return
      cancelListFetch()
      const ac = new AbortController()
      listAbortRef.current = ac
      setListLoading(true)
      setListError('')
      try {
        const bbox = onlyInViewRef.current ? bboxRef.current : null
        const data = await fetchBoxPage(slot, nextPage, bbox, ac.signal, listPageSize)
        if (ac.signal.aborted) return
        setBoxData((prev) => ({ ...prev, [slot.key]: data }))
      } catch (e) {
        if (ac.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
        setListError(e instanceof Error ? e.message : '목록 조회 실패')
      } finally {
        if (!ac.signal.aborted) setListLoading(false)
      }
    },
    [boxData, fetchBoxPage, cancelListFetch, listPageSize]
  )

  useEffect(() => {
    scheduleListFetch()
  }, [scheduleListFetch, availableLayerKeys, onlyInView])

  useEffect(() => () => cancelListFetch(), [cancelListFetch])

  useEffect(() => {
    const pairs: Array<{ table: string; fallback: string | null }> = []
    const seen = new Set<string>()
    for (const data of Object.values(boxData)) {
      for (const row of data.rows) {
        const table = String(row.fieldsTable ?? '').trim()
        if (!table) continue
        const fallback = String(row.fieldsTableFallback ?? '').trim() || null
        const key = `${table.toLowerCase()}\0${(fallback ?? '').toLowerCase()}`
        if (seen.has(key)) continue
        seen.add(key)
        pairs.push({ table, fallback })
      }
    }
    if (pairs.length === 0) return
    let cancelled = false
    void Promise.all(
      pairs.map(({ table, fallback }) => loadWtlDefineDisplayBundle(table, fallback))
    ).then(() => {
      if (!cancelled) setDefineListTick((n) => n + 1)
    })
    return () => {
      cancelled = true
    }
  }, [boxData])

  /**
   * 시설목록 행·지도 클릭·단면도 범례 공통.
   * fly=true: extent fit / center=true: 도형 중심으로 맵 센터 이동.
   * openDetail=false 이면 상세 모달 없이 선택·하이라이트만.
   * screenAnchor 있으면 지도 클릭 위치(mapClick), 없으면 목록 중앙(listCenter).
   */
  const pickRow = async (
    item: WtlNetworkRow,
    opts?: {
      fly?: boolean
      center?: boolean
      openDetail?: boolean
      hitRows?: WtlNetworkRow[]
      screenAnchor?: { top: number; left: number } | null
    }
  ) => {
    const openDetail = opts?.openDetail !== false
    const hitRows = opts?.hitRows ?? []
    if (openDetail) sectionLegendSelectionRef.current = false
    let next: WtlNetworkRow = item
    try {
      const res = await call('', 'POST', {
        service: 'wtlNetworkService',
        action: 'getWtlNetworkDetail',
        params: { id: item.id },
      })
      const row = (res?.data ?? res)?.row as WtlNetworkRow | null | undefined
      next = row ?? item
    } catch {
      next = item
    }
    if (openDetail) {
      notifyLayerClickDetailMatchClose({
        tableNames: [next.layerKey, next.fieldsTable, next.fieldsTableFallback],
        fieldsTable: next.fieldsTable,
        fieldsTableFallback: next.fieldsTableFallback,
        record:
          next.record && typeof next.record === 'object'
            ? (next.record as Record<string, unknown>)
            : null,
      })
      const screenAnchor = opts?.screenAnchor ?? null
      const fromMap = screenAnchor != null
      const prevDetail = commonDetailRef.current
      // 지도 클릭으로 이미 떠 있는 모달은 목록 행으로 내용만 바꾸고 위치는 유지
      const keepMapPlacement =
        !fromMap && prevDetail?.placement === 'mapClick' && prevDetail.anchor != null
      // 최소화 유지 — 선택·데이터만 바뀌어도 자동 펼침 금지
      setCommonDetail({
        item: next,
        hitRows: sortNetworkHitRows(hitRows),
        placement: fromMap || keepMapPlacement ? 'mapClick' : 'listCenter',
        anchor: fromMap
          ? screenAnchor
          : keepMapPlacement
            ? prevDetail.anchor
            : {
                top: Math.max(72, Math.round(viewportSize.h / 2 - 100)),
                left: panelCenterLeftPx,
              },
      })
    }
    setSelected(next)
      const map = mapContext?.mapInstanceRef?.current
    const applyPad = () => mapContext?.applyMapViewPaddingRef?.current?.()
    if (opts?.center) {
      centerMapOnWtlNetworkGeom(map, next.geom, applyPad)
    } else if (opts?.fly) {
      flyToWtlNetworkGeom(map, next.geom, applyPad)
    }
  }
  const searchFilter = useMemo(() => {
    const year = narrowedRange(yearFrom, yearTo, meta.yearMin, meta.yearMax)
    const diameter = narrowedRange(
      diameterFrom,
      diameterTo,
      meta.diameterMin,
      meta.diameterMax
    )
    return {
      yearFrom: year.from,
      yearTo: year.to,
      yearMin: meta.yearMin,
      yearMax: meta.yearMax,
      diameterFrom: diameter.from,
      diameterTo: diameter.to,
      diameterMin: meta.diameterMin,
      diameterMax: meta.diameterMax,
      materials: [...materials],
      materialLabelToCodes: meta.materialLabelToCodes,
      materialTopCodes: meta.materialTopCodes,
      keyword,
      supplyBlock,
      areaWkts5181: effectiveAreaWkts5181,
    }
  }, [
      yearFrom,
      yearTo,
      diameterFrom,
      diameterTo,
    meta.yearMin,
    meta.yearMax,
    meta.diameterMin,
    meta.diameterMax,
      materials,
    meta.materialLabelToCodes,
    meta.materialTopCodes,
      keyword,
      supplyBlock,
      effectiveAreaWkts5181,
  ])

  /** 현황·교차표 — 켜진 레이어 + 리스트 검색 + 화면에 보이는 시설만 */
  const statusListFilter = useMemo((): WtlNetworkStatusListFilter => {
    const year = narrowedRange(yearFrom, yearTo, meta.yearMin, meta.yearMax)
    const diameter = narrowedRange(
      diameterFrom,
      diameterTo,
      meta.diameterMin,
      meta.diameterMax
    )
    return {
      layerKeys: availableLayerKeys == null ? [] : enabledKeys,
      onlyInView,
      bbox: onlyInView ? statsBbox : null,
      keyword,
      yearFrom: year.from,
      yearTo: year.to,
      diameterFrom: diameter.from,
      diameterTo: diameter.to,
      materials: [...materials],
      emdCode: emdSelected || null,
      riCode: riSelected || null,
      supplyBlock: supplyBlock || null,
      areaWkts5181:
        effectiveAreaWkts5181.length > 0 ? effectiveAreaWkts5181 : null,
    }
  }, [
    enabledKeys,
    availableLayerKeys,
    onlyInView,
    statsBbox,
    keyword,
    yearFrom,
    yearTo,
    diameterFrom,
    diameterTo,
    meta.yearMin,
    meta.yearMax,
    meta.diameterMin,
    meta.diameterMax,
    materials,
    emdSelected,
    riSelected,
    supplyBlock,
    effectiveAreaWkts5181,
  ])

  useEffect(() => {
    if (!onlyInView) setStatsBbox(null)
  }, [onlyInView])

  useWtlNetworkMapLayer({
    enabledLayerKeys: enabledKeySet,
    mapSources,
    availableSourceIds,
    selected,
    searchFilter,
    detailRelatedLayer,
    onSelect: (row, hits, screenAnchor) => {
      const hitRows =
        Array.isArray(hits) && hits.length > 0 ? sortNetworkHitRows(hits) : []
      // 다중 → 목록 먼저 (상세 fetch 없이)
      if (hitRows.length > 1 && screenAnchor != null) {
        setCommonDetail({
          item: null,
          hitRows,
          placement: 'mapClick',
          anchor: screenAnchor,
        })
        setSelected(null)
        return
      }
      const primary = hitRows[0] ?? row
      void pickRow(primary, { hitRows, screenAnchor })
    },
    onMapMoveStart: () => {
      // 화면 체크가 켜져 있어도 이동 시작만으로 조회를 끊지 않는다.
      // 범위가 실제로 바뀌면 아래 예약 조회가 이전 요청을 대체한다.
    },
    onExtentChange: (next) => {
      bboxRef.current = next
      if (!onlyInViewRef.current) {
        setStatsBbox(null)
        return
      }
      const key = bboxKey(next)
      if (!key || key === extentKeyRef.current) return
      extentKeyRef.current = key
      scheduleListFetch()
    },
  })

  useEffect(() => {
    if (!commonDetail) setDetailRelatedLayer(null)
  }, [commonDetail])

  /** 단면도 패널 닫힘(언마운트) 시 데이터 범례로 켠 선택자 레이어 제거 */
  useEffect(() => {
    if (section.panelOpen) return
    if (!sectionLegendSelectionRef.current) return
    sectionLegendSelectionRef.current = false
    /** 범례 전용 하이라이트만 제거 — 열린 상세 모달은 유지 */
    setSelected(commonDetailRef.current?.item ?? null)
  }, [section.panelOpen])

  useEffect(() => {
    setCommonDetail((prev) => {
      if (!prev) return prev
      if (!prev.item) {
        const still = prev.hitRows.some((r) => {
          const key = String(r.layerKey)
          const sourceId = String(r.id).split(':')[0] as WtlNetMapSourceId
          if (!extraOn.has(key)) return false
          if (
            !isFullLayout &&
            getWtlNetMapSource(sourceId) &&
            !mapSources.has(sourceId)
          ) {
            return false
          }
          return true
        })
        return still ? prev : null
      }
      const key = String(prev.item.layerKey)
      const sourceId = String(prev.item.id).split(':')[0] as WtlNetMapSourceId
      if (!extraOn.has(key)) return null
      if (
        !isFullLayout &&
        getWtlNetMapSource(sourceId) &&
        !mapSources.has(sourceId)
      ) {
        return null
      }
      return prev
    })
    setSelected((prevSel) => {
      if (!prevSel) return prevSel
      const key = String(prevSel.layerKey)
      const sourceId = String(prevSel.id).split(':')[0] as WtlNetMapSourceId
      if (!extraOn.has(key)) return null
      if (
        !isFullLayout &&
        getWtlNetMapSource(sourceId) &&
        !mapSources.has(sourceId)
      ) {
        return null
      }
      return prevSel
    })
  }, [extraOn, mapSources, isFullLayout])

  const [viewportSize, setViewportSize] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1280,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  }))
  useEffect(() => {
    const onResize = () =>
      setViewportSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /** 단면도 최소화 도킹 — 공통 상세가 최소화돼 있으면 한 칸 뒤 */
  const dockLeftStartPx =
    leftOffsetPx +
    (isFullLayout ? 0 : listWidth + (resultOpen ? resultWidth : 0)) +
    8
  /** 전체 UI는 통계 플로팅 중앙, 그 외는 사이드 패널 중앙 */
  const panelCenterLeftPx =
    leftOffsetPx +
    Math.round((isFullLayout ? FULL_STATS_WIDTH : listWidth) / 2)

  const layerBoxes = useMemo(() => {
    return listSlots
      .map((slot) => {
        const data = boxData[slot.key]
        if (!data || (data.total <= 0 && data.rows.length === 0)) return null
        return { ...slot, items: data.rows, total: data.total, page: data.page }
      })
      .filter((b): b is NonNullable<typeof b> => Boolean(b))
  }, [listSlots, boxData])

  const listCount = useMemo(
    () => layerBoxes.reduce((n, box) => n + box.total, 0),
    [layerBoxes]
  )

  const toggleMaterial = (name: string) => {
    setMaterials((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const resetFilters = () => {
    // 전체 UI는 레이어 on/off를 지하시설물에 맡김 — 검색 조건만 초기화
    if (!isFullLayout) {
      setExtraOn(
        availableLayerKeys && availableLayerKeys.size > 0
          ? new Set(availableLayerKeys)
          : new Set(allKeysOfAllDisplayGroups())
      )
    }
    setYearFrom(meta.yearMin)
    setYearTo(meta.yearMax)
    setDiameterFrom(meta.diameterMin)
    setDiameterTo(meta.diameterMax)
    setMaterials(new Set())
    setEmdSelected('')
    setRiSelected('')
    setSupplyBlock('')
    // 위치 WKT·지도 공간필터를 동기 초기화해야 자체 WMS CQL이 바로 해제됨
    setAreaWkts5181([])
    setZoneWkt5181(null)
    setZoneDrawing(false)
    mapContext?.setSpatialDrawRequest?.(null)
    mapContext?.setSpatialFilterWkt?.(null)
    setKeywordDraft('')
    setKeyword('')
    setSelected(null)
    setCommonDetail(null)
    setCommonDetailMinimized(false)
    setKeptModals([])
  }

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

  /** 읍면동·리·급수블록 → 5181 WKT (목록·CQL). 지도 오버레이는 effectiveAreaWkts 효과에서 처리 */
  useEffect(() => {
    let cancelled = false
    const emd = emdSelected.trim()
    const ri = riSelected.trim()
    const block = supplyBlock.trim()
    if (!emd && !ri && !block) {
      setAreaWkts5181([])
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
      if (!cancelled) setAreaWkts5181(wkts)
    })()
    return () => {
      cancelled = true
    }
  }, [emdSelected, riSelected, supplyBlock])

  /** 행정경계·구역설정 합본 → 지도 공간필터 오버레이 */
  useEffect(() => {
    let cancelled = false
    const wkts = effectiveAreaWkts5181
    if (wkts.length === 0) {
      mapContext?.setSpatialFilterWkt?.(null)
      return
    }
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
      if (cancelled) return
      const skipFit = skipZoneFitRef.current
      skipZoneFitRef.current = false
      mapContext?.setSpatialFilterAutoFit?.(!skipFit)
      mapContext?.setSpatialFilterWkt?.(filterWkt)
    })()
    return () => {
      cancelled = true
    }
  }, [effectiveAreaWkts5181, mapContext?.setSpatialFilterWkt])

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

  /** 관망→지하시설물 반영 직후 역방향 effect가 되울림하지 않도록 */
  const skipUfToNetworkSyncRef = useRef(false)
  /** 출처 로드 후 관망→UF 동기화를 한 번 이상 수행한 뒤에만 UF→관망 반영 */
  const networkUfForwardReadyRef = useRef(false)

  /**
   * 관로·상수시설·급수구역·계량기·기타 ↔ 지하시설물 양방향 동기화
   * (1) 관망 탭 → visibleLayerNames → 지하시설물 패널
   * (2) 지하시설물 패널 → visibleLayerNames → 관망 탭(extraOn)
   * 보호구역은 주제도 경로로 별도 처리
   * 전체 UI: (1) 생략 — 지하시설물이 ON 소스. (2)는 가용 출처 전체 기준
   */
  useEffect(() => {
    if (isFullLayout) {
      networkUfForwardReadyRef.current = true
      return
    }
    if (availableLayerKeys == null) return
    const sourceIds = availableSourceIds.filter((id) => mapSources.has(id))
    if (sourceIds.length === 0) return
    // 가용 출처 전체 managed — 상수→상수(대진) 전환 시 이전 출처 물리 레이어 제거
    const managed = collectManagedUndergroundNames(availableSourceIds)
    const wanted = new Set<string>()
    for (const key of extraOn) {
      if (getLayerShowMode(key) !== 'underground') continue
      for (const sid of sourceIds) {
        for (const n of resolveUndergroundTableNames(key, sid)) wanted.add(n)
      }
    }
    skipUfToNetworkSyncRef.current = true
    const sync = mapContext?.syncUndergroundFromNetworkRef?.current
    if (sync) {
      // 패널 선택·visible·지하시설물 그룹 on을 한 번에
      sync(wanted, managed)
    } else {
      const setVisible = mapContext?.setVisibleLayerNames
      if (!setVisible) return
    setVisible((prev) => {
      const next = new Set(prev)
      for (const n of managed) next.delete(n)
      for (const n of wanted) next.add(n)
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
    }
    networkUfForwardReadyRef.current = true
    const t = window.setTimeout(() => {
      skipUfToNetworkSyncRef.current = false
    }, 0)
    return () => {
      window.clearTimeout(t)
      skipUfToNetworkSyncRef.current = false
    }
  }, [
    isFullLayout,
    mapContext?.syncUndergroundFromNetworkRef,
    mapContext?.setVisibleLayerNames,
    availableSourceIds,
    mapSources,
    extraOn,
    availableLayerKeys,
    physicalBySource,
  ])

  /** 지하시설물 → 관망 탭 (visibleLayerNames 기준, 보호구역 제외) */
  useEffect(() => {
    if (!networkUfForwardReadyRef.current) return
    if (skipUfToNetworkSyncRef.current) return
    const visible = mapContext?.visibleLayerNames
    if (!visible) return
    /** 전체 UI: 출처 라디오와 무관하게 가용 출처 전체에서 ON 반영 */
    const sourceIds = isFullLayout
      ? [...availableSourceIds]
      : availableSourceIds.filter((id) => mapSources.has(id))
    if (sourceIds.length === 0) return

    setExtraOn((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const g of DISPLAY_GROUPS) {
        for (const item of g.items) {
          const key = item.define_table_name
          if (getLayerShowMode(key) !== 'underground') continue
          if (availableLayerKeys && !availableLayerKeys.has(key)) continue

          const def = getWtlNetLayerDef(key)
          const names: string[] = []
          for (const sid of sourceIds) {
            for (const n of resolveUndergroundTableNames(key, sid)) names.push(n)
          }
          if (names.length === 0) continue

          const keyLow = key.toLowerCase()
          const defineLow = String(def?.defineTable ?? '')
            .trim()
            .toLowerCase()
          const baseLow = String(def?.table ?? '')
            .trim()
            .toLowerCase()
          const isVirtualSplit =
            !!baseLow && keyLow !== baseLow && (!defineLow || defineLow !== baseLow)

          let on = false
          if (isVirtualSplit) {
            // 상수 분할: 패널 키명이 visible에 있을 때만
            on = names.some((n) => {
              const low = n.toLowerCase()
              return (
                (low === keyLow || low === defineLow) && visible.has(n)
              )
            })
            if (!on) {
              // 대진: 분할 키는 UF에 없고 remap 물리명만 있음
              for (const sid of sourceIds) {
                const src = getWtlNetMapSource(sid)
                if (!src || !baseLow) continue
                const remapped = src.remapTable(baseLow)
                if (remapped.toLowerCase() === baseLow) continue
                if (visible.has(remapped)) {
                  on = true
                  break
                }
                if (names.some((n) => n.toLowerCase() === remapped.toLowerCase() && visible.has(n))) {
                  on = true
                  break
                }
              }
            }
          } else {
            on = names.some((n) => visible.has(n))
          }

          if (on) {
            if (!next.has(key)) {
              next.add(key)
              changed = true
            }
          } else if (next.has(key)) {
            next.delete(key)
            changed = true
          }
        }
      }
      return changed ? next : prev
    })
  }, [
    isFullLayout,
    mapContext?.visibleLayerNames,
    availableSourceIds,
    mapSources,
    availableLayerKeys,
  ])

  /** 보호구역 → 주제도 동기화 */
  useEffect(() => {
    if (!mapContext?.mapReady) return
    const apply = mapContext.wtlNetworkThematicSyncRef?.current?.applyManaged
    if (!apply) return
    const managed = collectManagedThematicNames()
    const wanted = new Set<string>()
    for (const key of extraOn) {
      for (const n of resolveThematicTableNames(key)) wanted.add(n)
    }
    apply(wanted, managed)
  }, [mapContext?.mapReady, mapContext?.wtlNetworkThematicSyncRef, extraOn])

  /** 구역설정 완료 직후 1회 — 공간필터 fit(줌·이동) 생략 */
  const skipZoneFitRef = useRef(false)
  useEffect(() => {
    const syncRef = mapContext?.wtlNetworkThematicSyncRef
    return () => {
      const managed = collectManagedThematicNames()
      syncRef?.current?.applyManaged(new Set(), managed)
    }
  }, [mapContext?.wtlNetworkThematicSyncRef])

  /** 언마운트 시 구역 그리기·공간필터 정리 */
  useEffect(() => {
    const setDraw = mapContext?.setSpatialDrawRequest
    const setFilter = mapContext?.setSpatialFilterWkt
    const setAutoFit = mapContext?.setSpatialFilterAutoFit
    return () => {
      setDraw?.(null)
      setFilter?.(null)
      setAutoFit?.(true)
    }
  }, [mapContext?.setSpatialDrawRequest, mapContext?.setSpatialFilterWkt, mapContext?.setSpatialFilterAutoFit])

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
      // standardList «도형 선택» > 다각형 그리기와 동일 (useSpatialDrawOnMap)
      type: 'polygon',
      onComplete: (wkt5181: string) => {
        const w = String(wkt5181 ?? '').trim()
        setZoneDrawing(false)
        if (w) {
          skipZoneFitRef.current = true
          setZoneWkt5181(w)
        }
      },
    })
  }, [mapContext, zoneDrawing, zoneWkt5181])

  const zoneToolLabel = zoneDrawing ? '구역취소' : zoneWkt5181 ? '구역해제' : '구역설정'

  const isLayerSelectable = useCallback(
    (name: string) => {
      if (availableLayerKeys == null) return true
      if (!availableLayerKeys.has(name)) return false
      // 주제도·급수구역 등은 출처 밖 가능 — 가용키만으로 충분
      if (getLayerShowMode(name) === 'thematic' || isWtlNetZoneLayerKey(name)) {
        return true
      }
      // 선택 출처 그룹에 실제 매핑 테이블이 없으면 미보유(버튼 숨김)
      const sid =
        availableSourceIds.find((id) => mapSources.has(id)) ?? availableSourceIds[0] ?? ''
      if (!sid) return true
      return resolveUndergroundTableNames(name, sid).length > 0
    },
    [availableLayerKeys, availableSourceIds, mapSources]
  )

  /** DB에 레이어가 하나라도 있는 카테고리만 탭 표시. 관로는 출처 그룹 parents %wtl_pipe_lm 반영 */
  const visibleDisplayGroups = useMemo(() => {
    const sid =
      availableSourceIds.find((id) => mapSources.has(id)) ?? availableSourceIds[0] ?? ''
    const groups = DISPLAY_GROUPS.map((g) =>
      g.title === '관로' ? { ...g, items: buildGwanroItems(sid) } : g
    )
    if (availableLayerKeys == null) return groups
    return groups.filter((g) =>
      g.items.some((item) => availableLayerKeys.has(item.define_table_name))
    )
  }, [availableLayerKeys, availableSourceIds, mapSources])

  useEffect(() => {
    if (visibleDisplayGroups.length === 0) return
    if (visibleDisplayGroups.some((g) => g.title === group)) return
    setGroup(visibleDisplayGroups[0]!.title)
  }, [visibleDisplayGroups, group])

  const toggleLayer = (name: string) => {
    if (!isLayerSelectable(name)) return
    setExtraOn((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  /** 레이어 그룹(출처)은 라디오 — 한 개만 선택 · 가용 키는 출처 변경 effect에서 맞춤 */
  const toggleMapSource = (id: WtlNetMapSourceId) => {
    setMapSources((prev) => {
      if (prev.size === 1 && prev.has(id)) return prev
      return new Set([id])
    })
  }

  const currentGroup =
    visibleDisplayGroups.find((item) => item.title === group) ??
    visibleDisplayGroups[0]
  /** 가용 레이어 키 조회 전 — 탭 내 레이어 버튼 스켈레톤 */
  const layerButtonsLoading = availableLayerKeys == null
  const sourceButtons = availableSourceIds
    .map((id) => getWtlNetMapSource(id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
  const activeSourceId =
    availableSourceIds.find((id) => mapSources.has(id)) ?? availableSourceIds[0] ?? ''
  /** 현황 통계·교차표 — 선택 레이어 그룹(출처) */
  const statusMapSources = useMemo(() => {
    const selected = availableSourceIds.filter((id) => mapSources.has(id))
    if (selected.length > 0) return selected
    return activeSourceId ? [activeSourceId] : []
  }, [availableSourceIds, mapSources, activeSourceId])

  /**
   * 전체 UI 3단 탭 — 지하시설물에서 켜진 레이어만
   * 1단: UF 그룹(상수·광역상수·급수구역) · 2단: 분류 · 3단: 레이어
   */
  const fullLayoutSources = useMemo(() => {
    const visible = mapContext?.visibleLayerNames
    type CatMap = Map<string, DisplayItem[]>
    const roots: {
      id: string
      label: string
      categories: { title: string; items: DisplayItem[] }[]
    }[] = []

    const pushCategories = (catMap: CatMap) =>
      DISPLAY_GROUPS.map((g) => g.title)
        .filter((t) => (catMap.get(t)?.length ?? 0) > 0)
        .map((t) => ({ title: t, items: catMap.get(t)! }))

    for (const sid of availableSourceIds) {
      const src = getWtlNetMapSource(sid)
      if (!src) continue
      const catMap: CatMap = new Map()
      const groups = DISPLAY_GROUPS.map((g) =>
        g.title === '관로' ? { ...g, items: buildGwanroItems(sid) } : g
      )
      for (const g of groups) {
        if (g.title === '급수구역' || g.title === '보호구역') continue
        for (const item of g.items) {
          if (getLayerShowMode(item.define_table_name) === 'thematic') continue
          if (isWtlNetZoneLayerKey(item.define_table_name)) continue
          if (availableLayerKeys && !availableLayerKeys.has(item.define_table_name)) {
            continue
          }
          const names = resolveUndergroundTableNames(item.define_table_name, sid)
          const on = visible
            ? names.some((n) => visible.has(n))
            : extraOn.has(item.define_table_name) &&
              (isFullLayout || mapSources.has(sid))
          if (!on) continue
          const list = catMap.get(g.title) ?? []
          if (!list.some((x) => x.define_table_name === item.define_table_name)) {
            list.push(item)
          }
          catMap.set(g.title, list)
        }
      }
      const categories = pushCategories(catMap)
      if (categories.length === 0) continue
      roots.push({ id: sid, label: src.label, categories })
    }

    const zoneCatMap: CatMap = new Map()
    const zoneGroup = DISPLAY_GROUPS.find((g) => g.title === '급수구역')
    const zoneSid =
      availableSourceIds.find((id) => mapSources.has(id)) ??
      availableSourceIds[0] ??
      ''
    if (zoneGroup && zoneSid) {
      for (const item of zoneGroup.items) {
        if (availableLayerKeys && !availableLayerKeys.has(item.define_table_name)) {
          continue
        }
        const names = resolveUndergroundTableNames(item.define_table_name, zoneSid)
        const on = visible
          ? names.some((n) => visible.has(n))
          : extraOn.has(item.define_table_name)
        if (!on) continue
        const list = zoneCatMap.get('급수구역') ?? []
        list.push(item)
        zoneCatMap.set('급수구역', list)
      }
    }
    const zoneCategories = pushCategories(zoneCatMap)
    if (zoneCategories.length > 0) {
      roots.push({
        id: FULL_LAYOUT_ZONE_TAB,
        label: '급수구역',
        categories: zoneCategories,
      })
    }

    return roots
  }, [
    isFullLayout,
    mapContext?.visibleLayerNames,
    availableSourceIds,
    availableLayerKeys,
    extraOn,
    mapSources,
  ])

  useEffect(() => {
    if (!isFullLayout) return
    if (fullLayoutSources.length === 0) {
      if (listSourceTab) setListSourceTab('')
      if (listGroupTab) setListGroupTab('')
      if (listLayerTab) setListLayerTab('')
      return
    }
    const sourceOk = fullLayoutSources.some((s) => s.id === listSourceTab)
    const nextSource = sourceOk ? listSourceTab : fullLayoutSources[0]!.id
    if (nextSource !== listSourceTab) setListSourceTab(nextSource)
    const source =
      fullLayoutSources.find((s) => s.id === nextSource) ?? fullLayoutSources[0]!
    const groupOk = source.categories.some((c) => c.title === listGroupTab)
    const nextGroup = groupOk
      ? listGroupTab
      : source.categories[0]?.title ?? ''
    if (nextGroup !== listGroupTab) setListGroupTab(nextGroup)
    const category =
      source.categories.find((c) => c.title === nextGroup) ??
      source.categories[0]
    const layerOk = category?.items.some(
      (i) => i.define_table_name === listLayerTab
    )
    const nextLayer = layerOk
      ? listLayerTab
      : category?.items[0]?.define_table_name ?? ''
    if (nextLayer !== listLayerTab) setListLayerTab(nextLayer)
  }, [
    isFullLayout,
    fullLayoutSources,
    listSourceTab,
    listGroupTab,
    listLayerTab,
  ])

  const fullLayoutActiveSlot = useMemo(() => {
    if (!listLayerTab) return null
    if (listSourceTab === FULL_LAYOUT_ZONE_TAB) {
      return (
        listSlots.find(
          (s) =>
            s.layerKey === listLayerTab && isWtlNetZoneLayerKey(s.layerKey)
        ) ?? null
      )
    }
    return (
      listSlots.find(
        (s) =>
          s.layerKey === listLayerTab &&
          s.mapSources.some((id) => id === listSourceTab)
      ) ??
      listSlots.find((s) => s.layerKey === listLayerTab) ??
      null
    )
  }, [listSlots, listLayerTab, listSourceTab])

  const fullLayoutActiveBox = useMemo(() => {
    if (!fullLayoutActiveSlot) return null
    const data = boxData[fullLayoutActiveSlot.key]
    if (!data) {
      return {
        ...fullLayoutActiveSlot,
        items: [] as WtlNetworkRow[],
        total: 0,
        page: 1,
      }
    }
    return {
      ...fullLayoutActiveSlot,
      items: data.rows,
      total: data.total,
      page: data.page,
    }
  }, [fullLayoutActiveSlot, boxData])

  /** 전체 UI 도구 버튼 — 구역/단면/SHP/Excel 동일 크기(라이트·다크 테마) */
  const fullLayoutToolBtnClass =
    'flex h-7 w-full shrink-0 cursor-pointer items-center justify-center gap-0.5 whitespace-nowrap rounded border border-border bg-background px-1.5 text-[11px] font-medium text-foreground hover:bg-muted/50'
  const toolVariantForExport: WtlNetworkToolBtnVariant = isFullLayout
    ? 'fullLayout'
    : toolUi

  const searchToolsBar = (
    <div
      className={cn(
        'flex shrink-0 gap-1 bg-background p-2',
        isFullLayout ? 'w-[5rem] flex-col !bg-transparent !p-1' : 'border-t border-border'
      )}
    >
      {SEARCH_TOOLS.map((label) => {
        if (label === '구역설정') {
          const zoneActive = zoneDrawing || Boolean(zoneWkt5181)
          return (
            <button
              key={label}
              type="button"
              title={zoneToolLabel}
              aria-label={zoneToolLabel}
              aria-pressed={zoneActive}
              className={cn(
                !isFullLayout &&
                  'flex h-7 min-w-0 flex-1 cursor-pointer items-center justify-center gap-0.5 whitespace-nowrap',
                isFullLayout && fullLayoutToolBtnClass,
                isFullLayout &&
                  zoneActive &&
                  'border-primary !bg-primary text-primary-foreground hover:!bg-primary/90',
                !isFullLayout &&
                  toolUi === 'legacy' &&
                  'rounded-[5px] px-0.5 text-[11px] font-semibold leading-none',
                !isFullLayout &&
                  toolUi === 'legacy' &&
                  (zoneActive
                    ? 'bg-[#14607a] text-white hover:bg-[#0f4d62] dark:bg-[#d7ebf1] dark:text-[#14607a] dark:hover:bg-[#c5e3eb]'
                    : 'bg-[#d7ebf1] text-[#14607a] hover:bg-[#c5e3eb] dark:bg-[#14607a] dark:text-[#d7ebf1] dark:hover:bg-[#0f4d62]'),
                !isFullLayout &&
                  toolUi === 'iconLabel' &&
                  'standard-detail-action-btn px-1.5 text-[11px] font-medium',
                !isFullLayout &&
                  toolUi === 'iconLabel' &&
                  zoneActive &&
                  'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
                !isFullLayout &&
                  toolUi === 'iconLabelColor' &&
                  'gap-0.5 rounded border px-1.5 text-[11px] font-medium transition-colors',
                !isFullLayout &&
                  toolUi === 'iconLabelColor' &&
                  (zoneActive
                    ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'border-primary bg-primary/15 text-primary hover:bg-primary/20')
              )}
              onClick={handleZoneTool}
            >
              {toolUi !== 'legacy' || isFullLayout ? (
                <Pentagon className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
              ) : null}
              {zoneToolLabel}
            </button>
          )
        }
        if (label === 'SHP 다운로드') {
          return (
            <WtlNetworkExportMenu
              key={label}
              label="SHP"
              title="SHP 다운로드"
              busy={shpExporting}
              busyLabel="SHP…"
              variant={toolVariantForExport}
              className={isFullLayout ? 'w-full shrink-0' : undefined}
              icon={
                toolVariantForExport === 'legacy' ? undefined : (
                  <MapPinned className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
                )
              }
              layers={EXPORT_LAYER_OPTIONS}
              selectedKeys={enabledKeys}
              availableKeys={availableLayerKeys}
              showCrsSelect
              showExtraAssets
              onConfirm={(scope, keys, targetSrs, extras) =>
                void handleShpExport(scope, keys, targetSrs, extras)
              }
            />
          )
        }
        if (label === '엑셀 다운로드') {
          return (
            <WtlNetworkExportMenu
              key={label}
              label="Excel"
              title="엑셀 다운로드"
              busy={excelExporting}
              busyLabel="엑셀…"
              variant={toolVariantForExport}
              className={isFullLayout ? 'w-full shrink-0' : undefined}
              icon={
                toolVariantForExport === 'legacy' ? undefined : (
                  <FileSpreadsheet
                    className="h-3 w-3 shrink-0"
                    strokeWidth={2}
                    aria-hidden
                  />
                )
              }
              layers={EXPORT_LAYER_OPTIONS}
              selectedKeys={enabledKeys}
              availableKeys={availableLayerKeys}
              onConfirm={(scope, keys) => void handleExcelExport(scope, keys)}
            />
          )
        }
        const isSection = label === '단면도'
        const sectionActive =
          section.modePickerOpen || section.drawing || section.panelOpen
        const title =
          isSection && section.drawing ? '단면취소' : label
        const sectionLabel = isSection && section.drawing ? '단면취소' : label
        return (
          <button
            key={label}
            type="button"
            title={title}
            className={cn(
              !isFullLayout &&
                'flex h-7 min-w-0 flex-1 cursor-pointer items-center justify-center whitespace-nowrap',
              isFullLayout && fullLayoutToolBtnClass,
              isFullLayout &&
                isSection &&
                sectionActive &&
                'border-primary !bg-primary text-primary-foreground hover:!bg-primary/90',
              !isFullLayout &&
                toolUi === 'legacy' &&
                'rounded-[5px] px-0.5 text-[11px] font-semibold leading-none',
              !isFullLayout &&
                toolUi === 'legacy' &&
                (isSection && sectionActive
                  ? 'bg-[#14607a] text-white hover:bg-[#0f4d62] dark:bg-[#d7ebf1] dark:text-[#14607a] dark:hover:bg-[#c5e3eb]'
                  : 'bg-[#d7ebf1] text-[#14607a] hover:bg-[#c5e3eb] dark:bg-[#14607a] dark:text-[#d7ebf1] dark:hover:bg-[#0f4d62]'),
              !isFullLayout &&
                toolUi === 'iconLabel' &&
                'standard-detail-action-btn gap-0.5 px-1.5 text-[11px] font-medium',
              !isFullLayout &&
                toolUi === 'iconLabel' &&
                isSection &&
                sectionActive &&
                'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
              !isFullLayout &&
                toolUi === 'iconLabelColor' &&
                'gap-0.5 rounded border px-1.5 text-[11px] font-medium transition-colors',
              !isFullLayout &&
                toolUi === 'iconLabelColor' &&
                (isSection && sectionActive
                  ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'border-primary bg-primary/15 text-primary hover:bg-primary/20')
            )}
            onClick={() => {
              if (isSection) section.startSection()
            }}
          >
            {toolUi !== 'legacy' || isFullLayout ? (
              <SquareSplitHorizontal
                className="h-3 w-3 shrink-0"
                strokeWidth={2}
                aria-hidden
              />
            ) : null}
            {sectionLabel}
          </button>
        )
      })}
      {!isFullLayout ? (
        <button
          type="button"
          title={resultOpen ? '시설목록 접기' : '시설목록 펼치기'}
          aria-label={resultOpen ? '시설목록 접기' : '시설목록 펼치기'}
          aria-pressed={resultOpen}
          onClick={() => setResultOpen((v) => !v)}
          className={cn(
            'flex h-7 min-w-0 flex-1 cursor-pointer items-center justify-center gap-0.5 whitespace-nowrap',
            toolUi === 'legacy' &&
              'rounded-[5px] px-0.5 text-[11px] font-semibold leading-none',
            toolUi === 'legacy' &&
              (resultOpen
                ? 'bg-[#14607a] text-white hover:bg-[#0f4d62] dark:bg-[#d7ebf1] dark:text-[#14607a] dark:hover:bg-[#c5e3eb]'
                : 'bg-[#d7ebf1] text-[#14607a] hover:bg-[#c5e3eb] dark:bg-[#14607a] dark:text-[#d7ebf1] dark:hover:bg-[#0f4d62]'),
            toolUi === 'iconLabel' &&
              'standard-detail-action-btn px-1.5 text-[11px] font-medium',
            toolUi === 'iconLabel' &&
              resultOpen &&
              'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
            toolUi === 'iconLabelColor' &&
              'gap-0.5 rounded border px-1.5 text-[11px] font-medium transition-colors',
            toolUi === 'iconLabelColor' &&
              (resultOpen
                ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                : 'border-primary bg-primary/15 text-primary hover:bg-primary/20')
          )}
        >
          {toolUi !== 'legacy' ? (
            <ChevronLeft
              className={cn('h-3 w-3 shrink-0', !resultOpen && 'rotate-180')}
              aria-hidden
            />
          ) : null}
          시설목록
        </button>
      ) : null}
    </div>
  )

  const fullLayoutSearch = (
    <div className="space-y-1.5">
      <div className="grid grid-cols-3 gap-1">
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
      <DualRange
        label="관로 연도"
        unit=""
        min={meta.yearMin}
        max={meta.yearMax}
        from={yearFrom}
        to={yearTo}
        onChange={(from, to) => {
          setYearFrom(from)
          setYearTo(to)
        }}
      />
      <DualRange
        label="관로 관경"
        unit="mm"
        min={meta.diameterMin}
        max={meta.diameterMax}
        from={diameterFrom}
        to={diameterTo}
        onChange={(from, to) => {
          setDiameterFrom(from)
          setDiameterTo(to)
        }}
      />
      <div className="flex items-start gap-1">
        <span className="standard-detail-hit-label w-[3.5rem] shrink-0 pt-0.5 !text-foreground">
          재질
        </span>
        <MaterialChoices
          names={meta.materials}
          selected={materials}
          onToggle={toggleMaterial}
        />
      </div>
      <label className="flex cursor-pointer items-center gap-1.5">
        <span className="standard-detail-hit-label shrink-0 !text-foreground">
          화면 내 시설만 표시
        </span>
        <input
          type="checkbox"
          className="cursor-pointer"
          checked={onlyInView}
          onChange={(e) => setOnlyInView(e.target.checked)}
          title="화면 내 시설만 표시"
          aria-label="화면 내 시설만 표시"
        />
      </label>
      <div className="flex items-center gap-1">
        <input
          type="search"
          value={keywordDraft}
          onChange={(e) => setKeywordDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            setKeyword(keywordDraft.trim())
          }}
          placeholder="통합검색 · Enter"
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
  )

  void defineListTick
  const fullLayoutListBody = (() => {
    if (!fullLayoutActiveBox) {
      return (
        <p className="standard-table-empty flex h-full items-center justify-center">
          {listLoading || availableLayerKeys == null
            ? '조회 중…'
            : '조회된 항목이 없습니다.'}
        </p>
      )
    }
    const box = fullLayoutActiveBox
    const resolved = resolveListColumns(box.items[0], box.geomKind)
    const columns = resolved?.columns ?? []
    const codesByField = resolved?.codesByField ?? {}
    const page = box.page
    const from = box.total === 0 ? 0 : (page - 1) * listPageSize + 1
    const to = (page - 1) * listPageSize + box.items.length
    const hasNext = page * listPageSize < box.total
    const showRowSkeleton = listLoading || availableLayerKeys == null
    /** 높이 180 기준 — 컬럼 미확정이면 4열 플레이스홀더 */
    const skeletonColCount = columns.length > 0 ? columns.length : 4
    const skeletonRowCount =
      box.items.length > 0 ? Math.min(box.items.length, 5) : 5
    const skeletonWidths = ['w-[72%]', 'w-[88%]', 'w-[60%]', 'w-[80%]'] as const
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded border border-border bg-background">
        {/* 본문만 스크롤 — thead sticky / pagination 하단 고정 */}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="standard-list-table">
            <thead className="standard-table-thead">
              <tr>
                {columns.length > 0
                  ? columns.map((col) => (
                      <th
                        key={col.key}
                        className="standard-table-th standard-table-th-left"
                        title={listHeaderTitle(col, showFieldKeys)}
                      >
                        {col.label}
                      </th>
                    ))
                  : Array.from({ length: skeletonColCount }, (_, i) => (
                      <th
                        key={`sk-h-${i}`}
                        className="standard-table-th standard-table-th-left"
                      >
                        <div className="h-3 w-[70%] animate-pulse rounded bg-muted-foreground/20" />
                      </th>
                    ))}
              </tr>
            </thead>
            <tbody>
              {showRowSkeleton ? (
                Array.from({ length: skeletonRowCount }, (_, ri) => (
                  <tr
                    key={`sk-r-${ri}`}
                    className="standard-list-row pointer-events-none"
                    aria-hidden
                  >
                    {Array.from({ length: skeletonColCount }, (_, ci) => (
                      <td key={`sk-c-${ri}-${ci}`} className="standard-table-td-compact">
                        <div
                          className={cn(
                            'h-3 animate-pulse rounded bg-muted',
                            skeletonWidths[ci % skeletonWidths.length]
                          )}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              ) : box.items.length === 0 || columns.length === 0 ? (
                <tr>
                  <td
                    colSpan={Math.max(columns.length, 1)}
                    className="standard-table-empty"
                  >
                    조회된 항목이 없습니다.
                  </td>
                </tr>
              ) : (
                box.items.map((item) => (
                  <tr
                    key={item.id}
                    className={cn(
                      'standard-list-row',
                      selected?.id === item.id && 'standard-list-row-selected'
                    )}
                    onClick={() => {
                      void pickRow(item, {
                        fly: !onlyInView,
                        hitRows: [],
                      })
                    }}
                  >
                    {columns.map((col) => {
                      const cell = listCellParts(
                        item,
                        col,
                        codesByField,
                        showFieldKeys
                      )
                      return (
                        <td
                          key={col.key}
                          className="standard-table-td-compact"
                          title={cell.title}
                        >
                          {cell.text}
                        </td>
                      )
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-muted/30 px-2 py-1.5">
          <span className="text-[11px] text-muted-foreground">
            {showRowSkeleton
              ? '조회 중…'
              : box.total === 0
                ? '0건'
                : `${from}–${to} / ${box.total.toLocaleString()}건`}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="이전"
              disabled={page <= 1 || listLoading}
              className="cursor-pointer rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void goBoxPage(box, page - 1)}
            >
              이전
            </button>
            <span className="px-1.5 text-[11px] text-muted-foreground">
              {page}페이지
            </span>
            <button
              type="button"
              title="다음"
              disabled={!hasNext || listLoading}
              className="cursor-pointer rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void goBoxPage(box, page + 1)}
            >
              다음
            </button>
          </div>
        </div>
      </div>
    )
  })()

  const fullLayoutListMeta =
    fullLayoutSources.length === 0
      ? ''
      : listLoading || availableLayerKeys == null
        ? `조회 중… · 레이어 ${listSlots.length} · 총 ${listCount.toLocaleString()}건`
        : `레이어 ${listSlots.length} · 총 ${listCount.toLocaleString()}건`

  /** 전체 UI 탭은 목록 전환만 — 기존 UI처럼 출처/상대 레이어를 끄지 않음 */
  const handleFullLayoutSourceTab = (id: string) => {
    setListSourceTab(id)
    const source = fullLayoutSources.find((s) => s.id === id)
    const firstCat = source?.categories[0]
    if (firstCat) {
      setListGroupTab(firstCat.title)
      const firstLayer = firstCat.items[0]?.define_table_name
      if (firstLayer) setListLayerTab(firstLayer)
    }
  }

  const handleFullLayoutGroupTab = (title: string) => {
    setListGroupTab(title)
    const source =
      fullLayoutSources.find((s) => s.id === listSourceTab) ??
      fullLayoutSources[0]
    const cat = source?.categories.find((c) => c.title === title)
    const firstLayer = cat?.items[0]?.define_table_name
    if (firstLayer) setListLayerTab(firstLayer)
  }

  return (
    <>
      {isFullLayout ? (
        <WtlNetworkFullLayoutPanels
          leftOffsetPx={leftOffsetPx}
          toolBtnVariant={toolBtnVariant}
          onToolBtnVariantChange={setToolBtnVariant}
          variantOptions={TOOL_BTN_VARIANT_OPTIONS}
          statsViewMode={statsViewMode}
          onStatsViewModeChange={setStatsViewMode}
          onClose={handleClose}
          stats={
            <WtlNetworkMapStatus
              mapSources={statusMapSources}
              listFilter={statusListFilter}
              filterMeta={meta}
              solidSectionHeader
              viewMode={statsViewMode}
              className="min-h-0 flex-1 space-y-[13px] overflow-auto px-2 pb-2 pt-2"
            />
          }
          tools={searchToolsBar}
          search={fullLayoutSearch}
          sources={fullLayoutSources}
          sourceTab={listSourceTab}
          groupTab={listGroupTab}
          layerTab={listLayerTab}
          onSourceTabChange={handleFullLayoutSourceTab}
          onGroupTabChange={handleFullLayoutGroupTab}
          onLayerTabChange={setListLayerTab}
          listOpen={fullListOpen}
          onToggleListOpen={() => setFullListOpen((v) => !v)}
          listMeta={fullLayoutListMeta}
          listBody={fullLayoutListBody}
          listError={listError || undefined}
        />
      ) : (
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
              <span className="standard-panel-title">관망조회</span>
              <div className="flex shrink-0 items-center gap-1">
                <label className="sr-only" htmlFor="wtl-network-tool-btn-variant">
                  하단 도구 버튼 UI
                </label>
                <select
                  id="wtl-network-tool-btn-variant"
                  title="하단 도구 버튼 UI"
                  value={toolBtnVariant}
                  onChange={(e) =>
                    setToolBtnVariant(e.target.value as WtlNetworkToolBtnVariant)
                  }
                  className="h-7 max-w-[9.5rem] cursor-pointer rounded border border-border bg-background px-1.5 text-[11px] text-foreground"
                >
                  {TOOL_BTN_VARIANT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <label className="sr-only" htmlFor="wtl-network-stats-view-mode-legacy">
                  통계 표시
                </label>
                <select
                  id="wtl-network-stats-view-mode-legacy"
                  title="통계 표시"
                  value={statsViewMode}
                  onChange={(e) =>
                    setStatsViewMode(e.target.value as WtlNetworkStatsViewMode)
                  }
                  className="h-7 max-w-[8.5rem] cursor-pointer rounded border border-border bg-background px-1.5 text-[11px] text-foreground"
                >
                  {STATS_VIEW_MODE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button type="button" className="standard-panel-close" onClick={handleClose} title="닫기" aria-label="닫기">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="scrollbar-thin max-h-[58%] shrink-0 overflow-y-auto">
                <div className="standard-filter-section border-b-0 !pb-[13px]">
                  <div className="grid grid-cols-3 gap-1">
                    {sourceButtons.map((src) => {
                      const on = mapSources.has(src.id)
                      return (
                        <button
                          key={src.id}
                          type="button"
                          className={cn(
                            'standard-layer-toggle-chip cursor-pointer truncate font-medium',
                            on ? GROUP_BTN_ON : GROUP_BTN_OFF
                          )}
                          title={src.label}
                          onClick={() => toggleMapSource(src.id)}
                        >
                          {src.label}
                        </button>
                      )
                    })}
                  </div>
                  {visibleDisplayGroups.length > 0 ? (
                  <div className="flex border-b border-border">
                      {visibleDisplayGroups.map(({ title, items }) => {
                      const on = group === title
                      const hasActiveLayer = items.some((it) =>
                        extraOn.has(it.define_table_name)
                      )
                      return (
                        <button
                          key={title}
                          type="button"
                          className={cn(
                            'h-7 min-w-0 flex-1 truncate px-0.5 text-center text-[11px] border-b-2 -mb-px',
                            on
                              ? 'border-primary font-semibold text-primary'
                              : hasActiveLayer
                                ? 'border-transparent font-medium text-[color-mix(in_srgb,var(--primary)_62%,white)] dark:text-[color-mix(in_srgb,var(--primary)_78%,white)]'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                          )}
                          onClick={() => {
                            if (title === group) return
                            const prevKeys = allKeysOfDisplayGroup(group, activeSourceId)
                            setExtraOn((prev) => {
                              const next = new Set(prev)
                              for (const k of prevKeys) next.delete(k)
                              return next
                            })
                            setGroup(title)
                          }}
                        >
                          {title}
                        </button>
                      )
                    })}
                  </div>
                  ) : null}
                  {currentGroup && (
                    <div
                      className="grid grid-cols-3 gap-1.5"
                      aria-busy={layerButtonsLoading || undefined}
                      aria-label={
                        layerButtonsLoading ? '레이어 목록 불러오는 중' : undefined
                      }
                    >
                      {layerButtonsLoading
                        ? currentGroup.items.map((item) => (
                            <div
                              key={item.define_table_name}
                              className="standard-layer-toggle-chip pointer-events-none border-transparent bg-muted/70 animate-pulse"
                              aria-hidden
                            />
                          ))
                        : currentGroup.items.map((item) => {
                            const selectable = isLayerSelectable(
                              item.define_table_name
                            )
                            if (!selectable) return null
                            const on = extraOn.has(item.define_table_name)
                        const eng = resolveLayerEngName(
                          item.define_table_name,
                          activeSourceId
                        )
                        const titleBase = dualTitle(
                          item.define_table_kor_name,
                          eng,
                          showFieldKeys
                        )
                        return (
                          <button
                            key={item.define_table_name}
                            type="button"
                            title={titleBase}
                            className={cn(
                              GROUP_BTN,
                              on ? GROUP_BTN_ON : GROUP_BTN_OFF
                            )}
                                onClick={() =>
                                  toggleLayer(item.define_table_name)
                                }
                              >
                                <WtlLayerMark
                                  layerKey={item.define_table_name}
                                  sourceId={activeSourceId}
                                  physicalTable={
                                    physicalBySource[activeSourceId]?.[
                                      item.define_table_name
                                    ] ?? null
                                  }
                                />
                            <span className="min-w-0 truncate [word-break:keep-all]">
                              {item.define_table_kor_name}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <div className="space-y-2 !mt-[13px] border-t border-border pt-[13px]">
                    <div className="flex items-center gap-1">
                      <span className="standard-detail-hit-label w-[4.5rem] shrink-0 !text-foreground">위치</span>
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
                    <DualRange
                      label="관로 연도"
                      unit=""
                      min={meta.yearMin}
                      max={meta.yearMax}
                      from={yearFrom}
                      to={yearTo}
                      onChange={(from, to) => {
                        setYearFrom(from)
                        setYearTo(to)
                      }}
                    />
                    <DualRange
                      label="관로 관경"
                      unit="mm"
                      min={meta.diameterMin}
                      max={meta.diameterMax}
                      from={diameterFrom}
                      to={diameterTo}
                      onChange={(from, to) => {
                        setDiameterFrom(from)
                        setDiameterTo(to)
                      }}
                    />
                    <div className="flex items-start gap-1">
                      <span className="standard-detail-hit-label w-[4.5rem] shrink-0 pt-0.5 !text-foreground">
                        관로 재질
                      </span>
                      <MaterialChoices
                        names={meta.materials}
                        selected={materials}
                        onToggle={toggleMaterial}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="standard-detail-hit-label w-[4.5rem] shrink-0 !text-foreground">통합검색</span>
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
                </div>
              </div>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <WtlNetworkMapStatus
                  mapSources={statusMapSources}
                  listFilter={statusListFilter}
                  filterMeta={meta}
                  viewMode={statsViewMode}
                />
              </div>
            </div>
            {searchToolsBar}
          </div>
        </MapSideListPanel>
      </div>
      {resultOpen && (
        <div className="pointer-events-auto shrink-0">
          <MapSideListPanel
            width={resultWidth}
            minWidth={RESULT_MIN}
            maxWidth={RESULT_MAX}
            leftOffsetPx={leftOffsetPx + listWidth}
            onWidthChange={setResultWidth}
            contentClassName="overflow-hidden"
          >
            <div className="standard-panel-root">
              <div className="standard-panel-header">
                <button
                  type="button"
                  className="standard-detail-section-toggle"
                  title="시설목록 접기"
                  onClick={() => setResultOpen(false)}
                >
                  <ChevronLeft className="standard-detail-section-chevron" />
                  <span className="standard-detail-section-toggle-label">시설목록</span>
                </button>
                <span className="text-[11px] text-muted-foreground">
                  {(listLoading || availableLayerKeys == null) &&
                  layerBoxes.length === 0
                    ? '조회 중…'
                    : listLoading || availableLayerKeys == null
                      ? `조회 중… · 레이어 ${layerBoxes.length} · 총 ${listCount.toLocaleString()}건`
                      : `레이어 ${layerBoxes.length} · 총 ${listCount.toLocaleString()}건`}
                </span>
              </div>
              <label className="flex shrink-0 cursor-pointer items-center gap-1 border-b border-border px-3 py-2 text-[11px] text-foreground">
                <input
                  type="checkbox"
                  className="cursor-pointer"
                  checked={onlyInView}
                  onChange={(e) => setOnlyInView(e.target.checked)}
                />
                화면에 보이는 시설만 표시합니다
              </label>
              {listError && (
                <p className="standard-detail-error mx-3 my-2 shrink-0">{listError}</p>
              )}
              <div className="standard-list-body">
                <div className="standard-list-scroll space-y-2 p-2">
                  {layerBoxes.length === 0 ? (
                    <p className="standard-table-empty">
                      {listLoading || availableLayerKeys == null
                        ? '조회 중…'
                        : '조회된 항목이 없습니다.'}
                    </p>
                  ) : (
                    <>
                    {layerBoxes.map((box) => {
                      void defineListTick
                      const resolved = resolveListColumns(box.items[0], box.geomKind)
                      const columns = resolved?.columns ?? []
                      const codesByField = resolved?.codesByField ?? {}
                      const page = box.page
                      const from = box.total === 0 ? 0 : (page - 1) * listPageSize + 1
                      const to = (page - 1) * listPageSize + box.items.length
                      const hasNext = page * listPageSize < box.total
                      const boxCollapsed = collapsedBoxKeys.has(box.key)
                      return (
                        <div
                          key={box.key}
                          className="overflow-hidden rounded border border-border bg-background"
                        >
                          <div
                            className={cn(
                              'flex min-w-0 items-center gap-1.5 bg-muted/50 px-2 py-1.5',
                              !boxCollapsed && 'border-b border-border'
                            )}
                          >
                            <WtlLayerMark
                              layerKey={box.layerKey}
                              sourceId={box.mapSources[0] ?? activeSourceId}
                              physicalTable={
                                physicalBySource[
                                  box.mapSources[0] ?? activeSourceId
                                ]?.[box.layerKey] ?? null
                              }
                            />
                            <span
                              className="min-w-0 truncate text-[11px] font-medium text-foreground"
                              title={dualTitle(
                                box.label,
                                resolveLayerEngName(
                                  box.layerKey,
                                  box.mapSources[0] ?? activeSourceId
                                ),
                                showFieldKeys
                              )}
                            >
                              {box.label}
                            </span>
                            <span className="standard-detail-hint shrink-0">
                              · {box.total.toLocaleString()}건
                            </span>
                            <button
                              type="button"
                              className="ml-auto inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                              title={boxCollapsed ? '펼치기' : '접기'}
                              aria-label={boxCollapsed ? '펼치기' : '접기'}
                              aria-expanded={!boxCollapsed}
                              onClick={() => {
                                setCollapsedBoxKeys((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(box.key)) next.delete(box.key)
                                  else next.add(box.key)
                                  return next
                                })
                              }}
                            >
                              <ChevronDown
                                className={cn(
                                  'h-3.5 w-3.5 transition-transform',
                                  boxCollapsed && '-rotate-90'
                                )}
                                aria-hidden
                              />
                            </button>
                          </div>
                          {!boxCollapsed ? (
                            resolved == null ? (
                              <div className="standard-table-loading-cell">
                                <span className="inline-flex items-center justify-center gap-2">
                                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                                  불러오는 중…
                                </span>
                              </div>
                            ) : (
                            <>
                          <div
                            className="overflow-x-auto"
                                style={
                                  box.items.length >= LIST_PAGE_SIZE
                                    ? { minHeight: LIST_TABLE_MIN_HEIGHT_PX }
                                    : undefined
                                }
                          >
                            <table className="standard-list-table">
                              <thead className="standard-table-thead">
                                <tr>
                                  {columns.map((col) => (
                                    <th
                                      key={col.key}
                                      className="standard-table-th standard-table-th-left"
                                      title={listHeaderTitle(col, showFieldKeys)}
                                    >
                                      {col.label}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                    {box.items.map((item, rowIdx) => (
                                  <tr
                                    key={item.id}
                                    className={cn(
                                      'standard-list-row',
                                          selected?.id === item.id &&
                                            'standard-list-row-selected',
                                          box.items.length >= LIST_PAGE_SIZE &&
                                            rowIdx === box.items.length - 1 &&
                                            'border-b-0'
                                        )}
                                        onClick={() => {
                                          void pickRow(item, {
                                            fly: !onlyInView,
                                            hitRows: [],
                                          })
                                        }}
                                  >
                                    {columns.map((col) => {
                                      const cell = listCellParts(
                                        item,
                                        col,
                                        codesByField,
                                        showFieldKeys
                                      )
                                      return (
                                        <td
                                          key={col.key}
                                          className="standard-table-td-compact"
                                          title={cell.title}
                                        >
                                          {cell.text}
                                        </td>
                                      )
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/30 px-2 py-1.5">
                            <span className="text-[11px] text-muted-foreground">
                              {box.total === 0
                                ? '0건'
                                : `${from}–${to} / ${box.total.toLocaleString()}건`}
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                title="이전"
                                disabled={page <= 1 || listLoading}
                                className="cursor-pointer rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
                                onClick={() => void goBoxPage(box, page - 1)}
                              >
                                이전
                              </button>
                              <span className="px-1.5 text-[11px] text-muted-foreground">
                                {page}페이지
                              </span>
                              <button
                                type="button"
                                title="다음"
                                disabled={!hasNext || listLoading}
                                className="cursor-pointer rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
                                onClick={() => void goBoxPage(box, page + 1)}
                              >
                                다음
                              </button>
                            </div>
                          </div>
                            </>
                            )
                          ) : null}
                        </div>
                      )
                    })}
                    {listLoading ? (
                      <p className="standard-table-empty">나머지 시설 조회 중…</p>
                    ) : null}
                    </>
                  )}
                </div>
              </div>
            </div>
          </MapSideListPanel>
        </div>
      )}
      </>
      )}
      {(() => {
        const minimizedDockKeys: string[] = []
        if (commonDetail && commonDetailMinimized) {
          minimizedDockKeys.push('primary')
        }
        for (const kept of keptModals) {
          if (kept.minimized) minimizedDockKeys.push(kept.key)
        }
        const dockIndexOf = (key: string) =>
          Math.max(0, minimizedDockKeys.indexOf(key))
        const sectionDockIndex =
          section.panelOpen && sectionMinimized
            ? minimizedDockKeys.length
            : 0
        return (
          <>
            {commonDetail ? (
              <LayerClickDetailFloating
                key="wtl-network-map-detail"
                open
                startAsSimple
                placementAsTopLeft={commonDetail.placement === 'listCenter'}
                hits={(commonDetail.hitRows.length > 0
                  ? commonDetail.hitRows.map((r) =>
                      commonDetail.item && r.id === commonDetail.item.id
                        ? commonDetail.item
                        : r
                    )
                  : commonDetail.item
                    ? [commonDetail.item]
                    : []
                ).map(networkRowToLayerClickHit)}
                selected={
                  commonDetail.item
                    ? networkRowToLayerClickHit(commonDetail.item)
                    : null
                }
                minimized={commonDetailMinimized}
                onMinimizedChange={setCommonDetailMinimized}
                focusToken={0}
                anchorLeftPx={
                  commonDetail.anchor?.left ??
                  panelCenterLeftPx
                }
                anchorTopPx={
                  commonDetail.anchor?.top ??
                  Math.max(72, Math.round(viewportSize.h / 2 - 100))
                }
                viewportW={viewportSize.w}
                viewportH={viewportSize.h}
                dockIndex={dockIndexOf('primary')}
                dockLeftStartPx={dockLeftStartPx}
                writeSerEng="wtlNetworkMap"
                undergroundFacilityTableNames={(() => {
                  const s = new Set<string>()
                  const rows =
                    commonDetail.hitRows.length > 0
                      ? commonDetail.hitRows
                      : commonDetail.item
                        ? [commonDetail.item]
                        : []
                  for (const item of rows) {
                    for (const v of [
                      item.layerKey,
                      item.fieldsTable,
                      getWtlNetLayerDef(String(item.layerKey ?? ''))?.table,
                    ]) {
                      const t = String(v ?? '')
                        .trim()
                        .toLowerCase()
                      if (t) s.add(t)
                    }
                  }
                  return s
                })()}
                onSelectHit={(key) => {
                  const row = commonDetail.hitRows.find(
                    (r) => String(r.id) === key
                  )
                  if (!row) return
                  void (async () => {
                    let next: WtlNetworkRow = row
                    try {
                      const res = await call('', 'POST', {
                        service: 'wtlNetworkService',
                        action: 'getWtlNetworkDetail',
                        params: { id: row.id },
                      })
                      const fetched = (res?.data ?? res)?.row as
                        | WtlNetworkRow
                        | null
                        | undefined
                      next = fetched ?? row
                    } catch {
                      next = row
                    }
                    setCommonDetail((prev) =>
                      prev ? { ...prev, item: next } : prev
                    )
                    setSelected(next)
                  })()
                }}
                onBackToList={() => {
                  setCommonDetail((prev) =>
                    prev ? { ...prev, item: null } : prev
                  )
                  setSelected(null)
                }}
                onClose={() => {
                  setCommonDetail(null)
                  setCommonDetailMinimized(false)
                  setSelected(null)
                }}
                onDetach={(origin) => detachKeepDetail(origin)}
                onActivate={() => {
                  if (commonDetail.item) setSelected(commonDetail.item)
                  const map = mapContext?.mapInstanceRef?.current
                  if (map) claimMapLayerClickDetailHighlight(map, 'wtlNetwork')
                }}
                onSelectedUpdated={(hit) => {
                  const record: Record<string, unknown> = {
                    ...(hit.data ?? {}),
                  }
                  delete record.geom
                  const mergeRow = (row: WtlNetworkRow): WtlNetworkRow => ({
                    ...row,
                    record: {
                      ...(row.record && typeof row.record === 'object'
                        ? row.record
                        : {}),
                      ...record,
                    },
                  })
                  const id = hit.key
                  setCommonDetail((prev) =>
                    prev && prev.item && String(prev.item.id) === id
                      ? {
                          ...prev,
                          item: mergeRow(prev.item),
                          hitRows: prev.hitRows.map((r) =>
                            String(r.id) === id ? mergeRow(r) : r
                          ),
                        }
                      : prev
                  )
                  setBoxData((prev) => {
                    let changed = false
                    const out: Record<string, LayerBoxData> = {}
                    for (const [key, data] of Object.entries(prev)) {
                      const idx = data.rows.findIndex(
                        (r) => String(r.id) === id
                      )
                      if (idx < 0) {
                        out[key] = data
                        continue
                      }
                      changed = true
                      const rows = data.rows.slice()
                      rows[idx] = mergeRow(rows[idx])
                      out[key] = { ...data, rows }
                    }
                    return changed ? out : prev
                  })
                }}
              />
            ) : null}
            {keptModals.map((kept) => {
              if (kept.hits.length === 0) return null
              const selected = kept.selectedKey
                ? kept.hits.find((h) => h.key === kept.selectedKey) ?? null
                : null
              return (
                <LayerClickDetailFloating
                  key={kept.key}
                  open
                  kept
                  startAsSimple
                  placementAsTopLeft
                  hits={kept.hits}
                  selected={selected}
                  minimized={kept.minimized}
                  onMinimizedChange={(next) =>
                    setKeepDetailMinimized(kept.key, next)
                  }
                  focusToken={kept.focusToken}
                  anchorLeftPx={
                    kept.anchor?.left ?? panelCenterLeftPx
                  }
                  anchorTopPx={
                    kept.anchor?.top ??
                    Math.max(72, Math.round(viewportSize.h / 2 - 100))
                  }
                  viewportW={viewportSize.w}
                  viewportH={viewportSize.h}
                  dockIndex={dockIndexOf(kept.key)}
                  dockLeftStartPx={dockLeftStartPx}
                  undergroundFacilityTableNames={undergroundTablesFromHits(
                    kept.hits
                  )}
                  onSelectHit={(hitKey) =>
                    selectKeepDetailHit(kept.key, hitKey)
                  }
                  onBackToList={() => backKeepDetailToList(kept.key)}
                  onClose={() => closeKeepDetail(kept.key)}
                />
              )
            })}
            <WtlNetworkSectionDrawGuide
              open={section.modePickerOpen || section.drawing}
              drawMode={section.drawMode}
              drawing={section.drawing}
              pendingReady={section.pendingReady}
              canUndoLast={section.canUndoLast}
              message={section.guideMessage}
              onChoose={section.chooseDrawMode}
              onUndoLast={section.undoLastVertex}
              onApply={section.applyPendingLine}
              onRespecify={section.respecifyCutLine}
              onCancel={section.cancelDraw}
            />
            <WtlNetworkSectionPanel
              open={section.panelOpen}
              tab={section.tab}
              onTabChange={section.setTab}
              lineReady={section.lineReady}
              loading={section.loading}
              error={section.error}
              ground={section.ground}
              groundMin={section.groundMin}
              groundMax={section.groundMax}
              features={section.features}
              totalLengthM={section.totalLengthM}
              lineLonLat={section.lineLonLat}
              line3857={section.line3857}
              enabledKeys={section.enabledKeys}
              supplyAreaLines={section.supplyAreaLines}
              supplyAreaBands={section.supplyAreaBands}
              supplyElevComposition={section.supplyElevComposition}
              minimized={sectionMinimized}
              pinPosition={
                section.panelOpen && sectionMinimized
                  ? computeMapDetailDockPin({
                      dockIndex: sectionDockIndex,
                      dockLeftStart: dockLeftStartPx,
                      viewportW: viewportSize.w,
                      viewportH: viewportSize.h,
                    })
                  : null
              }
              onMinimizedChange={setSectionMinimized}
              onClose={section.closePanel}
              onRedraw={section.redrawSection}
              onLegendItemSelect={(item) => {
                const id = String(item.networkId ?? '').trim()
                if (!id) return
                sectionLegendSelectionRef.current = true
                void pickRow(
                  {
                    id,
                    layerKey:
                      String(item.layerKey ?? '').trim() ||
                      id.split(':')[0] ||
                      '',
                    geomKind: item.kind === 'point' ? 'point' : 'line',
                    name: item.label,
                    diameter: '',
                    material: '',
                    length: '',
                    year: '',
                    status: '',
                    hjd: '',
                    attrs: [],
                  },
                  { openDetail: false }
                )
              }}
              onLegendHighlightClear={() => {
                sectionLegendSelectionRef.current = false
                setSelected(null)
              }}
            />
          </>
        )
      })()}
    </>
  )
}

/** 다건 select option — POINT → LINE → POLYGON */
/** tables.json define_table_shp_type — POINT → LINE → POLYGON */
function networkHitShpRank(shpOrKind: string | undefined): number {
  const k = String(shpOrKind ?? '')
    .trim()
    .toUpperCase()
  if (k === 'POINT' || k === 'MULTIPOINT') return 0
  if (k === 'LINE' || k === 'LINESTRING' || k === 'MULTILINESTRING') return 1
  if (
    k === 'POLYGON' ||
    k === 'MULTIPOLYGON' ||
    k === 'AREA' ||
    k === 'SURFACE'
  ) {
    return 2
  }
  const low = k.toLowerCase()
  if (low === 'point') return 0
  if (low === 'line') return 1
  if (low === 'area' || low === 'polygon') return 2
  return 9
}

type NetworkHitSortMeta = { shpRank: number; idx: number }

const NETWORK_HIT_SORT_META = (() => {
  const map = new Map<string, NetworkHitSortMeta>()
  const rows = (
    Array.isArray(tablesJson) ? tablesJson : []
  ) as {
    define_table_name?: string
    define_table_shp_type?: string
    define_table_idx?: string | number
  }[]
  for (const row of rows) {
    const name = String(row.define_table_name ?? '')
      .trim()
      .toLowerCase()
    if (!name || map.has(name)) continue
    const idxRaw = parseInt(String(row.define_table_idx ?? ''), 10)
    map.set(name, {
      shpRank: networkHitShpRank(row.define_table_shp_type),
      idx: Number.isFinite(idxRaw) ? idxRaw : 999999,
    })
  }
  return map
})()

function networkHitSortMeta(row: WtlNetworkRow): NetworkHitSortMeta {
  const def = getWtlNetLayerDef(String(row.layerKey ?? ''))
  const candidates = [
    row.layerKey,
    def?.defineTable,
    row.fieldsTable,
    def?.table,
  ]
  for (const c of candidates) {
    const key = String(c ?? '')
      .trim()
      .toLowerCase()
    if (!key) continue
    const meta = NETWORK_HIT_SORT_META.get(key)
    if (meta) return meta
  }
  const geomType = row.geom?.type
  let fallbackShp = String(row.geomKind ?? '')
  if (geomType === 'Point' || geomType === 'MultiPoint') fallbackShp = 'POINT'
  else if (geomType === 'LineString' || geomType === 'MultiLineString') {
    fallbackShp = 'LINE'
  } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
    fallbackShp = 'POLYGON'
  }
  return { shpRank: networkHitShpRank(fallbackShp), idx: 999999 }
}

/** 다중 선택 options — shp_type(POINT→LINE→POLYGON) 후 define_table_idx */
function sortNetworkHitRows(rows: WtlNetworkRow[]): WtlNetworkRow[] {
  if (rows.length < 2) return rows
  return rows.slice().sort((a, b) => {
    const ma = networkHitSortMeta(a)
    const mb = networkHitSortMeta(b)
    return ma.shpRank - mb.shpRank || ma.idx - mb.idx
  })
}
