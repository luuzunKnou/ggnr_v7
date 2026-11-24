'use client'

import React, { useCallback, useEffect, useRef } from 'react'
import { GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'

export type MapFloatResizeEdge = 'left' | 'right'

export type MapFloatResizableFrameProps = {
  width: number
  minWidth: number
  maxWidth: number
  onWidthChange: (width: number) => void
  /** right: 우측 잡고 넓히기(좌측 고정) / left: 좌측 잡고 넓히기(우측 고정) */
  resizeEdge?: MapFloatResizeEdge
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}

/**
 * 지도 플로팅 패널 너비 조절 — MapSideListPanel 핸들과 동일 톤.
 */
export function MapFloatResizableFrame({
  width,
  minWidth,
  maxWidth,
  onWidthChange,
  resizeEdge = 'right',
  className,
  style,
  children,
}: MapFloatResizableFrameProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const fixedEdgePxRef = useRef(0)
  const onWidthChangeRef = useRef(onWidthChange)
  onWidthChangeRef.current = onWidthChange

  const handleResize = useCallback(
    (e: MouseEvent) => {
      const next =
        resizeEdge === 'right'
          ? e.clientX - fixedEdgePxRef.current
          : fixedEdgePxRef.current - e.clientX
      const clamped = Math.min(maxWidth, Math.max(minWidth, next))
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        onWidthChangeRef.current(clamped)
      })
    },
    [maxWidth, minWidth, resizeEdge]
  )

  const handleResizeEnd = useCallback(() => {
    window.removeEventListener('mousemove', handleResize)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [handleResize])

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const rect = panelRef.current?.getBoundingClientRect()
      if (!rect) return
      fixedEdgePxRef.current = resizeEdge === 'right' ? rect.left : rect.right
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', handleResize)
      window.addEventListener('mouseup', handleResizeEnd, { once: true })
    },
    [handleResize, handleResizeEnd, resizeEdge]
  )

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      window.removeEventListener('mousemove', handleResize)
      window.removeEventListener('mouseup', handleResizeEnd)
    }
  }, [handleResize, handleResizeEnd])

  return (
    <div
      ref={panelRef}
      className={cn('relative flex min-h-0 flex-col overflow-hidden', className)}
      style={{ ...style, width }}
    >
      <div
        role="separator"
        aria-label="패널 너비 조절"
        title="너비 조절"
        onMouseDown={handleResizeStart}
        className={cn(
          'pointer-events-auto absolute top-0 bottom-0 z-20 flex w-2.5 cursor-col-resize items-center justify-center group hover:bg-muted/50',
          resizeEdge === 'right' ? 'right-0' : 'left-0'
        )}
      >
        <span className="pointer-events-none text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          <GripVertical className="h-4 w-4" />
        </span>
      </div>
      <div
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
          resizeEdge === 'right'
            ? '[&_.standard-list-scroll]:mr-[10px] [&_.scrollbar-thin:not(.map-side-detail-scroll)]:mr-[10px]'
            : '[&_.standard-list-scroll]:ml-[10px] [&_.scrollbar-thin:not(.map-side-detail-scroll)]:ml-[10px]'
        )}
      >
        {children}
      </div>
    </div>
  )
}
