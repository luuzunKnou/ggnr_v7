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
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2, RefreshCw, X } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import { useMapContext } from '../../../_mapComponents/MapContext'
import { canStartMapDrawInteraction } from '../../../_mapComponents/mapDrawInteraction'
import { MapFloatingPanel } from '../../../_mapComponents/MapFloatingPanel'
import { MapSideListPanel } from '../../../_mapComponents/MapSideListPanel'
import {
  getDefineFieldDisplayLabel,
  getRowValueByField,
  isDefineFieldFlagTrue,
  isGeomLikeDefineFieldName,
  selectDefineLayerDetailFields,
  selectDefineLayerListFields,
  type DefineFieldLike,
} from '../../../_mapComponents/standard/defineLayerRowUtils'
import { resolveWtlNetworkRowEditTarget } from './WtlNetworkMapAttachmentSection'
import {
  useWtlNetworkMapLayer,
  type WtlNetworkDetailRelatedLayer,
} from './useWtlNetworkMapLayer'
import { WtlNetworkDetailRelatedTabs } from './WtlNetworkDetailRelatedTabs'
import {
  loadWtlDefineDisplayBundle,
  peekWtlDefineDisplayBundle,
  prefetchWtlDefineDisplayBundles,
  type WtlDefineDisplayBundle,
} from './wtlNetworkDefineDisplayCache'
import { WtlNetworkMapStatus } from './WtlNetworkMapStatus'
import { exportWtlNetworkMapExcel } from './exportWtlNetworkMapExcel'
import {
  WtlNetworkExportMenu,
  type WtlNetworkExportLayerOption,
  type WtlNetworkExportScope,
} from './WtlNetworkExportMenu'
import { flyToWtlNetworkGeom } from './wtlNetworkMapFly'
import { WtlNetworkSectionPanel } from './section/WtlNetworkSectionPanel'
import { useWtlNetworkSection } from './section/useWtlNetworkSection'
import { WtlLayerMark } from './WtlLayerMark'
import { getWtlNetLayerDef, isWtlNetZoneLayerKey } from './wtlNetworkLayerCatalog'
import {
  getWtlNetMapSource,
  getWtlNetMapSources,
  getWtlNetPhysicalTable,
  pickDefaultWtlNetMapSourceId,
  setWtlNetMapSources,
  setWtlNetPhysicalBySource,
  wtlNetKorNameForTable,
  type WtlNetMapSourceId,
  type WtlNetMapSourcePayload,
} from './wtlNetworkMapSources'
import { facilityTabLabel } from '../facility/wtlFacilityCatalog'
import adminTabsJson from '@/config/wtlAdmin/adminTabs.json'
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
/** 시설 상세 플로팅 모달. 단면도(10100)보다 아래 */
const DETAIL_MODAL_WIDTH = 'min(600px, calc(100vw - 2rem))'
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
 *
 * 지도 표시 경로
 * - 지하시설물 동기화: 관로·상수시설·급수구역·계량기·기타
 * - 주제도 동기화: 보호구역
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

const SEARCH_TOOLS = ['구역설정', '다운로드', '단면도', 'Excel'] as const

function allKeysOfDisplayGroup(title: string): string[] {
  const g = DISPLAY_GROUPS.find((item) => item.title === title)
  return g ? g.items.map((i) => i.define_table_name) : []
}

