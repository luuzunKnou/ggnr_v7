'use client'

import type { ReactNode } from 'react'
import { ChevronDown, ChevronLeft, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MAP_LAYER_PANEL_SURFACE_CLASS } from '../../../_mapComponents/mapControlPanel/mapLayerPanelLayout'
import type { WtlNetworkToolBtnVariant } from './WtlNetworkExportMenu'

const FULL_STATS_WIDTH = 340
const FULL_RIGHT_WIDTH = 420
/** 시설목록 표 최대 높이 — 레이어 미선택·빈 목록에도 동일 유지 */
export const FULL_LAYOUT_LIST_MAX_HEIGHT_PX = 240
/** 1·2단 underline(h-7×2) + 3단 chip(py-1+h-6) — 선택/미선택 높이 고정용 */
const FULL_LAYOUT_TABS_HEIGHT_PX = 28 + 28 + 32
const FULL_LAYOUT_LIST_SECTION_HEIGHT_PX =
  FULL_LAYOUT_TABS_HEIGHT_PX + FULL_LAYOUT_LIST_MAX_HEIGHT_PX
/** 우측 맵 컨트롤: right-4(16) + 메뉴 45 + 간격 12 */
const FULL_RIGHT_MENU_INSET = 16 + 45 + 12
export { FULL_STATS_WIDTH, FULL_RIGHT_WIDTH }

type VariantOption = {
  value: WtlNetworkToolBtnVariant
  label: string
}

type LayerItem = {
  define_table_name: string
  define_table_kor_name: string
}

type CategoryTab = {
  title: string
  items: LayerItem[]
}

type SourceTab = {
  id: string
  label: string
  categories: CategoryTab[]
}

export type WtlNetworkStatsViewMode = 'table' | 'graph' | 'both'

export const STATS_VIEW_MODE_OPTIONS: {
  value: WtlNetworkStatsViewMode
  label: string
}[] = [
  { value: 'table', label: '도표만' },
  { value: 'graph', label: '그래프만' },
  { value: 'both', label: '그래프 및 도표' },
]

type Props = {
  leftOffsetPx: number
  toolBtnVariant: WtlNetworkToolBtnVariant
  onToolBtnVariantChange: (v: WtlNetworkToolBtnVariant) => void
  variantOptions: VariantOption[]
  statsViewMode: WtlNetworkStatsViewMode
  onStatsViewModeChange: (v: WtlNetworkStatsViewMode) => void
  onClose: () => void
  stats: ReactNode
  tools: ReactNode
  search: ReactNode
  /** 1단: 지하시설물 그룹 · 2단: 분류 · 3단: 레이어 */
  sources: SourceTab[]
  sourceTab: string
  groupTab: string
  layerTab: string
  onSourceTabChange: (id: string) => void
  onGroupTabChange: (title: string) => void
  onLayerTabChange: (key: string) => void
  listOpen: boolean
  onToggleListOpen: () => void
  listMeta: string
  listBody: ReactNode
  listError?: string
}

/** 활성 레이어가 있는 카테고리 — primary보다 살짝 밝은 글자 (하단 bar 없음) */
const TAB_LIT_TEXT =
  'text-[color-mix(in_srgb,var(--primary)_62%,white)] dark:text-[color-mix(in_srgb,var(--primary)_78%,white)]'

