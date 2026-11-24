'use client'

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { call } from '@/lib/api'
import { MAP_UI_Z } from '@/lib/mapUiZIndex'
import { COORDINATE_SYSTEM_OPTIONS } from '@/app/(pages)/map/_mapComponents/landInfo/shared'
import {
  buildCustomAerialBackgroundOptions,
  type OrthophotoTileOutputsPayload,
} from '@/app/(pages)/map/_mapComponents/mapControlPanel/backgroundMapSelector'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog'

/** 관망조회 하단 도구 버튼 스타일 · 전체 UI 레이아웃 */
export type WtlNetworkToolBtnVariant =
  | 'legacy'
  | 'iconLabel'
  | 'iconLabelColor'
  | 'fullLayout'

export type WtlNetworkExportScope = 'all' | 'filtered'

/** 수치지형도 동봉 형식 — 원본 DXF / 범위 PNG */
export type WtlNetworkDigitalMapFormat = 'original' | 'png'

/** SHP 모달 — 수치지형도·배경영상(자체항공) 동봉 */
export type WtlNetworkExportExtras = {
  includeDigitalMap: boolean
  includeBackgroundImage: boolean
  digitalMapFolders: string[]
  backgroundAerialIds: string[]
  /** 수치지형도 형식 (미선택 시 original) */
  digitalMapFormat: WtlNetworkDigitalMapFormat
}

/** 관망조회 SHP 다운로드 기본 좌표계 — 위경도 */
export const WTL_NETWORK_SHP_DEFAULT_SRS = 'EPSG:4326'

/** SHP select — EPSG 번호 오름차순 */
const WTL_NETWORK_SHP_CRS_OPTIONS = [...COORDINATE_SYSTEM_OPTIONS].sort(
  (a, b) =>
    (Number.parseInt(a.code.replace(/^EPSG:/i, ''), 10) || 0) -
    (Number.parseInt(b.code.replace(/^EPSG:/i, ''), 10) || 0)
)

export type WtlNetworkExportLayerOption = {
  key: string
  label: string
  group: string
}

type ExtraListItem = { id: string; label: string }

type Props = {
  label: string
  title?: string
  busy?: boolean
  busyLabel?: string
  disabled?: boolean
  className?: string
  active?: boolean
  variant?: WtlNetworkToolBtnVariant
  icon?: ReactNode
  /** 전체 레이어 목록 */
  layers: WtlNetworkExportLayerOption[]
  /** 현재 지도에서 켜진 레이어 — 모달 열 때 미리 체크 */
  selectedKeys?: Iterable<string> | ReadonlySet<string> | readonly string[]
  /**
   * DB에 존재하는 레이어 키. null이면 아직 조회 전(전부 선택 가능),
   * Set이면 포함되지 않은 키는 체크 비활성.
   */
  availableKeys?: ReadonlySet<string> | null
  /** SHP 전용 — 좌표계 select 표시 */
  showCrsSelect?: boolean
  /** SHP 전용 — 수치지형도·배경영상 체크 목록 */
  showExtraAssets?: boolean
  onConfirm: (
    scope: WtlNetworkExportScope,
    layerKeys: string[],
    targetSrs?: string,
    extras?: WtlNetworkExportExtras
  ) => void
}

