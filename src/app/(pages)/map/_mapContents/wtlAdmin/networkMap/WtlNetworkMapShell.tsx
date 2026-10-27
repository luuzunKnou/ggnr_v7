'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Paperclip, RefreshCw, Settings, X } from 'lucide-react'
import { call } from '@/lib/api'
import {
  formatDefineFieldDisplayValue,
  type DefineCodeRow,
} from '@/lib/defineLayerCodeDisplay'
import { cn } from '@/lib/utils'
import { useMapContext } from '../../../_mapComponents/MapContext'
import { MapSideListPanel } from '../../../_mapComponents/MapSideListPanel'
import { WTL_CONS_SUPPLY_BLOCKS } from '../constructionLedger/wtlConsSample'
import {
  getDefineFieldDisplayLabel,
  getRowValueByField,
  isDefineFieldFlagTrue,
  isGeomLikeDefineFieldName,
  selectDefineLayerDetailFields,
  selectDefineLayerListFields,
  type DefineFieldLike,
} from '../../../_mapComponents/standard/defineLayerRowUtils'
import { useWtlNetworkMapLayer } from './useWtlNetworkMapLayer'
import {
  loadWtlDefineDisplayBundle,
  peekWtlDefineDisplayBundle,
  prefetchWtlDefineDisplayBundles,
  type WtlDefineDisplayBundle,
} from './wtlNetworkDefineDisplayCache'
import { WtlNetworkMapAttachmentSection } from './WtlNetworkMapAttachmentSection'
import { WtlNetworkMapStatus } from './WtlNetworkMapStatus'
import { sectionPipeOf, WtlNetworkMapSectionModal } from './WtlNetworkMapSectionModal'
import {
  resolveVisibleWtlNetMapSources,
  loadWtlNetMapSourceUiSettings,
  WtlNetMapSourceSettingsDialog,
  type WtlNetToolsPlacement,
} from './WtlNetMapSourceSettingsDialog'
import { WtlLayerMark } from './WtlLayerMark'
import { getWtlNetLayerDef } from './wtlNetworkLayerCatalog'
import {
  getWtlNetMapSource,
  pickDefaultWtlNetMapSourceId,
  setWtlNetMapSources,
  type WtlNetMapSourceId,
  type WtlNetMapSourcePayload,
} from './wtlNetworkMapSources'
import type { WtlNetworkFilterMeta, WtlNetworkRow } from './wtlNetworkTypes'

const LIST_DEFAULT = 440
const LIST_MIN = 360
const LIST_MAX = 720
const RESULT_DEFAULT = 420
const RESULT_MIN = 320
const RESULT_MAX = 680
/** 테이블 나열 페이지 건수 */
const LIST_PAGE_SIZE = 7
/** 목록 표 최소 높이(헤더+행 LIST_PAGE_SIZE) — 건수·열 수와 무관하게 유지 */
const LIST_TABLE_MIN_HEIGHT_PX = 32 + LIST_PAGE_SIZE * 28
/** 시설 상세 모달 */
const DETAIL_MODAL_WIDTH = 'min(600px, calc(100% - 2rem))'
const DETAIL_MODAL_MAX_HEIGHT = '92vh'
const DETAIL_MODAL_Z_INDEX = 10050

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
 * tables.json에 없는 항목(급수구역·보호구역)은 한글 키 유지
 */
