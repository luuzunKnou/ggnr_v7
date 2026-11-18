'use client'

import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import {
  AppWindow,
  Minus,
  Square,
  SquareArrowOutUpRight,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MapUiZLayer } from '@/lib/mapUiZIndex'
import {
  MapFloatingPanel,
  type MapFloatingPanelPosition,
} from '@/app/(pages)/map/_mapComponents/MapFloatingPanel'
import { MAP_DETAIL_FLOAT_MINIMIZED_WIDTH } from '@/app/(pages)/map/_mapComponents/mapDetailFloatingDock'

export type MapDetailFloatingPanelProps = {
  layer?: string | null
  title: string
  /** 최소화 시 title 줄 숨김 (단면도 등) */
  hideTitleWhenMinimized?: boolean
  minimized?: boolean
  onMinimizedChange?: (minimized: boolean) => void
  /** false면 최소화 버튼·헤더 더블클릭 숨김 (기본 true) */
  allowMinimize?: boolean
  onClose: () => void
  /**
   * 펼침 시 기본 layer/title 자리(좌측)에 표시.
   * hideHeading과 함께 쓰면 heading은 숨기고 이 슬롯이 flex-1을 차지한다.
   */
  headerLeading?: ReactNode
  /** 헤더 최좌측(제목 앞) — pin 등 */
  headerStart?: ReactNode
  /** 펼침 시 standard-detail-float-heading display:none (최소화 시에는 기본 heading 유지) */
  hideHeading?: boolean
  /** 펼침 시 최소화·닫기 왼쪽 — 건수 표시·다시 그리기 등 */
  headerActions?: ReactNode
  /** 펼침·최소화 모두 최소화·닫기 왼쪽에 표시 (위치 이동 등) */
  headerActionsAlways?: ReactNode
  /** 헤더 우클릭 — 화면에서 보기(플로팅 분리) */
  onHeaderOpenInScreen?: () => void
  /** 헤더 우클릭 — 새 창으로 보기(blank) */
  onHeaderOpenInNewWindow?: () => void
  pinPosition?: { top: number; left: number } | null
  focusToken?: number
  onActivate?: () => void
  width?: string
  minimizedWidth?: string
  maxHeight?: string
  defaultPosition?: MapFloatingPanelPosition
  zLayer?: MapUiZLayer
  className?: string
  /** 패널 루트 위 오버레이(튜토리얼 팁 등). absolute 기준은 패널 */
  overlay?: ReactNode
  panelRef?: Ref<HTMLDivElement | null>
  /** 클릭 모서리 부착 — 하단 gap clamp로 모서리가 밀리지 않게 */
  flushViewportClamp?: boolean
  children: ReactNode
}

/**
 * 상세·단면도 공통 플로팅.
 * detailFloating z-index, 최소화/펼치기(─/□), 헤더 더블클릭 토글, 하단 도킹 pin.
 */