function TabRow({
  items,
  activeId,
  onChange,
  variant = 'underline',
  litIds,
}: {
  items: { id: string; label: string }[]
  activeId: string
  onChange: (id: string) => void
  variant?: 'underline' | 'chip'
  /** 활성 레이어가 있는 항목 id — underline에서만 글자색 강조(bar 없음) */
  litIds?: ReadonlySet<string>
}) {
  if (items.length === 0) return null
  if (variant === 'chip') {
    return (
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-1.5 py-1">
        {items.map((it) => {
          const on = it.id === activeId
          return (
            <button
              key={it.id}
              type="button"
              className={cn(
                'h-6 shrink-0 cursor-pointer rounded px-1.5 text-[11px]',
                on
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
              title={it.label}
              onClick={() => onChange(it.id)}
            >
              {it.label}
            </button>
          )
        })}
      </div>
    )
  }
  return (
    <div className="flex shrink-0 border-b border-border">
      {items.map((it) => {
        const on = it.id === activeId
        const lit = !on && Boolean(litIds?.has(it.id))
        return (
          <button
            key={it.id}
            type="button"
            className={cn(
              'h-7 min-w-0 flex-1 cursor-pointer truncate px-0.5 text-center text-[11px] border-b-2 -mb-px',
              on
                ? 'border-primary font-semibold text-primary'
                : lit
                  ? cn('border-transparent font-medium', TAB_LIT_TEXT)
                  : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
            title={it.label}
            onClick={() => onChange(it.id)}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

/** 관망조회 «플로팅 UI» — 좌측 통계·도구(fixed) + 우측 하단 검색·시설목록 */
export function WtlNetworkFullLayoutPanels({
  leftOffsetPx,
  toolBtnVariant,
  onToolBtnVariantChange,
  variantOptions,
  statsViewMode,
  onStatsViewModeChange,
  onClose,
  stats,
  tools,
  search,
  sources,
  sourceTab,
  groupTab,
  layerTab,
  onSourceTabChange,
  onGroupTabChange,
  onLayerTabChange,
  listOpen,
  onToggleListOpen,
  listMeta,
  listBody,
  listError,
}: Props) {
  const activeSource = sources.find((s) => s.id === sourceTab) ?? sources[0]
  const categories = activeSource?.categories ?? []
  const layerItems =
    categories.find((c) => c.title === groupTab)?.items ?? []
  const emptyLayers = sources.length === 0
  /** 주소검색(SEARCH_BAR_MARGIN 20)과 동일한 좌측 여백 */
  const left = leftOffsetPx + 20

  return (
    <div className="pointer-events-none fixed inset-0 z-[39]">
      <div
        className={cn(
          'pointer-events-auto absolute flex flex-col overflow-hidden',
          MAP_LAYER_PANEL_SURFACE_CLASS
        )}
        style={{
          left,
          top: 60,
          width: FULL_STATS_WIDTH,
          maxHeight: 'calc(100vh - 70px)',
        }}
      >
        <div className="standard-map-float-header shrink-0">
          <span className="standard-map-float-header-title">관망조회 통계</span>
          <div className="flex shrink-0 items-center gap-1">
            <label className="sr-only" htmlFor="wtl-network-tool-btn-variant-full">
              관망조회 UI
            </label>
            <select
              id="wtl-network-tool-btn-variant-full"
              title="관망조회 UI"
              value={toolBtnVariant}
              onChange={(e) =>
                onToolBtnVariantChange(e.target.value as WtlNetworkToolBtnVariant)
              }
              className="h-7 max-w-[9.5rem] cursor-pointer rounded border border-slate-200 bg-white px-1.5 text-[11px] text-slate-800 dark:border-white/20 dark:bg-black/40 dark:text-white/90"
            >
              {variantOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="wtl-network-stats-view-mode">
              통계 표시
            </label>
            <select
              id="wtl-network-stats-view-mode"
              title="통계 표시"
              value={statsViewMode}
              onChange={(e) =>
                onStatsViewModeChange(e.target.value as WtlNetworkStatsViewMode)
              }
              className="h-7 max-w-[8.5rem] cursor-pointer rounded border border-slate-200 bg-white px-1.5 text-[11px] text-slate-800 dark:border-white/20 dark:bg-black/40 dark:text-white/90"
            >
              {STATS_VIEW_MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="standard-map-float-header-close inline-flex h-7 w-7 items-center justify-center"
              onClick={onClose}
              title="닫기"
              aria-label="닫기"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{stats}</div>
      </div>

      {/* 우측: 도구(별도 섹션·좌상단) + 검색·시설목록 */}
      <div
        className="pointer-events-none absolute flex items-start gap-2"
        style={{
          right: FULL_RIGHT_MENU_INSET,
          bottom: 12,
          maxHeight: 'calc(100vh - 80px)',
        }}
      >
        <div
          className={cn(
            'pointer-events-auto shrink-0 overflow-hidden',
            MAP_LAYER_PANEL_SURFACE_CLASS
          )}
        >
          {tools}
        </div>

        <div
          className={cn(
            'pointer-events-auto flex min-h-0 flex-col overflow-hidden',
            MAP_LAYER_PANEL_SURFACE_CLASS
          )}
          style={{
            width: FULL_RIGHT_WIDTH,
            maxHeight: 'calc(100vh - 80px)',
          }}
        >
        <div className="standard-map-float-header shrink-0">
          <span className="standard-map-float-header-title">검색 조건</span>
        </div>
        <div className="shrink-0 border-b border-slate-100 px-2 py-1.5 dark:border-white/10">
          <div className="max-h-[34vh] min-h-0 overflow-y-auto">{search}</div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            className={cn(
              'standard-map-float-header shrink-0',
              'border-t-2 border-t-slate-300 dark:border-t-white/25'
            )}
          >
            <button
              type="button"
              className="inline-flex min-w-0 cursor-pointer items-center gap-1"
              title={listOpen ? '시설목록 접기' : '시설목록 펼치기'}
              onClick={onToggleListOpen}
            >
              <ChevronLeft
                className={cn(
                  'h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform dark:text-white/70',
                  !listOpen && '-rotate-90'
                )}
                aria-hidden
              />
              <span className="standard-map-float-header-title">시설목록</span>
            </button>
            <span className="truncate text-[11px] text-slate-500 dark:text-white/60">
              {listMeta}
            </span>
          </div>

          {listOpen ? (
            <>
              {listError ? (
                <p className="standard-detail-error mx-2 my-1 shrink-0">{listError}</p>
              ) : null}

              <div
                className="flex shrink-0 flex-col overflow-hidden"
                style={{
                  height: FULL_LAYOUT_LIST_SECTION_HEIGHT_PX,
                  maxHeight: FULL_LAYOUT_LIST_SECTION_HEIGHT_PX,
                }}
              >
                {emptyLayers ? (
                  <p className="standard-table-empty flex h-full items-center justify-center px-3">
                    지하시설물에서 레이어를 추가해 주세요
                  </p>
                ) : (
                  <>
                    {/* 1단: 지하시설물 그룹 */}
                    <TabRow
                      items={sources.map((s) => ({ id: s.id, label: s.label }))}
                      activeId={sourceTab}
                      onChange={onSourceTabChange}
                      variant="underline"
                    />
                    {/* 2단: 분류(관로·상수시설 등) — 목록에 있으면 활성 레이어 있음(선택 탭은 bar 유지) */}
                    <TabRow
                      items={categories.map((c) => ({
                        id: c.title,
                        label: c.title,
                      }))}
                      activeId={groupTab}
                      onChange={onGroupTabChange}
                      variant="underline"
                      litIds={new Set(categories.map((c) => c.title))}
                    />
                    {/* 3단: 레이어 */}
                    <TabRow
                      items={layerItems.map((it) => ({
                        id: it.define_table_name,
                        label: it.define_table_kor_name,
                      }))}
                      activeId={layerTab}
                      onChange={onLayerTabChange}
                      variant="chip"
                    />
                    <div
                      className="standard-list-body min-h-0 flex-1 overflow-hidden p-2"
                      style={{
                        height: FULL_LAYOUT_LIST_MAX_HEIGHT_PX,
                        maxHeight: FULL_LAYOUT_LIST_MAX_HEIGHT_PX,
                      }}
                    >
                      {listBody}
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <button
              type="button"
              className="flex cursor-pointer items-center justify-center gap-1 px-2 py-2 text-[11px] text-muted-foreground hover:bg-muted/40"
              title="시설목록 펼치기"
              onClick={onToggleListOpen}
            >
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              시설목록 펼치기
            </button>
          )}
        </div>
        </div>
      </div>
    </div>
  )
}