const DISPLAY_GROUPS: { title: string; items: DisplayItem[] }[] = [
  {
    title: '관로',
    items: [
      { define_table_name: 'wtl_pipe_lm_etc', define_table_kor_name: '상수관로(기타)' },
      { define_table_name: 'wtl_pipe_lm_saa004', define_table_kor_name: '배수관로' },
      { define_table_name: 'wtl_pipe_lm_saa003', define_table_kor_name: '송수관로' },
      { define_table_name: 'wtl_sply_ls', define_table_kor_name: '급수관로' },
      { define_table_name: 'wtl_valv_ps', define_table_kor_name: '변류시설' },
      { define_table_name: 'wtl_manh_ps', define_table_kor_name: '상수맨홀' },
    ],
  },
  {
    title: '상수시설',
    items: [
      { define_table_name: 'wtl_gain_ps', define_table_kor_name: '취수장' },
      { define_table_name: 'wtl_puri_as', define_table_kor_name: '정수장' },
      { define_table_name: 'wtl_serv_ps', define_table_kor_name: '배수지' },
      { define_table_name: 'wtl_pres_ps', define_table_kor_name: '가압장' },
      { define_table_name: 'wtl_rsrv_ps', define_table_kor_name: '저수조' },
      { define_table_name: 'wtl_fire_ps', define_table_kor_name: '소방시설' },
      { define_table_name: 'wtl_flow_ps', define_table_kor_name: '유량계' },
      { define_table_name: 'wtl_prga_ps', define_table_kor_name: '수압계' },
    ],
  },
  {
    title: '급수구역',
    items: [
      { define_table_name: '급수구역', define_table_kor_name: '급수구역' },
      { define_table_name: '급수분구', define_table_kor_name: '급수분구' },
      { define_table_name: '급수블록', define_table_kor_name: '급수블록' },
    ],
  },
  {
    title: '계량기',
    items: [{ define_table_name: 'wtl_meta_ps', define_table_kor_name: '급수전계량기' }],
  },
  {
    title: '보호구역',
    items: [
      { define_table_name: '상수원 보호구역', define_table_kor_name: '상수원 보호구역' },
      { define_table_name: '공장설립 제한지역', define_table_kor_name: '공장설립 제한지역' },
    ],
  },
  {
    title: '기타',
    items: [
      { define_table_name: 'wtl_pipe_ps', define_table_kor_name: '상수관로 심도' },
      { define_table_name: 'wtl_leak_ps', define_table_kor_name: '누수지점 및 복구내역' },
      { define_table_name: 'wtl_task_as', define_table_kor_name: '상수 업데이트 내역' },
    ],
  },
]

const SEARCH_TOOLS = ['구역설정', '다운로드', '단면도', 'Excel'] as const

function allKeysOfDisplayGroup(title: string): string[] {
  const g = DISPLAY_GROUPS.find((item) => item.title === title)
  return g ? g.items.map((i) => i.define_table_name) : []
}

const INITIAL_GROUP = DISPLAY_GROUPS[0]?.title ?? '관로'
const INITIAL_LAYER_KEYS = allKeysOfDisplayGroup(INITIAL_GROUP)

/** 관망 레이어 키 → 지하시설물 패널 tableName(해당 출처 tables 기준) */
function resolveUndergroundTableNames(key: string, sourceId: string): string[] {
  const src = getWtlNetMapSource(sourceId)
  const def = getWtlNetLayerDef(key)
  if (!def?.table) return []
  const candidates = [key, def.defineTable, def.table]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
  if (!src) return [...new Set(candidates)]
  const out: string[] = []
  for (const c of candidates) {
    const remapped = src.remapTable(c)
    const hit =
      src.tables.find((t) => t.toLowerCase() === remapped.toLowerCase()) ??
      src.tables.find((t) => t.toLowerCase() === c.toLowerCase())
    if (hit) out.push(hit)
  }
  if (out.length === 0) {
    const remappedTable = src.remapTable(def.table)
    const hit = src.tables.find((t) => t.toLowerCase() === remappedTable.toLowerCase())
    if (hit) out.push(hit)
  }
  return [...new Set(out)]
}

