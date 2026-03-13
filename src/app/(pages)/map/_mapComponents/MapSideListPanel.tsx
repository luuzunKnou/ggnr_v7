'use client';

import React, { useRef, useCallback, useEffect } from 'react';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

const SIDEBAR_WIDTH = 65;

export type MapSideListPanelProps = {
  width: number;
  minWidth: number;
  maxWidth: number;
  /** 이 패널의 왼쪽 끝 X(px). 드래그 시 새 너비 = clientX - leftOffsetPx. 미지정 시 SIDEBAR_WIDTH 사용(첫 번째 패널) */
  leftOffsetPx?: number;
  onWidthChange: (width: number) => void;
  children: React.ReactNode;
  className?: string;
};

export function MapSideListPanel({
  width,
  minWidth,
  maxWidth,
  leftOffsetPx = SIDEBAR_WIDTH,
  onWidthChange,
  children,
  className,
}: MapSideListPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const onWidthChangeRef = useRef(onWidthChange);
  onWidthChangeRef.current = onWidthChange;

  const handleResize = useCallback(
    (e: MouseEvent) => {
      const next = Math.min(maxWidth, Math.max(minWidth, e.clientX - leftOffsetPx));
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        onWidthChangeRef.current(next);
      });
    },
    [minWidth, maxWidth, leftOffsetPx]
  );

  const handleResizeEnd = useCallback(() => {
    window.removeEventListener('mousemove', handleResize);
    window.removeEventListener('mouseup', handleResize);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [handleResize]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', handleResize);
      window.addEventListener('mouseup', handleResizeEnd);
    },
    [handleResize, handleResizeEnd]
  );

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('mousemove', handleResize);
      window.removeEventListener('mouseup', handleResizeEnd);
    };
  }, [handleResize, handleResizeEnd]);

  return (
    <div
      ref={panelRef}
      className={cn(
        'h-full shrink-0 flex flex-col bg-white border-r border-slate-200 shadow-lg overflow-hidden relative',
        className
      )}
      style={{ width: `${width}px` }}
    >
      <div
        role="separator"
        aria-label="패널 너비 조절"
        onMouseDown={handleResizeStart}
        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize flex items-center justify-center z-10 group hover:bg-slate-100/80"
      >
        <span className="opacity-0 group-hover:opacity-100 text-slate-400 transition-opacity">
          <GripVertical className="w-4 h-4" />
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {children}
      </div>
    </div>
  );
}
