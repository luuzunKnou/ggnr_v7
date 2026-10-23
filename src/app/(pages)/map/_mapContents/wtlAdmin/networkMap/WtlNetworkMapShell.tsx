'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, X } from 'lucide-react'
import { call } from '@/lib/api'
import { cn } from '@/lib/utils'
import { MapSideListPanel } from '../../../_mapComponents/MapSideListPanel'
import { useWtlNetworkMapLayer } from './useWtlNetworkMapLayer'
import { WtlNetworkMapStatus } from './WtlNetworkMapStatus'
import { sectionPipeOf, WtlNetworkMapSectionModal } from './WtlNetworkMapSectionModal'
import { getWtlNetLayerDef } from './wtlNetworkLayerCatalog'
import {
  getWtlNetMapSource,
  WTL_NET_MAP_SOURCE_DEFAULT,
  WTL_NET_MAP_SOURCES,
  type WtlNetMapSourceId,
} from './wtlNetworkMapSources'
import type { WtlNetworkFilterMeta, WtlNetworkRow } from './wtlNetworkTypes'

const LIST_DEFAULT = 440
const LIST_MIN = 360
const LIST_MAX = 720
const RESULT_DEFAULT = 420
const RESULT_MIN = 320
const RESULT_MAX = 680
const BOX_PREVIEW_ROWS = 5

/** 상단 밑줄 탭 */
const DISPLAY_GROUPS: { title: string; items: string[] }[] = [
  {
    title: '관로',
    items: ['상수관로(기타)', '배수관로', '송수관로', '급수관로', '변류시설', '상수맨홀'],
  },
  {
    title: '상수시설',
    items: ['취수장', '정수장', '배수지', '가압장', '저수조', '소방시설', '유량계', '수압계'],
  },
  {
    title: '급수구역',
    items: ['급수구역', '급수분구', '급수블록'],
  },
  {
    title: '계량기',
    items: ['급수전계량기'],
  },
  {
    title: '보호구역',
    items: ['상수원 보호구역', '공장설립 제한지역'],
  },
  {
    title: '기타',
    items: ['상수관로 심도', '누수지점_및_복구내역', '상수 업데이트 내역'],
  },
]

const EXTRA_ON = new Set<string>(['배수관로', '변류시설'])

const SEARCH_TOOLS = ['구역설정', '다운로드', '단면도', 'Excel'] as const

const GROUP_BTN =
  'h-7 text-[11px] rounded border min-w-0 inline-flex items-center justify-center gap-0.5 px-1 leading-none whitespace-nowrap'
const GROUP_BTN_ON =
  'border-primary/45 bg-primary/[0.08] text-foreground ring-1 ring-inset ring-primary/15 hover:bg-primary/[0.11]'
const GROUP_BTN_OFF = 'border-border bg-muted/50 text-foreground/90 hover:bg-muted'

function legendKind(name: string): 'line' | 'area' | 'point' {
  const def = getWtlNetLayerDef(name)
  if (def?.geomKind) return def.geomKind
  if (name.includes('관로') || name.includes('심도')) return 'line'
  if (name.includes('구역') || name.includes('분구') || name.includes('블록') || name.includes('제한')) return 'area'
  return 'point'
}

function LayerMark({ name, on }: { name: string; on: boolean }) {
  const kind = legendKind(name)
  const color = on ? '#2563eb' : '#94a3b8'
  if (kind === 'line') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0">
        <line x1="1" y1="7" x2="13" y2="7" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'area') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0">
        <rect x="2" y="3" width="10" height="8" fill={on ? 'rgba(37,99,235,0.35)' : 'rgba(148,163,184,0.35)'} stroke={color} />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0">
      <circle cx="7" cy="7" r="3.2" fill={color} />
    </svg>
  )
}

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
    <div className="flex min-w-0 flex-1 flex-wrap gap-1">
      {names.map((name) => {
        const on = selected.has(name)
        return (
          <button
            key={name}
            type="button"
            className={cn(
              'h-7 rounded border px-2 text-[11px] leading-none',
              on
                ? 'border-primary/45 bg-primary/[0.08] ring-1 ring-inset ring-primary/15'
                : 'border-border bg-muted/50 hover:bg-muted'
            )}
            onClick={() => onToggle(name)}
          >
            {name}
          </button>
        )
      })}
    </div>
  )
}

