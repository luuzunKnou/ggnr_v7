'use client'

import { useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { Switch } from '@/app/shadcnComponents/ui/switch'
import { cn } from '@/lib/utils'
import {
  MAP_LAYER_PANEL_MAX_H_CLASS,
  MAP_LAYER_PANEL_SURFACE_CLASS,
} from '../../_mapComponents/mapControlPanel/mapLayerPanelLayout'
import {
  detailWondoLabel,
  filterDetailWondoByArea,
  type DetailWondoArea,
  type DetailWondoItem,
} from './detailWondoConfig'
import type { DetailWondoScanProgress } from './useDetailWondoData'

const SELECT_CLASS =
  'h-7 w-full min-w-0 cursor-pointer rounded border border-slate-200 bg-background px-2 text-xs text-foreground outline-none focus:border-slate-400 dark:border-white/20'

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'))
}

function scanProgressLabel(progress: DetailWondoScanProgress | null): string {
  if (!progress?.scanning) return '불러오는 중…'
  if (progress.phase === 'load') return '저장된 목록 읽는 중…'
  if (progress.phase === 'walk') {
    return progress.found > 0 ? `폴더 찾는 중… ${progress.found.toLocaleString()}장` : '폴더 찾는 중…'
  }
  if (progress.phase === 'read') {
    if (progress.total > 0) {
      return `좌표 읽는 중 ${progress.current.toLocaleString()}/${progress.total.toLocaleString()}`
    }
    return '좌표 읽는 중…'
  }
  if (progress.phase === 'save') return '목록 저장 중…'
  return '불러오는 중…'
}

type Props = {
  items: DetailWondoItem[]
  loading: boolean
  error: string | null
  progress: DetailWondoScanProgress | null
  area: DetailWondoArea
  onAreaChange: (area: DetailWondoArea) => void
  checkedIds: Set<string>
  loadingIds: Set<string>
  errorIds: Set<string>
  onCheckedChange: (id: string, checked: boolean) => void
  /** 현재 목록(읍면·동 필터 결과) 전체 켜기·끄기 */
  onSetAll: (ids: string[], on: boolean) => void
  opacity: number
  onOpacityChange: (opacity: number) => void
  onClose: () => void
}