function collectManagedUndergroundNames(sourceIds: readonly string[]): Set<string> {
  const managed = new Set<string>()
  for (const sid of sourceIds) {
    for (const g of DISPLAY_GROUPS) {
      for (const item of g.items) {
        for (const n of resolveUndergroundTableNames(item.define_table_name, sid)) {
          managed.add(n)
        }
      }
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
  const startLabel = label === '연도' ? '시작년도' : `${label} 시작`
  const endLabel = label === '연도' ? '종료년도' : `${label} 종료`

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
      <span className="standard-detail-hit-label w-16">{label}</span>
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

function statusClass(status: string): string {
  if (status === '정상') return 'standard-status-badge standard-status-badge-primary'
  if (status === '주의' || status === '노후') return 'standard-status-badge standard-status-badge-warning'
  if (status === '—' || status === '') return ''
  return 'standard-status-badge standard-status-badge-ended'
}

type ListColumn = {
  key: string
  label: string
  field?: DefineFieldLike
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

/** define_field_show_list + define_field_idx 순 헤더 */
function resolveListColumns(
  sample: WtlNetworkRow | undefined,
  geomKind: string
): { columns: ListColumn[]; codesByField: Record<string, DefineCodeRow[]> } {
  const fieldsTable = String(sample?.fieldsTable ?? '').trim()
  const fallback = String(sample?.fieldsTableFallback ?? '').trim() || null
  if (fieldsTable) {
    const bundle = peekWtlDefineDisplayBundle(fieldsTable, fallback)
    if (bundle) {
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
  }
  return { columns: fallbackListColumns(geomKind), codesByField: {} }
}

function listCellText(
  item: WtlNetworkRow,
  col: ListColumn,
  codesByField: Record<string, DefineCodeRow[]>
) {
  if (col.field) {
    const record = item.record
    if (record) {
      const raw = getRowValueByField(record, col.key)
      return formatDefineFieldDisplayValue(
        raw,
        col.field.define_field_type,
        codesByField[col.key.toLowerCase()],
        '—'
      )
    }
  }
  const legacyKey = col.key as keyof WtlNetworkRow
  const value = item[legacyKey]
  if (typeof value !== 'string' || value === '') return '—'
  return value
}

const DEFAULT_META: WtlNetworkFilterMeta = {
  yearMin: 1970,
  yearMax: new Date().getFullYear(),
  diameterMin: 0,
  diameterMax: 2000,
  materials: [],
}

export function WtlNetworkMapShell({ leftOffsetPx, onTotalWidthChange, onClose }: Props) {
  const mapContext = useMapContext()
  const [listWidth, setListWidth] = useState(LIST_DEFAULT)
  const [resultWidth, setResultWidth] = useState(RESULT_DEFAULT)
  const [extraOn, setExtraOn] = useState<Set<string>>(() => new Set(INITIAL_LAYER_KEYS))
  const [mapSources, setMapSources] = useState<Set<WtlNetMapSourceId>>(() => new Set())
  const [availableSourceIds, setAvailableSourceIds] = useState<string[]>([])
  const [visibleSourceIds, setVisibleSourceIds] = useState<string[]>([])
  const [sourceSettingsOpen, setSourceSettingsOpen] = useState(false)
  /** SSR·클라이언트 첫 페인트 동일 — localStorage는 mount 후 적용 */
  const [toolsPlacement, setToolsPlacement] = useState<WtlNetToolsPlacement>('bottom')
  useEffect(() => {
    const saved = loadWtlNetMapSourceUiSettings()
    if (!saved) return
    setToolsPlacement(saved.toolsPlacement)
  }, [])
  const listPageSize = LIST_PAGE_SIZE
  const [group, setGroup] = useState(INITIAL_GROUP)
  /** 마운트 후 탭별 첫 진입 시에만 해당 그룹 레이어 전부 켬 */
  const openedGroupTabsRef = useRef<Set<string>>(new Set([INITIAL_GROUP]))
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
  const [emdOptions, setEmdOptions] = useState<{ code: string; name: string }[]>([])
  const [riOptions, setRiOptions] = useState<{ code: string; name: string }[]>([])
  const [selected, setSelected] = useState<WtlNetworkRow | null>(null)
  const [onlyInView, setOnlyInView] = useState(true)
  const bboxRef = useRef<[number, number, number, number] | null>(null)
  const listAbortRef = useRef<AbortController | null>(null)
  const moveFetchTimerRef = useRef<number | null>(null)
  const onlyInViewRef = useRef(onlyInView)
  onlyInViewRef.current = onlyInView
  const [resultOpen, setResultOpen] = useState(true)
  const [sectionOpen, setSectionOpen] = useState(false)
  const [boxData, setBoxData] = useState<Record<string, LayerBoxData>>({})
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState('')
  /** define 목록 헤더 캐시 로드 후 재렌더 */
  const [defineListTick, setDefineListTick] = useState(0)

  const total = listWidth + (resultOpen ? resultWidth : 0)
  const enabledKeys = useMemo(() => [...extraOn], [extraOn])
  const enabledKeySet = useMemo(() => new Set(enabledKeys), [enabledKeys])
  useEffect(() => {
    onTotalWidthChange(total)
  }, [total, onTotalWidthChange])

  useEffect(() => {
    return () => onTotalWidthChange(0)
  }, [onTotalWidthChange])

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
        setMeta(data)
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
        const ids = payloads.map((s) => s.id)
        setAvailableSourceIds(ids)
        const visible = resolveVisibleWtlNetMapSources(ids)
        setVisibleSourceIds(visible)
        setMapSources(() => {
          const pick = pickDefaultWtlNetMapSourceId(visible)
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
          setVisibleSourceIds([])
          setMapSources(new Set())
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** 켜진 출처×레이어별 박스 (같은 카테고리도 테이블 분리) */
  const listSlots = useMemo((): LayerBoxSlot[] => {
    const order = DISPLAY_GROUPS.flatMap((g) => g.items)
    const slots: LayerBoxSlot[] = []
    const sourceIds = visibleSourceIds.filter((id) => mapSources.has(id))
    for (const id of sourceIds) {
      for (const item of order) {
        if (!extraOn.has(item.define_table_name)) continue
        if (!getWtlNetLayerDef(item.define_table_name)?.table) continue
        slots.push({
          key: `${id}:${item.define_table_name}`,
          layerKey: item.define_table_name,
          label: item.define_table_kor_name,
          geomKind: getWtlNetLayerDef(item.define_table_name)?.geomKind ?? 'point',
          mapSources: [id],
        })
      }
    }
    return slots
  }, [visibleSourceIds, extraOn, mapSources])

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
      pageSize = listPageSize
    ) => {
      const res = await call(
        '',
        'POST',
        {
          service: 'wtlNetworkService',
          action: 'getWtlNetworkList',
          params: {
            layerKeys: [slot.layerKey],
            mapSources: slot.mapSources,
            bbox: viewBbox ?? null,
            keyword,
            yearFrom,
            yearTo,
            diameterFrom,
            diameterTo,
            materials: [...materials],
            emdCode: emdSelected || null,
            riCode: riSelected || null,
            supplyBlock: supplyBlock || null,
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
      materials,
      emdSelected,
      riSelected,
      supplyBlock,
      listPageSize,
    ]
  )

  const fetchList = useCallback(
    async (viewBbox?: [number, number, number, number] | null) => {
      if (listSlots.length === 0) {
        cancelListFetch()
        setBoxData({})
        setListLoading(false)
        return
      }
      cancelListFetch()
      const ac = new AbortController()
      listAbortRef.current = ac
      setListLoading(true)
      setListError('')
      try {
        const entries = await Promise.all(
          listSlots.map(async (slot) => {
            const data = await fetchBoxPage(slot, 1, viewBbox, ac.signal)
            return [slot.key, data] as const
          })
        )
        if (ac.signal.aborted) return
        const next: Record<string, LayerBoxData> = {}
        for (const [key, data] of entries) {
          if (data.total > 0 || data.rows.length > 0) next[key] = data
        }
        setBoxData(next)
      } catch (e) {
        if (ac.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
        setBoxData({})
        setListError(e instanceof Error ? e.message : '목록 조회 실패')
      } finally {
        if (!ac.signal.aborted) setListLoading(false)
      }
    },
    [listSlots, fetchBoxPage, cancelListFetch]
  )

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
    const t = window.setTimeout(() => {
      void fetchList(onlyInView ? bboxRef.current : null)
    }, 280)
    return () => window.clearTimeout(t)
  }, [fetchList, onlyInView])

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

  const pickRow = async (item: WtlNetworkRow) => {
    try {
      const res = await call('', 'POST', {
        service: 'wtlNetworkService',
        action: 'getWtlNetworkDetail',
        params: { id: item.id },
      })
      const row = (res?.data ?? res)?.row as WtlNetworkRow | null | undefined
      setSelected(row ?? item)
    } catch {
      setSelected(item)
    }
  }

  const searchFilter = useMemo(
    () => ({
      yearFrom,
      yearTo,
      diameterFrom,
      diameterTo,
      materials: [...materials],
      keyword,
    }),
    [yearFrom, yearTo, diameterFrom, diameterTo, materials, keyword]
  )

  useWtlNetworkMapLayer({
    enabledLayerKeys: enabledKeySet,
    mapSources,
    availableSourceIds,
    selected,
    searchFilter,
    onSelect: (row) => {
      void pickRow(row)
    },
    onMapMoveStart: () => {
      if (!onlyInViewRef.current) return
      cancelListFetch()
      setListLoading(false)
    },
    onExtentChange: (next) => {
      bboxRef.current = next
      if (!onlyInViewRef.current) return
      cancelListFetch()
      setListLoading(false)
      moveFetchTimerRef.current = window.setTimeout(() => {
        moveFetchTimerRef.current = null
        void fetchList(bboxRef.current)
      }, 450)
    },
  })

  useEffect(() => {
    if (!selected) return
    const key = String(selected.layerKey)
    const sourceId = String(selected.id).split(':')[0] as WtlNetMapSourceId
    if (!extraOn.has(key)) {
      setSelected(null)
      return
    }
    if (getWtlNetMapSource(sourceId) && !mapSources.has(sourceId)) {
      setSelected(null)
    }
  }, [extraOn, mapSources, selected])

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
    const keys = allKeysOfDisplayGroup(group)
    setExtraOn(new Set(keys))
    openedGroupTabsRef.current = new Set([group])
    setYearFrom(meta.yearMin)
    setYearTo(meta.yearMax)
    setDiameterFrom(meta.diameterMin)
    setDiameterTo(meta.diameterMax)
    setMaterials(new Set())
    setEmdSelected('')
    setRiSelected('')
    setSupplyBlock('')
    setKeywordDraft('')
    setKeyword('')
    setSelected(null)
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

  /** 켜진 관망 레이어 → 지하시설물 패널 체크 동기화 */
  useEffect(() => {
    const setVisible = mapContext?.setVisibleLayerNames
    if (!setVisible) return
    const sourceIds = visibleSourceIds.filter((id) => mapSources.has(id))
    const managed = collectManagedUndergroundNames(availableSourceIds)
    const wanted = new Set<string>()
    for (const sid of sourceIds) {
      for (const key of extraOn) {
        for (const n of resolveUndergroundTableNames(key, sid)) wanted.add(n)
      }
    }
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
  }, [
    mapContext?.setVisibleLayerNames,
    visibleSourceIds,
    mapSources,
    availableSourceIds,
    extraOn,
  ])

  /** 탭 첫 진입 시 해당 그룹 시설 전부 켬 · 이후 재진입은 유지 */
  useEffect(() => {
    if (openedGroupTabsRef.current.has(group)) return
    openedGroupTabsRef.current.add(group)
    const keys = allKeysOfDisplayGroup(group)
    if (keys.length === 0) return
    setExtraOn((prev) => {
      const next = new Set(prev)
      for (const k of keys) next.add(k)
      return next
    })
  }, [group])

  const toggleLayer = (name: string) => {
    setExtraOn((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const toggleMapSource = (id: WtlNetMapSourceId) => {
    setMapSources((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        if (next.size <= 1) return prev
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleSourceSettingsSaved = (
    visibleIds: string[],
    nextTools: WtlNetToolsPlacement
  ) => {
    setVisibleSourceIds(visibleIds)
    setToolsPlacement(nextTools)
    setMapSources((prev) => {
      const kept = [...prev].filter((id) => visibleIds.includes(id))
      if (kept.length > 0) return new Set(kept)
      if (visibleIds[0]) return new Set([visibleIds[0]])
      return new Set()
    })
  }

  const currentGroup = DISPLAY_GROUPS.find((item) => item.title === group) ?? DISPLAY_GROUPS[0]
  const sourceButtons = visibleSourceIds
    .map((id) => getWtlNetMapSource(id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))

  const searchToolsBar = (
    <div className="flex shrink-0 gap-1 border-t border-border bg-background p-2">
      {SEARCH_TOOLS.map((label) => (
        <button
          key={label}
          type="button"
          title={label}
          className="flex h-7 min-w-0 flex-1 cursor-pointer items-center justify-center whitespace-nowrap rounded-[5px] bg-[#d7ebf1] px-0.5 text-[11px] font-semibold leading-none text-[#14607a] hover:bg-[#c5e3eb]"
          onClick={() => {
            if (label === '단면도') setSectionOpen(true)
          }}
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        className="flex h-7 min-w-0 flex-1 cursor-pointer items-center justify-center gap-0.5 whitespace-nowrap rounded-[5px] bg-[#d7ebf1] px-0.5 text-[11px] font-semibold leading-none text-[#14607a] hover:bg-[#c5e3eb]"
        title={resultOpen ? '시설목록 접기' : '시설목록 펼치기'}
        onClick={() => setResultOpen((open) => !open)}
      >
        {resultOpen ? (
          <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
        시설목록
      </button>
    </div>
  )

  return (
    <>
      <WtlNetMapSourceSettingsDialog
        open={sourceSettingsOpen}
        onOpenChange={setSourceSettingsOpen}
        availableIds={availableSourceIds}
        onSaved={handleSourceSettingsSaved}
      />
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
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-border bg-muted/40 hover:bg-muted"
                  title="관망도 그룹 설정"
                  onClick={() => setSourceSettingsOpen(true)}
                >
                  <Settings className="h-3.5 w-3.5" style={{ color: '#c8c8c8' }} aria-hidden />
                </button>
                <button type="button" className="standard-panel-close" onClick={onClose} title="닫기" aria-label="닫기">
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
                  <div className="flex border-b border-border">
                    {DISPLAY_GROUPS.map(({ title }) => {
                      const on = group === title
                      return (
                        <button
                          key={title}
                          type="button"
                          className={cn(
                            'h-7 min-w-0 flex-1 truncate px-0.5 text-center text-[11px] border-b-2 -mb-px',
                            on
                              ? 'border-primary font-semibold text-primary'
                              : 'border-transparent text-muted-foreground hover:text-foreground'
                          )}
                          onClick={() => setGroup(title)}
                        >
                          {title}
                        </button>
                      )
                    })}
                  </div>
                  {currentGroup && (
                    <div className="grid grid-cols-3 gap-1.5">
                      {currentGroup.items.map((item) => {
                        const on = extraOn.has(item.define_table_name)
                        return (
                          <button
                            key={item.define_table_name}
                            type="button"
                            title={item.define_table_kor_name}
                            className={cn(GROUP_BTN, on ? GROUP_BTN_ON : GROUP_BTN_OFF)}
                            onClick={() => toggleLayer(item.define_table_name)}
                          >
                            <WtlLayerMark layerKey={item.define_table_name} />
                            <span className="min-w-0 truncate [word-break:keep-all]">{item.define_table_kor_name}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <div className="space-y-2 !mt-[13px] border-t border-border pt-[13px]">
                    <div className="flex items-center gap-1">
                      <span className="standard-detail-hit-label w-16">위치</span>
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
                          title="리"
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
                          {WTL_CONS_SUPPLY_BLOCKS.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <DualRange
                      label="연도"
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
                      label="관경"
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
                      <span className="standard-detail-hit-label w-16 pt-0.5">재질</span>
                      <MaterialChoices
                        names={meta.materials}
                        selected={materials}
                        onToggle={toggleMaterial}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="standard-detail-hit-label w-16">통합검색</span>
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
              {toolsPlacement === 'aboveStatus' ? (
                <div className="shrink-0">{searchToolsBar}</div>
              ) : null}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <WtlNetworkMapStatus />
              </div>
            </div>
            {toolsPlacement === 'bottom' ? searchToolsBar : null}
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
                  {listLoading ? '조회 중…' : `총 ${listCount.toLocaleString()}건`}
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
                      {listLoading ? '조회 중…' : '조회된 항목이 없습니다.'}
                    </p>
                  ) : (
                    layerBoxes.map((box) => {
                      void defineListTick
                      const { columns, codesByField } = resolveListColumns(
                        box.items[0],
                        box.geomKind
                      )
                      const page = box.page
                      const from = box.total === 0 ? 0 : (page - 1) * listPageSize + 1
                      const to = (page - 1) * listPageSize + box.items.length
                      const hasNext = page * listPageSize < box.total
                      return (
                        <div
                          key={box.key}
                          className="overflow-hidden rounded border border-border bg-background"
                        >
                          <div className="flex min-w-0 items-center gap-1.5 border-b border-border bg-muted/50 px-2 py-1.5">
                            <WtlLayerMark layerKey={box.layerKey} />
                            <span className="min-w-0 truncate text-[11px] font-medium text-foreground">
                              {box.label}
                            </span>
                            <span className="standard-detail-hint shrink-0">
                              · {box.total.toLocaleString()}건
                            </span>
                          </div>
                          <div
                            className="overflow-x-auto"
                            style={{ minHeight: LIST_TABLE_MIN_HEIGHT_PX }}
                          >
                            <table className="standard-list-table">
                              <thead className="standard-table-thead">
                                <tr>
                                  {columns.map((col) => (
                                    <th
                                      key={col.key}
                                      className="standard-table-th standard-table-th-left"
                                    >
                                      {col.label}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {box.items.map((item) => (
                                  <tr
                                    key={item.id}
                                    className={cn(
                                      'standard-list-row',
                                      selected?.id === item.id && 'standard-list-row-selected'
                                    )}
                                    onClick={() => void pickRow(item)}
                                  >
                                    {columns.map((col) => (
                                      <td key={col.key} className="standard-table-td-compact">
                                        {listCellText(item, col, codesByField)}
                                      </td>
                                    ))}
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
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
          </MapSideListPanel>
        </div>
      )}
      <NetworkDetailModal
        item={selected}
        overlayLeftPx={leftOffsetPx}
        overlayWidthPx={total}
        onClose={() => setSelected(null)}
      />
      <WtlNetworkMapSectionModal
        open={sectionOpen}
        pipe={sectionPipeOf(null)}
        onClose={() => setSectionOpen(false)}
      />
    </>
  )
}

function NetworkDetailModal({
  item,
  overlayLeftPx,
  overlayWidthPx,
  onClose,
}: {
  item: WtlNetworkRow | null
  overlayLeftPx: number
  overlayWidthPx: number
  onClose: () => void
}) {
  const open = item != null
  const fieldsTable = String(item?.fieldsTable ?? '').trim()
  const fieldsFallback = String(item?.fieldsTableFallback ?? '').trim() || null
  const bundleKey = fieldsTable
    ? `${fieldsTable.toLowerCase()}\0${(fieldsFallback ?? '').toLowerCase()}`
    : ''
  /** 캐시 히트는 렌더 동기 — row 전환 시 영문→한글 깜빡임 방지 */
  const peeked = fieldsTable
    ? peekWtlDefineDisplayBundle(fieldsTable, fieldsFallback)
    : null
  const [loaded, setLoaded] = useState<WtlDefineDisplayBundle | null>(null)
  const [loadedKey, setLoadedKey] = useState('')
  const bundle = peeked ?? (loadedKey === bundleKey ? loaded : null)
  const fieldsReady = bundle != null
  const fields = fieldsReady ? bundle.fields : []
  const codesByField = fieldsReady ? bundle.codesByField : {}
  const fieldsLoading = open && Boolean(fieldsTable) && !fieldsReady

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !fieldsTable) {
      setLoaded(null)
      setLoadedKey('')
      return
    }
    if (peekWtlDefineDisplayBundle(fieldsTable, fieldsFallback)) return
    let cancelled = false
    void loadWtlDefineDisplayBundle(fieldsTable, fieldsFallback).then((next) => {
      if (cancelled) return
      setLoaded(next)
      setLoadedKey(bundleKey)
    })
    return () => {
      cancelled = true
    }
  }, [open, fieldsTable, fieldsFallback, bundleKey])

  const detailFields = useMemo(() => selectDefineLayerDetailFields(fields), [fields])

  const attrRows = useMemo(() => {
    if (!item) return [] as Array<{ key: string; label: string; value: string }>
    if (fieldsLoading) return []
    const record = item.record ?? null
    if (record && detailFields.length > 0) {
      return detailFields.map((f, i) => {
        const key = String(f.define_field_name ?? '').trim()
        const label = getDefineFieldDisplayLabel(key, f.define_field_kor_name)
        const raw = getRowValueByField(record, key)
        const value = formatDefineFieldDisplayValue(
          raw,
          f.define_field_type,
          codesByField[key.toLowerCase()],
          '—'
        )
        return { key: key || `f-${i}`, label, value }
      })
    }
    if (record) {
      return Object.entries(record)
        .filter(([k]) => !isGeomLikeDefineFieldName(k) && k.toLowerCase() !== 'gid')
        .map(([k, v], i) => ({
          key: k || `auto-${i}`,
          label: getDefineFieldDisplayLabel(k),
          value: formatDefineFieldDisplayValue(v, undefined, undefined, '—'),
        }))
    }
    if (item.attrs?.length) {
      return item.attrs.map((a, i) => ({
        key: `${a.label}-${i}`,
        label: a.label,
        value: a.value,
      }))
    }
    return [
      { key: 'name', label: '관리번호', value: item.name },
      { key: 'diameter', label: '구경', value: item.diameter },
      { key: 'material', label: '재질', value: item.material },
      { key: 'length', label: '연장', value: item.length },
      { key: 'year', label: '설치연도', value: item.year },
    ]
  }, [item, detailFields, codesByField, fieldsLoading])

  const titleField = useMemo(() => {
    if (!fieldsReady || !item) return item?.name ?? ''
    const title = fields.find((f) => isDefineFieldFlagTrue(f.define_field_show_title))
    if (!title || !item.record) return item.name
    const key = String(title.define_field_name ?? '').trim()
    const raw = getRowValueByField(item.record, key)
    const text = formatDefineFieldDisplayValue(
      raw,
      title.define_field_type,
      codesByField[key.toLowerCase()],
      ''
    )
    return text || item.name
  }, [fields, item, codesByField, fieldsReady])

  /** 목록 박스와 동일 — DISPLAY_GROUPS 한글명 */
  const layerKorName = useMemo(() => {
    const key = String(item?.layerKey ?? '').trim()
    if (!key) return ''
    for (const group of DISPLAY_GROUPS) {
      const hit = group.items.find((i) => i.define_table_name === key)
      if (hit) return hit.define_table_kor_name
    }
    return key
  }, [item?.layerKey])

  if (!open || !item || overlayWidthPx <= 0 || typeof document === 'undefined') return null

  const subtitle = titleField || item.name

  return createPortal(
    <div
      className="pointer-events-auto fixed box-border flex min-h-0 items-center justify-center overflow-y-auto bg-black/50 p-6"
      style={{
        zIndex: DETAIL_MODAL_Z_INDEX,
        left: overlayLeftPx,
        top: 0,
        width: overlayWidthPx,
        height: '100dvh',
        maxHeight: '100dvh',
      }}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative flex w-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
        style={{ width: DETAIL_MODAL_WIDTH, maxHeight: DETAIL_MODAL_MAX_HEIGHT }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="standard-panel-header">
          <div className="min-w-0 flex-1 pr-2">
            <span className="block truncate text-xs font-medium text-foreground">
              {layerKorName || '시설 상세'}
            </span>
            {subtitle ? (
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                {subtitle}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            title="닫기"
            onClick={onClose}
            className="standard-panel-close"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-2">
            {fieldsLoading ? (
              <p className="standard-detail-loading">필드 설정 불러오는 중…</p>
            ) : attrRows.length === 0 ? (
              <p className="standard-detail-attr-empty">표시할 속성이 없습니다.</p>
            ) : (
              <div className="overflow-hidden rounded border border-border">
                <table className="w-full table-fixed border-collapse">
                  <colgroup>
                    <col className="w-[120px]" />
                    <col />
                    <col className="w-[120px]" />
                    <col />
                  </colgroup>
                  <tbody>
                    {Array.from({ length: Math.ceil(attrRows.length / 2) }, (_, i) => {
                      const left = attrRows[i * 2]
                      const right = attrRows[i * 2 + 1]
                      const renderValue = (row: (typeof attrRows)[number]) =>
                        row.label === '상태' ? (
                          <span className={statusClass(row.value)}>{row.value}</span>
                        ) : (
                          row.value
                        )
                      return (
                        <tr key={`${left.key}-${right?.key ?? i}`}>
                          <th
                            scope="row"
                            className="standard-detail-attr-label border border-border text-left align-top font-normal"
                          >
                            {left.label}
                          </th>
                          <td className="standard-detail-attr-value border border-border align-top text-foreground">
                            {renderValue(left)}
                          </td>
                          <th
                            scope="row"
                            className="standard-detail-attr-label border border-border text-left align-top font-normal"
                          >
                            {right ? right.label : '\u00a0'}
                          </th>
                          <td className="standard-detail-attr-value border border-border align-top text-foreground">
                            {right ? renderValue(right) : '\u00a0'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-col border-t border-border">
            <div className="flex shrink-0 overflow-x-auto px-2">
              <span
                className="flex shrink-0 items-center justify-center gap-1.5 border-b-2 border-primary bg-primary/5 px-3 py-2.5 text-xs font-medium text-primary"
                title="첨부파일"
              >
                <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden />
                첨부파일
              </span>
            </div>
            <div className="h-[250px] shrink-0 overflow-hidden px-3 pb-2 pt-1">
              <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
                <WtlNetworkMapAttachmentSection item={item} fields={fields} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
