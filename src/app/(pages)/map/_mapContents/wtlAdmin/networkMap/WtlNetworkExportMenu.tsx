'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COORDINATE_SYSTEM_OPTIONS } from '@/app/(pages)/map/_mapComponents/landInfo/shared'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog'

/** 관망조회 하단 도구 버튼 스타일 */
export type WtlNetworkToolBtnVariant = 'legacy' | 'iconLabel' | 'iconLabelColor'

export type WtlNetworkExportScope = 'all' | 'filtered'

/** SHP 모달 — 수치지형도·배경영상 동봉 */
export type WtlNetworkExportExtras = {
  includeDigitalMap: boolean
  includeBackgroundImage: boolean
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
  /** SHP 전용 — 수치지형도·배경영상 체크 */
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
  const [includeDigitalMap, setIncludeDigitalMap] = useState(false)
  const [includeBackgroundImage, setIncludeBackgroundImage] = useState(false)

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
    setIncludeDigitalMap(false)
    setIncludeBackgroundImage(false)
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
  const allLayersSelected =
    selectableLayers.length > 0 &&
    selectableLayers.every((l) => checked.has(l.key))
  const someLayersSelected = selectableLayers.some((l) => checked.has(l.key))
  const selectAllDisabled = selectableLayers.length === 0

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

  const toggleAllLayers = (on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev)
      for (const it of selectableLayers) {
        if (on) next.add(it.key)
        else next.delete(it.key)
      }
      return next
    })
  }

  const handleConfirm = () => {
    const keys = layers
      .filter((l) => checked.has(l.key) && isLayerAvailable(l.key))
      .map((l) => l.key)
    if (keys.length === 0) {
      window.alert('다운로드할 레이어를 선택하세요.')
      return
    }
    setOpen(false)
    onConfirm(
      scope,
      keys,
      showCrsSelect ? targetSrs : undefined,
      showExtraAssets
        ? { includeDigitalMap, includeBackgroundImage }
        : undefined
    )
  }

  return (
    <>
      <div className={cn('relative min-w-0 flex-1', className)}>
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
        <DialogContent className="flex max-h-[min(80vh,560px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-4 py-3 text-left">
            <DialogTitle className="text-sm">{title ?? label}</DialogTitle>
            <DialogDescription className="text-[11px]">
              레이어를 선택한 뒤 다운로드 범위를 지정하세요.
            </DialogDescription>
          </DialogHeader>

          <div className="shrink-0 space-y-2 border-b border-border px-4 py-3">
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-foreground">
              <input
                type="radio"
                name={`${label}-export-scope`}
                className="h-3.5 w-3.5 cursor-pointer accent-primary"
                checked={scope === 'all'}
                onChange={() => setScope('all')}
              />
              전체 다운로드
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-foreground">
              <input
                type="radio"
                name={`${label}-export-scope`}
                className="h-3.5 w-3.5 cursor-pointer accent-primary"
                checked={scope === 'filtered'}
                onChange={() => setScope('filtered')}
              />
              검색 조건 다운로드
            </label>
            {showCrsSelect ? (
              <label className="flex items-center gap-2 pt-1 text-[12px] text-foreground">
                <span className="shrink-0 text-muted-foreground">좌표계</span>
                <select
                  className="h-8 min-w-0 flex-1 cursor-pointer rounded border border-border bg-background px-2 text-[12px] text-foreground"
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
            {showExtraAssets ? (
              <div className="space-y-1.5 border-t border-border pt-2">
                <label className="flex cursor-pointer items-center gap-2 text-[12px] text-foreground">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 cursor-pointer accent-primary"
                    checked={includeDigitalMap}
                    onChange={(e) => setIncludeDigitalMap(e.target.checked)}
                  />
                  수치지형도 포함
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-[12px] text-foreground">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 cursor-pointer accent-primary"
                    checked={includeBackgroundImage}
                    onChange={(e) => setIncludeBackgroundImage(e.target.checked)}
                  />
                  배경영상 포함
                </label>
                <p className="text-[11px] text-muted-foreground">
                  구역설정 또는 검색 조건(화면 범위)과 겹치는 자료만 ZIP에 넣습니다.
                </p>
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
            <label
              className={cn(
                'mb-2 flex items-center gap-2 border-b border-border pb-2 text-[12px]',
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
                checked={allLayersSelected}
                disabled={selectAllDisabled}
                ref={(el) => {
                  if (el) el.indeterminate = someLayersSelected && !allLayersSelected
                }}
                onChange={() => toggleAllLayers(!allLayersSelected)}
              />
              <span className="font-semibold">전체 선택</span>
            </label>
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
                    </span>
                  </div>
                  <ul className="space-y-0.5 pl-5">
                    {items.map((it) => {
                      const available = isLayerAvailable(it.key)
                      return (
                        <li key={it.key}>
                          <label
                            className={cn(
                              'flex items-center gap-2 rounded px-1 py-0.5 text-[12px]',
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
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="inline-flex h-8 cursor-pointer items-center rounded border border-border px-3 text-[12px] font-medium text-foreground hover:bg-muted"
                title="취소"
                onClick={() => setOpen(false)}
              >
                취소
              </button>
              <button
                type="button"
                className="inline-flex h-8 cursor-pointer items-center rounded border border-primary bg-primary px-3 text-[12px] font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                title="다운로드"
                disabled={checkedCount === 0}
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