function allKeysOfAllDisplayGroups(): string[] {
  return DISPLAY_GROUPS.flatMap((g) => g.items.map((i) => i.define_table_name))
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

  // 한글명·DB 데이터 실존 기준 물리 테이블 (저수조 tank/rsrv 등)
  if (!isVirtualSplit) {
    const phys = getWtlNetPhysicalTable(key, sourceId)
    if (phys) return [phys]
  }

  const src = getWtlNetMapSource(sourceId)
  const out: string[] = []

  if (isVirtualSplit) {
    if (keyName) out.push(keyName)
    if (defineName && defineName.toLowerCase() !== keyName.toLowerCase()) {
      out.push(defineName)
    }
    if (src) {
      const remappedBase = src.remapTable(baseTable)
      const physical =
        src.tables.find((t) => t.toLowerCase() === remappedBase.toLowerCase()) ??
        src.tables.find((t) => t.toLowerCase() === baseTable.toLowerCase())
      // 접두 remap(대진)만 — 상수 wtl_pipe_lm 부모는 제외
      if (physical && physical.toLowerCase() !== baseTable.toLowerCase()) {
        out.push(physical)
      }
      for (const c of [keyName, defineName]) {
        if (!c) continue
        const remapped = src.remapTable(c)
        const hit =
          src.tables.find((t) => t.toLowerCase() === remapped.toLowerCase()) ??
          src.tables.find((t) => t.toLowerCase() === c.toLowerCase())
        if (hit) out.push(hit)
      }
    }
    return [...new Set(out.filter(Boolean))]
  }

  if (src) {
    const remapped = src.remapTable(baseTable)
    const hit =
      src.tables.find((t) => t.toLowerCase() === remapped.toLowerCase()) ??
      src.tables.find((t) => t.toLowerCase() === baseTable.toLowerCase())
    if (hit) out.push(hit)
    else if (baseTable) {
      // 출처 그룹 밖(시설관리 CCTV 등) — 물리명 그대로 지하시설물 동기화
      out.push(baseTable)
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
  /** 지도 레이어 클릭 시 상세 강제 펼침 (목록 행 선택은 접힘 유지) */
  const [detailExpandToken, setDetailExpandToken] = useState(0)

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
  /** 시설목록 레이어 박스 접힘 (key = box.key) */
  const [collapsedBoxKeys, setCollapsedBoxKeys] = useState<Set<string>>(() => new Set())
  const [excelExporting, setExcelExporting] = useState(false)
  const [shpExporting, setShpExporting] = useState(false)
  const [boxData, setBoxData] = useState<Record<string, LayerBoxData>>({})
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState('')
  /** define 목록 헤더 캐시 로드 후 재렌더 */
  const [defineListTick, setDefineListTick] = useState(0)

  const total = listWidth + (resultOpen ? resultWidth : 0)
  const enabledKeys = useMemo(() => [...extraOn], [extraOn])
  const enabledKeySet = useMemo(() => new Set(enabledKeys), [enabledKeys])
  const section = useWtlNetworkSection(enabledKeys)
  useEffect(() => {
    onTotalWidthChange(total)
  }, [total, onTotalWidthChange])

  useEffect(() => {
    return () => onTotalWidthChange(0)
  }, [onTotalWidthChange])

  useEffect(() => {
    return () => {
      mapContext?.setSpatialFilterWkt?.(null)
    }
  }, [mapContext?.setSpatialFilterWkt])

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

  /** 선택 출처 기준 — DB에 없는 탭 레이어는 비활성 */
  useEffect(() => {
    const sourceIds = availableSourceIds.filter((id) => mapSources.has(id))
    if (availableSourceIds.length === 0) {
      setAvailableLayerKeys(new Set())
      setPhysicalBySource({})
      setWtlNetPhysicalBySource({})
      return
    }
    if (sourceIds.length === 0) return
    let cancelled = false
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
        const next = new Set<string>(keys)
        const physRaw =
          data?.physicalBySource && typeof data.physicalBySource === 'object'
            ? (data.physicalBySource as Record<string, Record<string, string>>)
            : {}
        setPhysicalBySource(physRaw)
        setWtlNetPhysicalBySource(physRaw)
        setAvailableLayerKeys(next)
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
  }, [availableSourceIds, mapSources])

  /** 선택 키×출처별 목록/내보내기 슬롯 */
  const buildSlotsForKeys = useCallback(
    (selected: Iterable<string>): LayerBoxSlot[] => {
      const on = new Set(
        [...selected].map((k) => String(k).trim().toLowerCase()).filter(Boolean)
      )
      const order = DISPLAY_GROUPS.flatMap((g) => g.items)
      const slots: LayerBoxSlot[] = []
      const sourceIds = availableSourceIds.filter((id) => mapSources.has(id))
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
          if (resolveUndergroundTableNames(key, sid).length === 0) continue
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
          if (resolveUndergroundTableNames(key, id).length === 0) continue
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
  const listSlots = useMemo(
    () => buildSlotsForKeys(extraOn),
    [buildSlotsForKeys, extraOn]
  )

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
    (scope: WtlNetworkExportScope, exportSlots: LayerBoxSlot[]) => {
      const all = scope === 'all'
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
      return {
        scope,
        layerKeys,
        mapSources: mapSourceIds,
        bbox: all ? null : onlyInViewRef.current ? bboxRef.current : null,
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
    async (scope: WtlNetworkExportScope, layerKeys: string[]) => {
      if (shpExporting) return
      const exportSlots = buildSlotsForKeys(layerKeys)
      if (exportSlots.length === 0) {
        window.alert('내보낼 시설목록이 없습니다.')
        return
      }
      setShpExporting(true)
      try {
        const res = await fetch('/api/download/wtl-network-shp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildExportFilterBody(scope, exportSlots)),
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
        const fileName = rawName?.trim() || '관망조회_SHP.zip'
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
    },
    [shpExporting, buildSlotsForKeys, buildExportFilterBody]
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
      setBoxData({})
      let failed = 0
      await Promise.all(
        listSlots.map(async (slot) => {
          try {
            const data = await fetchBoxPage(slot, 1, viewBbox, ac.signal)
            if (ac.signal.aborted || listAbortRef.current !== ac) return
            if (data.total <= 0 && data.rows.length === 0) return
            setBoxData((prev) => ({ ...prev, [slot.key]: data }))
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
    moveFetchTimerRef.current = window.setTimeout(() => {
      moveFetchTimerRef.current = null
      if (availableLayerKeysRef.current == null) return
      const inView = onlyInViewRef.current
      const bbox = bboxRef.current
      if (inView && !bbox) return
      void (async () => {
        const result = await fetchList(inView ? bbox : null)
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

  /** 시설목록 행·지도 클릭 공통. fly=true 일 때만 해당 도형으로 맵 이동 */
  const pickRow = async (item: WtlNetworkRow, opts?: { fly?: boolean }) => {
    let next: WtlNetworkRow = item
    try {
      const res = await call('', 'POST', {
        service: 'wtlNetworkService',
        action: 'getWtlNetworkDetail',
        params: { id: item.id },
      })
      const row = (res?.data ?? res)?.row as WtlNetworkRow | null | undefined
      next = row ?? item
      setSelected(next)
    } catch {
      setSelected(item)
      next = item
    }
    if (opts?.fly) {
      const map = mapContext?.mapInstanceRef?.current
      flyToWtlNetworkGeom(
        map,
        next.geom,
        () => mapContext?.applyMapViewPaddingRef?.current?.()
      )
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
      diameterFrom: diameter.from,
      diameterTo: diameter.to,
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
    onSelect: (row) => {
      setDetailExpandToken((n) => n + 1)
      void pickRow(row)
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

  const handleDetailRelatedLayer = useCallback((next: WtlNetworkDetailRelatedLayer) => {
    setDetailRelatedLayer((prev) => {
      if (prev == null && next == null) return prev
      if (
        prev &&
        next &&
        prev.table === next.table &&
        prev.ftrIdn === next.ftrIdn
      ) {
        return prev
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (!selected) setDetailRelatedLayer(null)
  }, [selected])

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
    setExtraOn(
      availableLayerKeys && availableLayerKeys.size > 0
        ? new Set(availableLayerKeys)
        : new Set(allKeysOfAllDisplayGroups())
    )
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
   */
  useEffect(() => {
    const setVisible = mapContext?.setVisibleLayerNames
    if (!setVisible) return
    if (availableLayerKeys == null) return
    const sourceIds = availableSourceIds.filter((id) => mapSources.has(id))
    if (sourceIds.length === 0) return
    // 다른 출처(예: 상수(대진)) 테이블은 managed에 넣지 않음 — 지우지 않음
    const managed = collectManagedUndergroundNames(sourceIds)
    const wanted = new Set<string>()
    for (const key of extraOn) {
      if (getLayerShowMode(key) !== 'underground') continue
      for (const sid of sourceIds) {
        for (const n of resolveUndergroundTableNames(key, sid)) wanted.add(n)
      }
    }
    skipUfToNetworkSyncRef.current = true
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
    networkUfForwardReadyRef.current = true
    const t = window.setTimeout(() => {
      skipUfToNetworkSyncRef.current = false
    }, 0)
    return () => {
      window.clearTimeout(t)
      skipUfToNetworkSyncRef.current = false
    }
  }, [
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
    const sourceIds = availableSourceIds.filter((id) => mapSources.has(id))
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
      return availableLayerKeys.has(name)
    },
    [availableLayerKeys]
  )

  /** DB에 레이어가 하나라도 있는 카테고리만 탭 표시. 출처 변경 시 availableLayerKeys가 갱신되면 다시 계산 */
  const visibleDisplayGroups = useMemo(() => {
    if (availableLayerKeys == null) return DISPLAY_GROUPS
    return DISPLAY_GROUPS.filter((g) =>
      g.items.some((item) => availableLayerKeys.has(item.define_table_name))
    )
  }, [availableLayerKeys])

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

  const searchToolsBar = (
    <div className="flex shrink-0 gap-1 border-t border-border bg-background p-2">
      {SEARCH_TOOLS.map((label) => {
        if (label === '다운로드') {
          return (
            <WtlNetworkExportMenu
              key={label}
              label="다운로드"
              title="SHP 다운로드"
              busy={shpExporting}
              busyLabel="SHP…"
              layers={EXPORT_LAYER_OPTIONS}
              selectedKeys={enabledKeys}
              availableKeys={availableLayerKeys}
              onConfirm={(scope, keys) => void handleShpExport(scope, keys)}
            />
          )
        }
        if (label === 'Excel') {
          return (
            <WtlNetworkExportMenu
              key={label}
              label="Excel"
              title="Excel 다운로드"
              busy={excelExporting}
              busyLabel="Excel…"
              layers={EXPORT_LAYER_OPTIONS}
              selectedKeys={enabledKeys}
              availableKeys={availableLayerKeys}
              onConfirm={(scope, keys) => void handleExcelExport(scope, keys)}
            />
          )
        }
        const isZone = label === '구역설정'
        const isSection = label === '단면도'
        const title = isZone ? zoneToolLabel : isSection && section.drawing ? '단면취소' : label
        return (
          <button
            key={label}
            type="button"
            title={title}
            className={cn(
              'flex h-7 min-w-0 flex-1 cursor-pointer items-center justify-center whitespace-nowrap rounded-[5px] px-0.5 text-[11px] font-semibold leading-none',
              (isZone && (zoneDrawing || zoneWkt5181)) || (isSection && (section.drawing || section.panelOpen))
                ? 'bg-[#14607a] text-white hover:bg-[#0f4d62] dark:bg-[#d7ebf1] dark:text-[#14607a] dark:hover:bg-[#c5e3eb]'
                : 'bg-[#d7ebf1] text-[#14607a] hover:bg-[#c5e3eb] dark:bg-[#14607a] dark:text-[#d7ebf1] dark:hover:bg-[#0f4d62]'
            )}
            onClick={() => {
              if (isZone) handleZoneTool()
              if (isSection) section.startSection()
            }}
          >
            {isZone ? zoneToolLabel : isSection && section.drawing ? '단면취소' : label}
          </button>
        )
      })}
      <button
        type="button"
        className="flex h-7 min-w-0 flex-1 cursor-pointer items-center justify-center gap-0.5 whitespace-nowrap rounded-[5px] bg-[#d7ebf1] px-0.5 text-[11px] font-semibold leading-none text-[#14607a] hover:bg-[#c5e3eb] dark:bg-[#14607a] dark:text-[#d7ebf1] dark:hover:bg-[#0f4d62]"
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
                  {visibleDisplayGroups.length > 0 ? (
                    <div className="flex border-b border-border">
                      {visibleDisplayGroups.map(({ title }) => {
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
                  ) : null}
                  {currentGroup && (
                    <div className="grid grid-cols-3 gap-1.5">
                      {currentGroup.items.map((item) => {
                        const selectable = isLayerSelectable(item.define_table_name)
                        const on = selectable && extraOn.has(item.define_table_name)
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
                            disabled={!selectable}
                            title={
                              selectable
                                ? titleBase
                                : `${item.define_table_kor_name} (데이터 없음)`
                            }
                            className={cn(
                              GROUP_BTN,
                              on ? GROUP_BTN_ON : GROUP_BTN_OFF,
                              !selectable &&
                                'cursor-not-allowed opacity-40 hover:bg-transparent'
                            )}
                            onClick={() => toggleLayer(item.define_table_name)}
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
                </div>
              </div>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <WtlNetworkMapStatus
                  mapSources={statusMapSources}
                  listFilter={statusListFilter}
                  filterMeta={meta}
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
                  {listLoading && layerBoxes.length === 0
                    ? '조회 중…'
                    : listLoading
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
                      {listLoading ? '조회 중…' : '조회된 항목이 없습니다.'}
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
                                        onClick={() =>
                                          void pickRow(item, { fly: !onlyInView })
                                        }
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
      <NetworkDetailModal
        item={selected}
        expandToken={detailExpandToken}
        anchorLeftPx={leftOffsetPx + listWidth + (resultOpen ? resultWidth : 0) + 8}
        onClose={() => setSelected(null)}
        onRelatedMapLayer={handleDetailRelatedLayer}
        onItemUpdated={(next) => {
          setSelected(next)
          setBoxData((prev) => {
            let changed = false
            const out: Record<string, LayerBoxData> = {}
            for (const [key, data] of Object.entries(prev)) {
              const idx = data.rows.findIndex((r) => r.id === next.id)
              if (idx < 0) {
                out[key] = data
                continue
              }
              changed = true
              const rows = data.rows.slice()
              rows[idx] = {
                ...rows[idx],
                ...next,
                geom: next.geom ?? rows[idx]?.geom,
              }
              out[key] = { ...data, rows }
            }
            return changed ? out : prev
          })
        }}
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
        onClose={section.closePanel}
        onRedraw={section.redrawSection}
      />
    </>
  )
}

function NetworkDetailModal({
  item,
  expandToken = 0,
  anchorLeftPx,
  onClose,
  onRelatedMapLayer,
  onItemUpdated,
}: {
  item: WtlNetworkRow | null
  /** 지도 클릭마다 증가 — 접힌 상세를 펼침. 목록 선택은 올리지 않음 */
  expandToken?: number
  /** 시설목록 패널 오른쪽 끝 */
  anchorLeftPx: number
  onClose: () => void
  onRelatedMapLayer: (next: WtlNetworkDetailRelatedLayer) => void
  onItemUpdated: (next: WtlNetworkRow) => void
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

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  const cancelEdit = useCallback(() => {
    setEditing(false)
    setDraft({})
    setEditError(null)
  }, [])

  useEffect(() => {
    cancelEdit()
  }, [item?.id, cancelEdit])

  useEffect(() => {
    if (expandToken > 0) setCollapsed(false)
  }, [expandToken])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (editing) {
        cancelEdit()
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, editing, cancelEdit])

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

  type FieldEditMeta = DefineFieldLike & {
    define_field_is_key?: unknown
    define_field_read_only?: unknown
  }

  const keyFieldName = useMemo(() => {
    const hit = (fields as FieldEditMeta[]).find((f) =>
      isDefineFieldFlagTrue(f.define_field_is_key)
    )
    return String(hit?.define_field_name ?? '').trim() || null
  }, [fields])

  const editTarget = useMemo(() => {
    if (!item || !fieldsReady) return null
    return resolveWtlNetworkRowEditTarget(item, fields)
  }, [item, fields, fieldsReady])

  const canEdit = Boolean(item?.record && editTarget && detailFields.length > 0)

  type AttrRow = {
    key: string
    label: string
    value: string
    readOnly: boolean
    editable: boolean
    title: boolean
  }

  const attrRows = useMemo(() => {
    if (!item) return [] as AttrRow[]
    if (fieldsLoading) return []
    const record = item.record ?? null
    if (record && detailFields.length > 0) {
      return (detailFields as FieldEditMeta[]).map((f, i) => {
        const key = String(f.define_field_name ?? '').trim()
        const label = getDefineFieldDisplayLabel(key, f.define_field_kor_name)
        const raw = getRowValueByField(record, key)
        const value = formatDefineFieldDisplayValue(
          raw,
          f.define_field_type,
          codesByField[key.toLowerCase()],
          '—'
        )
        const isKey = Boolean(
          key && keyFieldName && key.toLowerCase() === keyFieldName.toLowerCase()
        )
        const readOnly =
          isKey ||
          isDefineFieldFlagTrue(f.define_field_read_only) ||
          isGeomLikeDefineFieldName(key)
        return {
          key: key || `f-${i}`,
          label,
          value,
          readOnly,
          editable: Boolean(key) && !readOnly,
          title: isDefineFieldFlagTrue(f.define_field_show_title),
        }
      })
    }
    if (record) {
      return Object.entries(record)
        .filter(([k]) => !isGeomLikeDefineFieldName(k) && k.toLowerCase() !== 'gid')
        .map(([k, v], i) => ({
          key: k || `auto-${i}`,
          label: getDefineFieldDisplayLabel(k),
          value: formatDefineFieldDisplayValue(v, undefined, undefined, '—'),
          readOnly: true,
          editable: false,
          title: false,
        }))
    }
    if (item.attrs?.length) {
      return item.attrs.map((a, i) => ({
        key: `${a.label}-${i}`,
        label: a.label,
        value: a.value,
        readOnly: true,
        editable: false,
        title: false,
      }))
    }
    return [
      { key: 'name', label: '관리번호', value: item.name, readOnly: true, editable: false, title: false },
      { key: 'diameter', label: '구경', value: item.diameter, readOnly: true, editable: false, title: false },
      { key: 'material', label: '재질', value: item.material, readOnly: true, editable: false, title: false },
      { key: 'length', label: '연장', value: item.length, readOnly: true, editable: false, title: false },
      { key: 'year', label: '설치연도', value: item.year, readOnly: true, editable: false, title: false },
    ]
  }, [item, detailFields, codesByField, fieldsLoading, keyFieldName])

  const beginEdit = useCallback(() => {
    if (!canEdit || !item?.record) return
    const next: Record<string, string> = {}
    for (const row of attrRows) {
      if (!row.editable) continue
      const raw = getRowValueByField(item.record, row.key)
      next[row.key] = raw == null ? '' : String(raw)
    }
    setDraft(next)
    setEditError(null)
    setEditing(true)
  }, [canEdit, item, attrRows])

  const refreshSelectedItem = useCallback(async () => {
    if (!item) return
    try {
      const detailRes = await call('', 'POST', {
        service: 'wtlNetworkService',
        action: 'getWtlNetworkDetail',
        params: { id: item.id },
      })
      const refreshed =
        ((detailRes?.data ?? detailRes)?.row as WtlNetworkRow | null | undefined) ?? null
      if (refreshed) onItemUpdated(refreshed)
    } catch {
      /* 목록·상세는 기존 값 유지 */
    }
  }, [item, onItemUpdated])

  const handleSave = useCallback(async () => {
    if (!item || !editTarget || !item.record) return
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
      const updatedRecord: Record<string, unknown> = { ...item.record, ...draft }
      let refreshed: WtlNetworkRow | null = null
      try {
        const detailRes = await call('', 'POST', {
          service: 'wtlNetworkService',
          action: 'getWtlNetworkDetail',
          params: { id: item.id },
        })
        refreshed = ((detailRes?.data ?? detailRes)?.row as WtlNetworkRow | null | undefined) ?? null
      } catch {
        refreshed = null
      }
      const next: WtlNetworkRow = refreshed
        ? { ...refreshed, record: refreshed.record ?? updatedRecord }
        : { ...item, record: updatedRecord }
      onItemUpdated(next)
      setEditing(false)
      setDraft({})
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : '수정에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }, [item, editTarget, draft, onItemUpdated])

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

  if (!open || !item) return null

  const subtitle = titleField || item.name

  const renderCellValue = (row: AttrRow) => {
    if (editing && row.editable) {
      return (
        <input
          className="standard-detail-input h-6 w-full min-w-0"
          value={draft[row.key] ?? ''}
          disabled={saving}
          title={row.label}
          onChange={(e) =>
            setDraft((prev) => ({
              ...prev,
              [row.key]: e.target.value,
            }))
          }
        />
      )
    }
    if (row.label === '상태') {
      return <span className={statusClass(row.value)}>{row.value}</span>
    }
    return row.value
  }

  return (
    <MapFloatingPanel
      viewport
      width={DETAIL_MODAL_WIDTH}
      maxHeight={DETAIL_MODAL_MAX_HEIGHT}
      defaultPosition={{ top: 72, left: anchorLeftPx }}
      className="bg-background backdrop-blur-none"
      style={{ zIndex: DETAIL_MODAL_Z_INDEX }}
      header={
        <>
          <button
            type="button"
            title={collapsed ? '펼치기' : '접기'}
            aria-label={collapsed ? '펼치기' : '접기'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((v) => !v)}
            className="standard-panel-close mr-2 cursor-pointer"
          >
            <ChevronUp
              className={cn('h-4 w-4', collapsed && 'rotate-180')}
              aria-hidden
            />
          </button>
          <div className="min-w-0 flex-1 pr-2">
            <span
              className="block truncate text-xs font-medium text-foreground"
              title={subtitle || layerKorName || '시설 상세'}
            >
              {subtitle || layerKorName || '시설 상세'}
            </span>
            {layerKorName && subtitle ? (
              <span
                className="mt-0.5 block truncate text-[11px] text-muted-foreground"
                title={layerKorName}
              >
                {layerKorName}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            title="닫기"
            onClick={() => {
              if (editing) cancelEdit()
              onClose()
            }}
            className="standard-panel-close cursor-pointer"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </>
      }
    >
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-hidden bg-background',
          collapsed && 'hidden'
        )}
      >
          <div className="standard-detail-scroll">
            {fieldsLoading ? (
              <p className="standard-detail-loading">필드 설정 불러오는 중…</p>
            ) : attrRows.length === 0 ? (
              <p className="standard-detail-attr-empty">표시할 속성이 없습니다.</p>
            ) : (
              <div className="standard-detail-attr-table">
                {attrRows.map((row) => (
                  <div key={row.key} className="contents">
                    <div title={ true ? `${row.label} (${row.key})`: row.label} className="standard-detail-attr-label standard-detail-attr-cell-border">
                      {row.label}
                    </div>
                    <div
                      className={cn(
                        'standard-detail-attr-value standard-detail-attr-cell-border',
                        row.title && !editing
                          ? 'standard-detail-attr-value-title'
                          : 'text-foreground'
                      )}
                      title={editing && row.editable ? row.label : row.value}
                    >
                      {renderCellValue(row)}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {editError ? (
              <p className="standard-detail-error mt-2" role="alert">
                {editError}
              </p>
            ) : null}
          </div>
          {!editing ? (
            <WtlNetworkDetailRelatedTabs
              item={item}
              fields={fields}
              onRelatedMapLayer={onRelatedMapLayer}
              onHistoryReverted={() => void refreshSelectedItem()}
            />
          ) : null}
          <div className="standard-detail-edit-footer">
            {editing ? (
              <>
                <button
                  type="button"
                  title="취소"
                  disabled={saving}
                  onClick={cancelEdit}
                  className="standard-detail-hdr-btn"
                >
                  취소
                </button>
                <button
                  type="button"
                  title={saving ? '저장 중…' : '저장'}
                  disabled={saving}
                  onClick={() => void handleSave()}
                  className="standard-detail-hdr-btn-save"
                >
                  {saving ? '저장 중…' : '저장'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  title="수정"
                  disabled={!canEdit}
                  onClick={beginEdit}
                  className="standard-detail-hdr-btn"
                >
                  수정
                </button>
                <button
                  type="button"
                  title="닫기"
                  onClick={onClose}
                  className="standard-detail-hdr-btn"
                >
                  닫기
                </button>
              </>
            )}
          </div>
      </div>
    </MapFloatingPanel>
  )
}
