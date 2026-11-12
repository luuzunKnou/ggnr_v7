'use client'

import type { ReactNode } from 'react'
import { Minus, Square, X } from 'lucide-react'
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
  onClose: () => void
  /** 최소화·닫기 왼쪽 — select·다시 그리기 등 */
  headerActions?: ReactNode
  pinPosition?: { top: number; left: number } | null
  focusToken?: number
  onActivate?: () => void
  width?: string
  minimizedWidth?: string
  maxHeight?: string
  defaultPosition?: MapFloatingPanelPosition
  zLayer?: MapUiZLayer
  className?: string
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
  onClose,
  headerActions,
  pinPosition = null,
  focusToken,
  onActivate,
  width = 'min(600px, calc(100vw - 2rem))',
  minimizedWidth = MAP_DETAIL_FLOAT_MINIMIZED_WIDTH,
  maxHeight = '92vh',
  defaultPosition = { top: 72, left: 80 },
  zLayer = 'detailFloating',
  className,
  children,
}: MapDetailFloatingPanelProps) {
  const layerText = String(layer ?? '').trim()
  const showLayer = Boolean(layerText && layerText !== title)
  const showTitle = !(minimized && hideTitleWhenMinimized)

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
      onHeaderDoubleClick={() => onMinimizedChange?.(!minimized)}
      className={cn('bg-background backdrop-blur-none', className)}
      header={
        <>
          <div
            className={
              minimized
                ? 'standard-detail-float-heading-min'
                : 'standard-detail-float-heading pr-2'
            }
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
          <div className="flex shrink-0 items-center gap-1">
            {!minimized ? headerActions : null}
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
        </>
      }
    >
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