function parseRangeDraft(draft: string, min: number, max: number) {
  const nums = draft
    .split('~')
    .map((part) => Number(part.replace(/[^\d.]/g, '')))
    .filter((value) => Number.isFinite(value))
  if (nums.length === 0) return null
  const start = nums[0] ?? min
  const end = nums.length > 1 ? (nums[1] ?? start) : start
  const from = Math.min(max, Math.max(min, Math.round(Math.min(start, end))))
  const to = Math.min(max, Math.max(min, Math.round(Math.max(start, end))))
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
  const [draft, setDraft] = useState('')
  const cancelEdit = useRef(false)
  const span = Math.max(max - min, 1)
  const left = ((from - min) / span) * 100
  const width = ((to - from) / span) * 100
  const text = unit ? `${from}${unit} ~ ${to}${unit}` : `${from} ~ ${to}`

  function commitDraft() {
    if (cancelEdit.current) {
      cancelEdit.current = false
      setEditing(false)
      return
    }
    const parsed = parseRangeDraft(draft, min, max)
    if (parsed) onChange(parsed.from, parsed.to)
    setEditing(false)
  }

  return (
    <div className="flex items-center gap-1">
      <span className="w-16 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <div className="relative h-7 min-w-0 flex-1">
        <div className="absolute inset-0 overflow-hidden rounded border border-border bg-muted/40">
          <div className="absolute inset-y-0 bg-primary/20" style={{ left: `${left}%`, width: `${width}%` }} />
          {editing ? (
            <input
              autoFocus
              value={draft}
              aria-label={`${label} 범위`}
              className="absolute inset-0 z-10 bg-background px-2 text-center text-[11px] text-foreground outline-none"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                  cancelEdit.current = true
                  e.currentTarget.blur()
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="absolute left-1/2 top-0 z-10 h-full -translate-x-1/2 cursor-text px-1 text-[11px] text-foreground"
              onClick={() => {
                setDraft(`${from} ~ ${to}`)
                setEditing(true)
              }}
            >
              {text}
            </button>
          )}
        </div>
        {!editing && (
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

function listColumns(geomKind: string): { key: keyof WtlNetworkRow; label: string }[] {
  const cols: { key: keyof WtlNetworkRow; label: string }[] = [
    { key: 'name', label: '번호' },
    { key: 'diameter', label: '구경' },
    { key: 'material', label: '재질' },
  ]
  if (geomKind === 'line') cols.push({ key: 'length', label: '연장' })
  cols.push({ key: 'year', label: '연도' })
  return cols
}

function cellText(item: WtlNetworkRow, key: keyof WtlNetworkRow) {
  const value = item[key]
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
  const [listWidth, setListWidth] = useState(LIST_DEFAULT)
  const [resultWidth, setResultWidth] = useState(RESULT_DEFAULT)
  const [extraOn, setExtraOn] = useState<Set<string>>(() => new Set(EXTRA_ON))
  const [mapSources, setMapSources] = useState<Set<WtlNetMapSourceId>>(
    () => new Set(WTL_NET_MAP_SOURCE_DEFAULT)
  )
  const [group, setGroup] = useState(DISPLAY_GROUPS[0]?.title ?? '관로')
  const [keyword, setKeyword] = useState('')
  const [meta, setMeta] = useState<WtlNetworkFilterMeta>(DEFAULT_META)
  const [diameterFrom, setDiameterFrom] = useState(DEFAULT_META.diameterMin)
  const [diameterTo, setDiameterTo] = useState(DEFAULT_META.diameterMax)
  const [materials, setMaterials] = useState<Set<string>>(() => new Set())
  const [yearFrom, setYearFrom] = useState(DEFAULT_META.yearMin)
  const [yearTo, setYearTo] = useState(DEFAULT_META.yearMax)
  const [selected, setSelected] = useState<WtlNetworkRow | null>(null)
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null)
  const [onlyInView, setOnlyInView] = useState(true)
  const [resultOpen, setResultOpen] = useState(true)
  const [sectionOpen, setSectionOpen] = useState(false)
  const [openBoxes, setOpenBoxes] = useState<Set<string>>(() => new Set())
  const [rows, setRows] = useState<WtlNetworkRow[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState('')

  const total = listWidth + (resultOpen ? resultWidth : 0)
  const detailOverlayWidth = total
  const enabledKeys = useMemo(() => [...extraOn], [extraOn])
  const enabledSources = useMemo(() => [...mapSources], [mapSources])

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
          params: { layerKeys: ['배수관로', '송수관로', '급수관로', '상수관로(기타)', '변류시설'] },
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

  const fetchList = useCallback(async () => {
    if (enabledKeys.length === 0 || enabledSources.length === 0) {
      setRows([])
      return
    }
    if (onlyInView && !bbox) return
    setListLoading(true)
    setListError('')
    try {
      const res = await call('', 'POST', {
        service: 'wtlNetworkService',
        action: 'getWtlNetworkList',
        params: {
          layerKeys: enabledKeys,
          mapSources: enabledSources,
          bbox: onlyInView ? bbox : null,
          keyword,
          yearFrom,
          yearTo,
          diameterFrom,
          diameterTo,
          materials: [...materials],
          limit: 1500,
        },
      })
      const data = res?.data ?? res
      setRows(Array.isArray(data?.rows) ? (data.rows as WtlNetworkRow[]) : [])
    } catch (e) {
      setRows([])
      setListError(e instanceof Error ? e.message : '목록 조회 실패')
    } finally {
      setListLoading(false)
    }
  }, [
    enabledKeys,
    enabledSources,
    onlyInView,
    bbox,
    keyword,
    yearFrom,
    yearTo,
    diameterFrom,
    diameterTo,
    materials,
  ])

  useEffect(() => {
    const t = window.setTimeout(() => {
      void fetchList()
    }, 280)
    return () => window.clearTimeout(t)
  }, [fetchList])

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

  useWtlNetworkMapLayer({
    enabledLayerKeys: extraOn,
    mapSources,
    selected,
    onSelect: (row) => setSelected(row),
    onExtentChange: (next) => setBbox(next),
  })

  useEffect(() => {
    if (!selected) return
    if (!extraOn.has(String(selected.layerKey))) {
      setSelected(null)
      return
    }
    const sourceId = String(selected.id).split(':')[0] as WtlNetMapSourceId
    if (getWtlNetMapSource(sourceId) && !mapSources.has(sourceId)) {
      setSelected(null)
    }
  }, [extraOn, mapSources, selected])

  const layerBoxes = useMemo(() => {
    const order = DISPLAY_GROUPS.flatMap((g) => g.items)
    const map = new Map<string, WtlNetworkRow[]>()
    for (const row of rows) {
      const key = String(row.layerKey)
      if (!extraOn.has(key)) continue
      const list = map.get(key) ?? []
      list.push(row)
      map.set(key, list)
    }
    return order
      .filter((key) => map.has(key))
      .map((key) => ({
        key,
        label: key,
        geomKind: getWtlNetLayerDef(key)?.geomKind ?? 'point',
        items: map.get(key) ?? [],
      }))
  }, [rows, extraOn])

  const toggleMaterial = (name: string) => {
    setMaterials((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

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

  const currentGroup = DISPLAY_GROUPS.find((item) => item.title === group) ?? DISPLAY_GROUPS[0]

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
              <button type="button" className="standard-panel-close" onClick={onClose} aria-label="닫기">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="max-h-[58%] min-h-0 shrink overflow-auto">
                <div className="standard-filter-section border-b-0 !pb-[13px]">
                  <div className="grid grid-cols-3 gap-1">
                    {WTL_NET_MAP_SOURCES.map((src) => {
                      const on = mapSources.has(src.id)
                      return (
                        <button
                          key={src.id}
                          type="button"
                          className={cn(
                            'h-7 min-w-0 truncate rounded border px-1 text-[11px] font-medium leading-none',
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
                      {currentGroup.items.map((name) => {
                        const on = extraOn.has(name)
                        return (
                          <button
                            key={name}
                            type="button"
                            className={cn(GROUP_BTN, on ? GROUP_BTN_ON : GROUP_BTN_OFF)}
                            onClick={() => toggleLayer(name)}
                          >
                            <LayerMark name={name} on={on} />
                            <span className="min-w-0 truncate [word-break:keep-all]">{name}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <div className="space-y-2 !mt-[13px] border-t border-border pt-[13px]">
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
                      <span className="w-16 shrink-0 pt-0.5 text-[11px] text-muted-foreground">재질</span>
                      <MaterialChoices
                        names={meta.materials}
                        selected={materials}
                        onToggle={toggleMaterial}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="w-16 shrink-0 text-[11px] text-muted-foreground">통합검색</span>
                      <input
                        type="search"
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        placeholder="통합검색"
                        aria-label="통합검색"
                        className="min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 py-1 text-xs text-foreground outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <WtlNetworkMapStatus />
            </div>
            <div className="flex shrink-0 gap-1 border-t border-border bg-background p-2">
              {SEARCH_TOOLS.map((label) => (
                <button
                  key={label}
                  type="button"
                  className="flex h-7 min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-[5px] bg-[#d7ebf1] px-0.5 text-[11px] font-semibold leading-none text-[#14607a] hover:bg-[#c5e3eb]"
                  onClick={() => {
                    if (label === '단면도') setSectionOpen(true)
                  }}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                className="flex h-7 min-w-0 flex-1 items-center justify-center gap-0.5 whitespace-nowrap rounded-[5px] bg-[#d7ebf1] px-0.5 text-[11px] font-semibold leading-none text-[#14607a] hover:bg-[#c5e3eb]"
                title={resultOpen ? '시설목록 접기' : '시설목록 펼치기'}
                onClick={() => setResultOpen((open) => !open)}
              >
                <ChevronDown className={cn('h-3.5 w-3.5 shrink-0', !resultOpen && 'rotate-180')} />
                시설목록
              </button>
            </div>
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
                  <ChevronDown className="standard-detail-section-chevron" />
                  <span className="standard-detail-section-toggle-label">시설목록</span>
                </button>
                <span className="text-[11px] text-muted-foreground">
                  {listLoading ? '조회 중…' : `${rows.length.toLocaleString()}건`}
                </span>
              </div>
              <label className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2 text-[11px] text-foreground">
                <input
                  type="checkbox"
                  checked={onlyInView}
                  onChange={(e) => setOnlyInView(e.target.checked)}
                />
                화면에 보이는 시설만 표시합니다
              </label>
              {listError && (
                <p className="border-b border-border px-3 py-2 text-[11px] text-destructive">{listError}</p>
              )}
              <div className="standard-list-body">
                <div className="standard-list-scroll space-y-2 p-2">
                  {layerBoxes.length === 0 ? (
                    <p className="px-1 py-2 text-[11px] text-muted-foreground">
                      {listLoading ? '조회 중…' : '조회된 항목이 없습니다.'}
                    </p>
                  ) : (
                    layerBoxes.map((box) => {
                      const columns = listColumns(box.geomKind)
                      const opened = openBoxes.has(box.key)
                      const shown = opened ? box.items : box.items.slice(0, BOX_PREVIEW_ROWS)
                      const more = Math.max(0, box.items.length - BOX_PREVIEW_ROWS)
                      return (
                        <div key={box.key} className="overflow-hidden rounded border border-border bg-background">
                          <div className="flex min-w-0 items-center gap-1.5 border-b border-border bg-muted/50 px-2 py-1.5">
                            <LayerMark name={box.label} on />
                            <span className="min-w-0 truncate text-[11px] font-medium text-foreground">
                              {box.label}
                            </span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              · {box.items.length}건
                            </span>
                          </div>
                          <table className="w-full table-fixed border-collapse text-left text-[10px] text-foreground/90">
                            <thead>
                              <tr className="border-b border-border bg-muted">
                                {columns.map((col) => (
                                  <th
                                    key={col.key}
                                    className="px-1.5 py-1 text-left font-medium text-foreground/90"
                                  >
                                    {col.label}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {shown.map((item) => (
                                <tr
                                  key={item.id}
                                  className={cn(
                                    'cursor-pointer border-b border-border hover:bg-primary/5',
                                    selected?.id === item.id &&
                                      'bg-primary/[0.12] ring-1 ring-inset ring-primary/25'
                                  )}
                                  onClick={() => void pickRow(item)}
                                >
                                  {columns.map((col) => (
                                    <td key={col.key} className="truncate px-1.5 py-1">
                                      {cellText(item, col.key)}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {more > 0 && (
                            <div className="flex justify-center border-t border-border bg-muted/50 px-2 py-1.5">
                              <button
                                type="button"
                                className="text-[11px] font-medium text-primary hover:underline"
                                onClick={() =>
                                  setOpenBoxes((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(box.key)) next.delete(box.key)
                                    else next.add(box.key)
                                    return next
                                  })
                                }
                              >
                                {opened ? '접기' : `더보기 (${more}건)`}
                              </button>
                            </div>
                          )}
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
        overlayWidthPx={detailOverlayWidth}
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
  const titleId = useId()
  const open = item != null

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !item || overlayWidthPx <= 0 || typeof document === 'undefined') return null

  const rows = item.attrs?.length
    ? item.attrs
    : [
        { label: '구분', value: String(item.layerKey) },
        { label: '관리번호', value: item.name },
        { label: '구경', value: item.diameter },
        { label: '재질', value: item.material },
        { label: '연장', value: item.length },
        { label: '설치연도', value: item.year },
      ]

  return createPortal(
    <div
      className="pointer-events-auto fixed z-[80] box-border flex min-h-0 items-center justify-center overflow-y-auto bg-black/50 p-10"
      style={{
        left: overlayLeftPx,
        top: 0,
        width: overlayWidthPx,
        height: '100dvh',
        maxHeight: '100dvh',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        className="relative w-full max-h-[calc(100dvh-5rem)] overflow-x-hidden overflow-y-auto overscroll-contain rounded-[5px] border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-border bg-background px-4 py-3 pr-10">
          <h2 id={titleId} className="min-w-0 break-words text-base font-semibold leading-snug text-foreground">
            {item.layerKey} {item.name}
          </h2>
          <button
            type="button"
            className="absolute right-3 top-3 rounded-sm p-1 text-muted-foreground opacity-90 ring-offset-background transition-opacity hover:bg-muted/50 hover:text-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="닫기"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-3">
          <div className="standard-detail-attr-table">
            {rows.map((row) => (
              <div key={row.label} className="contents">
                <div className="standard-detail-attr-label standard-detail-attr-cell-border">{row.label}</div>
                <div className="standard-detail-attr-value standard-detail-attr-cell-border text-foreground">
                  {row.label === '상태' ? (
                    <span className={statusClass(row.value)}>{row.value}</span>
                  ) : (
                    row.value
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