export function MapDetailFloatingPanel({
  layer,
  title,
  hideTitleWhenMinimized = false,
  minimized = false,
  onMinimizedChange,
  allowMinimize = true,
  onClose,
  headerLeading,
  headerStart,
  hideHeading = false,
  headerActions,
  headerActionsAlways,
  onHeaderOpenInScreen,
  onHeaderOpenInNewWindow,
  pinPosition = null,
  focusToken,
  onActivate,
  width = 'min(600px, calc(100vw - 2rem))',
  minimizedWidth = MAP_DETAIL_FLOAT_MINIMIZED_WIDTH,
  maxHeight = '92vh',
  defaultPosition = { top: 72, left: 80 },
  zLayer = 'detailFloating',
  className,
  overlay,
  panelRef,
  flushViewportClamp = false,
  children,
}: MapDetailFloatingPanelProps) {
  const layerText = String(layer ?? '').trim()
  const showLayer = Boolean(layerText && layerText !== title)
  const showTitle = !(minimized && hideTitleWhenMinimized)
  const useLeadingSlot = Boolean(headerLeading) && !minimized
  const hideDefaultHeading = hideHeading && !minimized
  const headerRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ left: number; top: number } | null>(
    null
  )

  const showScreenItem = Boolean(onHeaderOpenInScreen)
  const showBlankItem = Boolean(onHeaderOpenInNewWindow)
  const showCtxMenu =
    allowMinimize || showScreenItem || showBlankItem

  useEffect(() => {
    if (!ctxMenu) return
    const close = (e: MouseEvent) => {
      const t = e.target as Node | null
      if (menuRef.current?.contains(t)) return
      setCtxMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null)
    }
    window.addEventListener('mousedown', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [ctxMenu])

  const handleHeaderContextMenu = (e: React.MouseEvent) => {
    if (!showCtxMenu) return
    e.preventDefault()
    e.stopPropagation()
    const pad = 8
    const menuW = 180
    const menuH = 120
    const left = Math.min(
      Math.max(pad, e.clientX),
      Math.max(pad, window.innerWidth - menuW - pad)
    )
    const top = Math.min(
      Math.max(pad, e.clientY),
      Math.max(pad, window.innerHeight - menuH - pad)
    )
    setCtxMenu({ left, top })
  }

  return (
    <MapFloatingPanel
      viewport
      zLayer={zLayer}
      width={minimized ? minimizedWidth : width}
      maxHeight={maxHeight}
      defaultPosition={defaultPosition}
      pinPosition={pinPosition}
      focusToken={focusToken}
      onActivate={onActivate}
      panelRef={panelRef}
      onHeaderDoubleClick={
        allowMinimize ? () => onMinimizedChange?.(!minimized) : undefined
      }
      flushViewportClamp={flushViewportClamp}
      className={cn('relative bg-background backdrop-blur-none', className)}
      header={
        <div
          ref={headerRef}
          className="flex min-w-0 flex-1 items-center justify-between gap-1"
          onContextMenu={handleHeaderContextMenu}
        >
          {headerStart}
          <div
            className={cn(
              'min-w-0 flex-1',
              minimized
                ? 'standard-detail-float-heading-min'
                : 'standard-detail-float-heading pr-2',
              hideDefaultHeading && 'hidden'
            )}
            aria-hidden={hideDefaultHeading || undefined}
          >
            {showLayer ? (
              <span
                className={cn(
                  'standard-detail-float-layer',
                  minimized && 'max-w-[45%] shrink-0'
                )}
                title={layerText}
              >
                {layerText}
              </span>
            ) : null}
            {showTitle ? (
              <span
                className={cn(
                  minimized || !showLayer
                    ? 'standard-detail-float-title'
                    : 'standard-detail-float-title-below',
                  minimized && 'min-w-0'
                )}
                title={title}
              >
                {title}
              </span>
            ) : null}
          </div>
          {useLeadingSlot ? (
            <div className="flex min-w-0 flex-1 items-center gap-1 pr-2">
              {headerLeading}
            </div>
          ) : null}
          <div className="flex shrink-0 items-center gap-1">
            {!minimized ? headerActions : null}
            {headerActionsAlways}
            {allowMinimize ? (
              <button
                type="button"
                title={minimized ? '펼치기' : '최소화'}
                aria-label={minimized ? '펼치기' : '최소화'}
                aria-expanded={!minimized}
                onClick={() => onMinimizedChange?.(!minimized)}
                className="standard-panel-close cursor-pointer"
              >
                {minimized ? (
                  <Square className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                ) : (
                  <Minus className="h-4 w-4" aria-hidden />
                )}
              </button>
            ) : null}
            <button
              type="button"
              title="닫기"
              onClick={onClose}
              className="standard-panel-close cursor-pointer"
              aria-label="닫기"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {ctxMenu && typeof document !== 'undefined'
            ? createPortal(
                <div
                  ref={menuRef}
                  role="menu"
                  className="fixed z-[10050] min-w-[11rem] rounded-md border border-border bg-background py-1 text-xs shadow-lg"
                  style={{ left: ctxMenu.left, top: ctxMenu.top }}
                >
                  {allowMinimize ? (
                    <button
                      type="button"
                      role="menuitem"
                      title={minimized ? '펼치기' : '최소화'}
                      className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-foreground hover:bg-primary/10"
                      onClick={() => {
                        setCtxMenu(null)
                        onMinimizedChange?.(!minimized)
                      }}
                    >
                      {minimized ? (
                        <Square className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      ) : (
                        <Minus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      )}
                      {minimized ? '펼치기' : '최소화'}
                    </button>
                  ) : null}
                  {showScreenItem ? (
                    <button
                      type="button"
                      role="menuitem"
                      title="화면에서 보기"
                      className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-foreground hover:bg-primary/10"
                      onClick={() => {
                        setCtxMenu(null)
                        onHeaderOpenInScreen?.()
                      }}
                    >
                      <AppWindow className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      화면에서 보기
                    </button>
                  ) : null}
                  {showBlankItem ? (
                    <button
                      type="button"
                      role="menuitem"
                      title="새 창으로 보기"
                      className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-foreground hover:bg-primary/10"
                      onClick={() => {
                        setCtxMenu(null)
                        onHeaderOpenInNewWindow?.()
                      }}
                    >
                      <SquareArrowOutUpRight
                        className="h-3.5 w-3.5 shrink-0"
                        aria-hidden
                      />
                      새 창으로 보기
                    </button>
                  ) : null}
                </div>,
                document.body
              )
            : null}
        </div>
      }
    >
      {overlay}
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-hidden bg-background',
          minimized && 'hidden'
        )}
      >
        {children}
      </div>
    </MapFloatingPanel>
  )
}