/** 우측 «세부원도» 버튼 패널 — 읍면·동 선택과 원도 체크 목록 */
export function DetailWondoListPanel({
  items,
  loading,
  error,
  progress,
  area,
  onAreaChange,
  checkedIds,
  loadingIds,
  errorIds,
  onCheckedChange,
  onSetAll,
  opacity,
  onOpacityChange,
  onClose,
}: Props) {
  const eupmyeons = useMemo(() => uniqueSorted(items.map((it) => it.eupmyeon)), [items])
  const dongs = useMemo(
    () =>
      uniqueSorted(
        items.filter((it) => !area.eupmyeon || it.eupmyeon === area.eupmyeon).map((it) => it.dong)
      ),
    [items, area.eupmyeon]
  )
  const filtered = useMemo(() => filterDetailWondoByArea(items, area), [items, area])
  const areaPicked = Boolean(area.eupmyeon || area.dong)
  const listItems = areaPicked ? filtered : []
  const filteredChecked = listItems.filter((it) => checkedIds.has(it.id)).length
  const allChecked = listItems.length > 0 && filteredChecked === listItems.length
  const someChecked = filteredChecked > 0 && !allChecked
  const bulkTitle = allChecked ? '목록 전체 끄기' : '목록 전체 켜기'
  const transparency = Math.round((1 - opacity) * 100)
  const loadingLabel = scanProgressLabel(progress)
  const loadingPct = progress?.scanning ? Math.max(4, progress.pct) : 8
  const showPct = Boolean(progress?.scanning && progress.phase === 'read' && progress.total > 0)

  return (
    <div className={cn('flex w-60 flex-col overflow-hidden', MAP_LAYER_PANEL_SURFACE_CLASS, MAP_LAYER_PANEL_MAX_H_CLASS)}>
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-white/5">
        <span className="text-[13px] font-medium text-slate-800 dark:text-white/90">세부원도</span>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded px-1 text-xs text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-white"
          aria-label="닫기"
          title="닫기"
        >
          닫기
        </button>
      </div>

      <div className="shrink-0 space-y-1.5 border-b border-slate-100 px-3 py-2 dark:border-white/10">
        <div className="grid grid-cols-2 gap-1.5">
          <select
            value={area.eupmyeon}
            onChange={(e) => onAreaChange({ eupmyeon: e.target.value, dong: '' })}
            className={SELECT_CLASS}
            aria-label="읍면 선택"
          >
            <option value="">전체</option>
            {eupmyeons.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={area.dong}
            onChange={(e) => onAreaChange({ eupmyeon: area.eupmyeon, dong: e.target.value })}
            className={SELECT_CLASS}
            aria-label="동 선택"
          >
            <option value="">전체</option>
            {dongs.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[10px] text-slate-500 dark:text-white/60">투명도</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={transparency}
            onChange={(e) => onOpacityChange(1 - Number(e.target.value) / 100)}
            className="h-1 min-w-0 flex-1 cursor-pointer accent-primary"
            aria-label="투명도"
          />
          <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-slate-500 dark:text-white/60">
            {transparency}%
          </span>
        </div>
        {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 dark:border-white/10">
        <p className="text-[10px] text-slate-500 dark:text-white/60">
          {loading
            ? showPct
              ? `${loadingLabel} ${progress?.pct ?? 0}%`
              : loadingLabel
            : areaPicked
              ? `${filteredChecked}/${listItems.length.toLocaleString()} 선택`
              : `${items.length.toLocaleString()}장 · 읍면·동 선택`}
        </p>
        <Switch
          id="detail-wondo-all"
          aria-label={bulkTitle}
          title={bulkTitle}
          checked={allChecked}
          indeterminate={someChecked}
          disabled={listItems.length === 0}
          onCheckedChange={(on) => onSetAll(listItems.map((it) => it.id), on || someChecked)}
        />
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1">
        {listItems.length === 0 ? (
          <div className="px-3 py-3 text-[11px] leading-snug text-slate-500 dark:text-white/60">
            {loading ? (
              <div className="space-y-2">
                <p>{loadingLabel}</p>
                <div className="h-1.5 w-full overflow-hidden rounded bg-slate-200 dark:bg-white/10">
                  <div
                    className={cn(
                      'h-full bg-primary transition-[width] duration-300',
                      progress?.phase === 'walk' || progress?.phase === 'load' ? 'animate-pulse' : ''
                    )}
                    style={{ width: `${loadingPct}%` }}
                  />
                </div>
                {showPct ? (
                  <p className="text-right text-[10px] tabular-nums">{progress?.pct ?? 0}%</p>
                ) : null}
              </div>
            ) : !areaPicked ? (
              '읍면 또는 동을 선택하세요.'
            ) : (
              '표시할 원도가 없습니다.'
            )}
          </div>
        ) : (
          listItems.map((item) => {
            const checked = checkedIds.has(item.id)
            return (
              <label
                key={item.id}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 py-1 pl-3 pr-4 transition-colors hover:bg-slate-50 dark:hover:bg-white/10',
                  checked && 'bg-blue-50 dark:bg-white/20'
                )}
                title={detailWondoLabel(item)}
              >
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span
                    className={cn(
                      'truncate text-xs',
                      checked ? 'font-medium text-primary' : 'text-slate-700 dark:text-white/90'
                    )}
                  >
                    {detailWondoLabel(item)}
                  </span>
                  {item.category ? (
                    <span className="shrink-0 text-[10px] text-slate-400 dark:text-white/50">{item.category}</span>
                  ) : null}
                  {loadingIds.has(item.id) ? (
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-slate-400" />
                  ) : null}
                  {errorIds.has(item.id) ? (
                    <span className="shrink-0 text-[10px] text-destructive">불러오기 실패</span>
                  ) : null}
                </span>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onCheckedChange(item.id, e.target.checked)}
                  className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-white/30"
                />
              </label>
            )
          })
        )}
      </div>
    </div>
  )
}