/** 하단 도구줄 — 다운로드/Excel 레이어 선택 모달 */
export function WtlNetworkExportMenu({
  label,
  title,
  busy = false,
  busyLabel,
  disabled = false,
  className,
  active = false,
  variant = 'legacy',
  icon,
  layers,
  selectedKeys = [],
  availableKeys = null,
  showCrsSelect = false,
  showExtraAssets = false,
  onConfirm,
}: Props) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<WtlNetworkExportScope>('all')
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  const [targetSrs, setTargetSrs] = useState(WTL_NETWORK_SHP_DEFAULT_SRS)
  const [digitalMapChecked, setDigitalMapChecked] = useState<Set<string>>(
    () => new Set()
  )
  const [digitalMapFormat, setDigitalMapFormat] =
    useState<WtlNetworkDigitalMapFormat>('original')
  const [aerialChecked, setAerialChecked] = useState<Set<string>>(
    () => new Set()
  )
  const [digitalMapItems, setDigitalMapItems] = useState<ExtraListItem[]>([])
  const [aerialItems, setAerialItems] = useState<ExtraListItem[]>([])
  const [digitalMapLoading, setDigitalMapLoading] = useState(false)
  const [aerialLoading, setAerialLoading] = useState(false)
  const [digitalMapError, setDigitalMapError] = useState<string | null>(null)
  const [aerialError, setAerialError] = useState<string | null>(null)
  const layerListScrollRef = useRef<HTMLDivElement | null>(null)

  const selectedKeySet = useMemo(() => {
    const list =
      selectedKeys instanceof Set
        ? Array.from(selectedKeys)
        : Array.isArray(selectedKeys)
          ? selectedKeys
          : selectedKeys && typeof (selectedKeys as Iterable<string>)[Symbol.iterator] === 'function'
            ? Array.from(selectedKeys as Iterable<string>)
            : []
    return new Set(
      list.map((k) => String(k).trim().toLowerCase()).filter(Boolean)
    )
  }, [selectedKeys])

  const isLayerAvailable = (key: string) => {
    if (availableKeys == null) return true
    return availableKeys.has(key)
  }

  useEffect(() => {
    if (!open) return
    setScope('all')
    setTargetSrs(WTL_NETWORK_SHP_DEFAULT_SRS)
    setDigitalMapChecked(new Set())
    setDigitalMapFormat('original')
    setAerialChecked(new Set())
    const next = new Set<string>()
    for (const layer of layers) {
      if (!isLayerAvailable(layer.key)) continue
      if (selectedKeySet.has(layer.key.toLowerCase())) next.add(layer.key)
    }
    setChecked(next)
    // availableKeys·선택 키 기준으로만 초기화
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open 시 스냅샷
  }, [open, layers, selectedKeySet, availableKeys])

  useEffect(() => {
    if (busy) setOpen(false)
  }, [busy])

  /** 모달 열림 + SHP 부가자료 — 수치지형도·자체항공 목록 (우측 패널과 동일 API) */
  useEffect(() => {
    if (!open || !showExtraAssets) return
    let cancelled = false

    setDigitalMapLoading(true)
    setDigitalMapError(null)
    void call('', 'POST', {
      service: 'digitalMapService',
      action: 'listFolders',
      params: {},
    })
      .then((res) => {
        if (cancelled) return
        if (!res?.success) {
          setDigitalMapError(
            (res as { message?: string })?.message ??
              '수치지형도 목록을 불러오지 못했습니다.'
          )
          setDigitalMapItems([])
          return
        }
        const data = (res.data ?? res) as {
          folders?: Array<{ name?: string; dxfCount?: number }>
        }
        const folders = Array.isArray(data.folders) ? data.folders : []
        setDigitalMapItems(
          folders
            .map((f) => {
              const name = String(f.name ?? '').trim()
              if (!name) return null
              return { id: name, label: name }
            })
            .filter((x): x is ExtraListItem => x != null)
        )
      })
      .catch((e) => {
        if (cancelled) return
        setDigitalMapError(e instanceof Error ? e.message : String(e))
        setDigitalMapItems([])
      })
      .finally(() => {
        if (!cancelled) setDigitalMapLoading(false)
      })

    setAerialLoading(true)
    setAerialError(null)
    void call('', 'POST', {
      service: 'orthophotoService',
      action: 'listOrthophotoTileOutputs',
      params: {},
    })
      .then((res) => {
        if (cancelled) return
        const d = (res?.data ?? res) as OrthophotoTileOutputsPayload
        const opts = buildCustomAerialBackgroundOptions(d)
        setAerialItems(opts.map((o) => ({ id: o.id, label: o.label })))
      })
      .catch((e) => {
        if (cancelled) return
        setAerialError(e instanceof Error ? e.message : String(e))
        setAerialItems([])
      })
      .finally(() => {
        if (!cancelled) setAerialLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, showExtraAssets])

  useEffect(() => {
    if (scope === 'all') {
      setDigitalMapChecked(new Set())
      setAerialChecked(new Set())
    }
    layerListScrollRef.current?.scrollTo({ top: 0 })
  }, [scope])

  const groups = useMemo(() => {
    const order: string[] = []
    const map = new Map<string, WtlNetworkExportLayerOption[]>()
    for (const layer of layers) {
      if (!map.has(layer.group)) {
        order.push(layer.group)
        map.set(layer.group, [])
      }
      map.get(layer.group)!.push(layer)
    }
    return order.map((group) => ({ group, items: map.get(group)! }))
  }, [layers])

  const checkedCount = checked.size
  void busyLabel

  const selectableLayers = useMemo(
    () =>
      layers.filter((l) =>
        availableKeys == null ? true : availableKeys.has(l.key)
      ),
    [layers, availableKeys]
  )
  const showExtrasInList = showExtraAssets && scope === 'filtered'
  const digitalMapSelectable =
    showExtrasInList && !digitalMapLoading ? digitalMapItems : []
  const aerialSelectable =
    showExtrasInList && !aerialLoading ? aerialItems : []
  const extrasCheckedCount = showExtrasInList
    ? digitalMapChecked.size + aerialChecked.size
    : 0
  const canConfirm = checkedCount > 0 || extrasCheckedCount > 0

  const allLayersSelected =
    selectableLayers.length > 0 &&
    selectableLayers.every((l) => checked.has(l.key))
  const someLayersSelected = selectableLayers.some((l) => checked.has(l.key))
  const allDigitalMapSelected =
    digitalMapSelectable.length === 0 ||
    digitalMapSelectable.every((it) => digitalMapChecked.has(it.id))
  const allAerialSelected =
    aerialSelectable.length === 0 ||
    aerialSelectable.every((it) => aerialChecked.has(it.id))
  const someExtrasSelected =
    digitalMapSelectable.some((it) => digitalMapChecked.has(it.id)) ||
    aerialSelectable.some((it) => aerialChecked.has(it.id))
  const allSelected =
    (selectableLayers.length === 0 || allLayersSelected) &&
    allDigitalMapSelected &&
    allAerialSelected
  const someSelected = someLayersSelected || someExtrasSelected
  const selectAllDisabled =
    selectableLayers.length === 0 &&
    digitalMapSelectable.length === 0 &&
    aerialSelectable.length === 0

  const toggleKey = (key: string) => {
    if (!isLayerAvailable(key)) return
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleGroup = (items: WtlNetworkExportLayerOption[], on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev)
      for (const it of items) {
        if (!isLayerAvailable(it.key)) continue
        if (on) next.add(it.key)
        else next.delete(it.key)
      }
      return next
    })
  }

  const toggleExtraSet = (
    setter: Dispatch<SetStateAction<Set<string>>>,
    id: string
  ) => {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleExtraGroup = (
    setter: Dispatch<SetStateAction<Set<string>>>,
    items: ExtraListItem[],
    on: boolean
  ) => {
    setter((prev) => {
      const next = new Set(prev)
      for (const it of items) {
        if (on) next.add(it.id)
        else next.delete(it.id)
      }
      return next
    })
  }

  const toggleAllLayers = (on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev)
      for (const it of selectableLayers) {
        if (on) next.add(it.key)
        else next.delete(it.key)
      }
      return next
    })
    if (!showExtrasInList) return
    if (digitalMapSelectable.length > 0) {
      toggleExtraGroup(setDigitalMapChecked, digitalMapSelectable, on)
    }
    if (aerialSelectable.length > 0) {
      toggleExtraGroup(setAerialChecked, aerialSelectable, on)
    }
  }

  const handleConfirm = () => {
    const keys = layers
      .filter((l) => checked.has(l.key) && isLayerAvailable(l.key))
      .map((l) => l.key)
    const dmFolders =
      showExtraAssets && scope === 'filtered' ? [...digitalMapChecked] : []
    const aerialIds =
      showExtraAssets && scope === 'filtered' ? [...aerialChecked] : []
    if (keys.length === 0 && dmFolders.length === 0 && aerialIds.length === 0) {
      window.alert('다운로드할 레이어 또는 수치지형도·배경영상을 선택하세요.')
      return
    }
    setOpen(false)
    onConfirm(
      scope,
      keys,
      showCrsSelect ? targetSrs : undefined,
      showExtraAssets
        ? {
            includeDigitalMap: dmFolders.length > 0,
            includeBackgroundImage: aerialIds.length > 0,
            digitalMapFolders: dmFolders,
            backgroundAerialIds: aerialIds,
            digitalMapFormat,
          }
        : undefined
    )
  }

  const renderExtraCategory = (opts: {
    title: string
    loading: boolean
    error: string | null
    items: ExtraListItem[]
    checkedSet: Set<string>
    onToggleItem: (id: string) => void
    onToggleGroup: (on: boolean) => void
    /** 수치지형도 — 원본/PNG */
    formatRadios?: boolean
  }) => {
    const empty = !opts.loading && opts.items.length === 0
    const allOn =
      opts.items.length > 0 && opts.items.every((it) => opts.checkedSet.has(it.id))
    const someOn = opts.items.some((it) => opts.checkedSet.has(it.id))
    return (
      <div className="mb-3 last:mb-1">
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
            checked={!empty && allOn}
            disabled={empty || opts.loading}
            ref={(el) => {
              if (el) el.indeterminate = !empty && someOn && !allOn
            }}
            title={empty ? `${opts.title} (데이터 없음)` : `${opts.title} 전체`}
            onChange={() => opts.onToggleGroup(!allOn)}
          />
          <span className="text-[11px] font-semibold text-muted-foreground">
            {opts.title}
            {empty ? (
              <span className="ml-1 font-normal text-muted-foreground/80">
                (데이터 없음)
              </span>
            ) : null}
          </span>
          {opts.formatRadios ? (
            <span
              className="inline-flex items-center gap-2 pl-1 text-[11px] text-foreground"
              title="수치지형도 내려받기 형식"
            >
              <label className="inline-flex cursor-pointer items-center gap-1">
                <input
                  type="radio"
                  name={`${label}-digital-map-format`}
                  className="h-3 w-3 cursor-pointer accent-primary"
                  checked={digitalMapFormat === 'original'}
                  onChange={() => setDigitalMapFormat('original')}
                  title="원본"
                />
                원본
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1">
                <input
                  type="radio"
                  name={`${label}-digital-map-format`}
                  className="h-3 w-3 cursor-pointer accent-primary"
                  checked={digitalMapFormat === 'png'}
                  onChange={() => setDigitalMapFormat('png')}
                  title="PNG"
                />
                PNG
              </label>
            </span>
          ) : null}
          {opts.loading ? (
            <Loader2
              className="h-3 w-3 animate-spin text-muted-foreground"
              aria-hidden
            />
          ) : null}
        </div>
        {opts.error ? (
          <p className="mb-1 pl-5 text-[11px] text-destructive">{opts.error}</p>
        ) : null}
        {empty ? null : (
          <ul className="space-y-0.5 pl-5">
            {opts.items.map((it) => (
              <li key={it.id}>
                <label
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-foreground hover:bg-muted/60"
                  title={it.label}
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
                    checked={opts.checkedSet.has(it.id)}
                    onChange={() => opts.onToggleItem(it.id)}
                  />
                  <span className="min-w-0 truncate">{it.label}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <>
      <div
        className={cn(
          'relative min-w-0',
          variant === 'fullLayout' ? 'w-full shrink-0' : 'flex-1',
          className
        )}
      >
        <button
          type="button"
          title={busy ? `${title ?? label} 중…` : title ?? label}
          aria-busy={busy}
          disabled={disabled || busy}
          className={cn(
            'flex h-7 w-full cursor-pointer items-center justify-center gap-0.5 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60',
            variant === 'legacy' &&
              'rounded-[5px] px-0.5 text-[11px] font-semibold leading-none',
            variant === 'legacy' &&
              (active || open
                ? 'bg-[#14607a] text-white hover:bg-[#0f4d62] dark:bg-[#d7ebf1] dark:text-[#14607a] dark:hover:bg-[#c5e3eb]'
                : 'bg-[#d7ebf1] text-[#14607a] hover:bg-[#c5e3eb] dark:bg-[#14607a] dark:text-[#d7ebf1] dark:hover:bg-[#0f4d62]'),
            variant === 'iconLabel' &&
              'standard-detail-action-btn px-1.5 text-[11px] font-medium',
            variant === 'iconLabel' &&
              (active || open) &&
              'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
            variant === 'fullLayout' &&
              'rounded border border-border bg-background px-1.5 text-[11px] font-medium text-foreground hover:bg-muted/50',
            variant === 'fullLayout' &&
              (active || open) &&
              'border-primary bg-primary! text-primary-foreground hover:bg-primary/90!',
            variant === 'iconLabelColor' &&
              'rounded border px-1.5 text-[11px] font-medium transition-colors',
            variant === 'iconLabelColor' &&
              (active || open
                ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                : 'border-primary bg-primary/15 text-primary hover:bg-primary/20')
          )}
          onClick={() => {
            if (busy || disabled) return
            setOpen(true)
          }}
        >
          {icon ? (
            <span className="inline-flex shrink-0" aria-hidden>
              {icon}
            </span>
          ) : null}
          <span className="relative inline-flex items-center justify-center">
            <span className={cn(busy && 'invisible')} aria-hidden={busy}>
              {label}
            </span>
            {busy ? (
              <Loader2
                className="absolute h-3.5 w-3.5 animate-spin"
                strokeWidth={2}
                aria-hidden
              />
            ) : null}
          </span>
        </button>
      </div>

      <Dialog open={open && !busy} onOpenChange={setOpen}>
        <DialogContent
          layerZIndex={MAP_UI_Z.nestedDialog}
          className="flex max-h-[min(80vh,560px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
        >
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-4 py-3 text-left">
            <DialogTitle className="text-sm">{title ?? label}</DialogTitle>
            <DialogDescription className="text-[11px]">
              레이어를 선택한 뒤 다운로드 범위를 지정하세요.
            </DialogDescription>
          </DialogHeader>

          <div className="shrink-0 space-y-2 border-b border-border px-4 py-3">
            {showExtraAssets ? (
              <p className="text-[11px] text-muted-foreground">
                수치지형도·배경영상(자체항공)은 «검색 조건 적용 다운로드»에서만 선택할
                수 있으며, 구역설정 또는 «화면 내 시설만 표시» 범위와 겹치는 자료만
                ZIP에 넣습니다.
              </p>
            ) : null}
            <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
              <input
                type="radio"
                name={`${label}-export-scope`}
                className="h-3.5 w-3.5 cursor-pointer accent-primary"
                checked={scope === 'all'}
                onChange={() => setScope('all')}
              />
              전체 다운로드
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
              <input
                type="radio"
                name={`${label}-export-scope`}
                className="h-3.5 w-3.5 cursor-pointer accent-primary"
                checked={scope === 'filtered'}
                onChange={() => setScope('filtered')}
              />
              검색 조건 적용 다운로드
            </label>
            {showCrsSelect ? (
              <label className="flex items-center gap-2 pt-1 text-xs text-foreground">
                <span className="shrink-0 text-muted-foreground">좌표계</span>
                <select
                  className="h-8 min-w-0 flex-1 cursor-pointer rounded border border-border bg-background px-2 text-xs text-foreground"
                  value={targetSrs}
                  title="좌표계"
                  onChange={(e) => setTargetSrs(e.target.value)}
                >
                  {WTL_NETWORK_SHP_CRS_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.shortLabel}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <div
            ref={layerListScrollRef}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-2"
          >
            <label
              className={cn(
                'mb-2 flex items-center gap-2 border-b border-border pb-2 text-xs',
                selectAllDisabled
                  ? 'cursor-not-allowed text-muted-foreground opacity-40'
                  : 'cursor-pointer text-foreground'
              )}
              title={
                selectAllDisabled ? '선택 가능한 레이어 없음' : '전체 선택'
              }
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
                checked={allSelected}
                disabled={selectAllDisabled}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected && !allSelected
                }}
                onChange={() => toggleAllLayers(!allSelected)}
              />
              <span className="font-semibold">전체 선택</span>
            </label>
            {showExtrasInList ? (
              <>
                {renderExtraCategory({
                  title: '수치지형도',
                  loading: digitalMapLoading,
                  error: digitalMapError,
                  items: digitalMapItems,
                  checkedSet: digitalMapChecked,
                  onToggleItem: (id) =>
                    toggleExtraSet(setDigitalMapChecked, id),
                  onToggleGroup: (on) =>
                    toggleExtraGroup(setDigitalMapChecked, digitalMapItems, on),
                  formatRadios: true,
                })}
                {renderExtraCategory({
                  title: '배경영상',
                  loading: aerialLoading,
                  error: aerialError,
                  items: aerialItems,
                  checkedSet: aerialChecked,
                  onToggleItem: (id) => toggleExtraSet(setAerialChecked, id),
                  onToggleGroup: (on) =>
                    toggleExtraGroup(setAerialChecked, aerialItems, on),
                })}
              </>
            ) : null}
            {groups.map(({ group, items }) => {
              const selectableItems = items.filter((it) => isLayerAvailable(it.key))
              const allOn =
                selectableItems.length > 0 &&
                selectableItems.every((it) => checked.has(it.key))
              const someOn = selectableItems.some((it) => checked.has(it.key))
              const groupDisabled = selectableItems.length === 0
              return (
                <div key={group} className="mb-3 last:mb-1">
                  <div className="mb-1 flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
                      checked={allOn}
                      disabled={groupDisabled}
                      ref={(el) => {
                        if (el) el.indeterminate = someOn && !allOn
                      }}
                      title={
                        groupDisabled
                          ? `${group} (데이터 없음)`
                          : `${group} 전체`
                      }
                      onChange={() => toggleGroup(items, !allOn)}
                    />
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      {group}
                      {groupDisabled ? (
                        <span className="ml-1 font-normal text-muted-foreground/80">
                          (데이터 없음)
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <ul className="space-y-0.5 pl-5">
                    {items.map((it) => {
                      const available = isLayerAvailable(it.key)
                      return (
                        <li key={it.key}>
                          <label
                            className={cn(
                              'flex items-center gap-2 rounded px-1 py-0.5 text-xs',
                              available
                                ? 'cursor-pointer text-foreground hover:bg-muted/60'
                                : 'cursor-not-allowed text-muted-foreground opacity-40'
                            )}
                            title={
                              available ? it.label : `${it.label} (데이터 없음)`
                            }
                          >
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed"
                              checked={available && checked.has(it.key)}
                              disabled={!available}
                              onChange={() => toggleKey(it.key)}
                            />
                            <span className="min-w-0 truncate">{it.label}</span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>

          <DialogFooter className="shrink-0 gap-2 border-t border-border px-4 py-3 sm:justify-between">
            <span className="self-center text-[11px] text-muted-foreground">
              {checkedCount}개 선택
              {showExtrasInList && extrasCheckedCount > 0
                ? ` · 부가 ${extrasCheckedCount}`
                : ''}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="inline-flex h-8 cursor-pointer items-center rounded border border-border px-3 text-xs font-medium text-foreground hover:bg-muted"
                title="취소"
                onClick={() => setOpen(false)}
              >
                취소
              </button>
              <button
                type="button"
                className="inline-flex h-8 cursor-pointer items-center rounded border border-primary bg-primary px-3 text-xs font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                title="다운로드"
                disabled={!canConfirm}
                onClick={handleConfirm}
              >
                다운로드
              </button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
