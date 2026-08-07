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
  /** 본문 래퍼(flex-1)에 추가 클래스. 예: `overflow-y-auto`로 패널 전체 스크롤 */
  contentClassName?: string;
};

export function MapSideListPanel({
  width,
  minWidth,
  maxWidth,
  leftOffsetPx = SIDEBAR_WIDTH,
  onWidthChange,
  children,
  className,
  contentClassName,
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
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [handleResize]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', handleResize);
      // once: 드래그 종료 시 브라우저가 해제 → 종료 핸들러가 자기 자신을 참조하지 않는다
      window.addEventListener('mouseup', handleResizeEnd, { once: true });
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
        'relative flex h-full shrink-0 flex-col overflow-hidden border-r border-border bg-background shadow-lg',
        className
      )}
      style={{ width: `${width}px` }}
    >
      <div
        role="separator"
        aria-label="패널 너비 조절"
        onMouseDown={handleResizeStart}
        className="absolute right-0 top-0 bottom-0 z-10 flex w-2 cursor-col-resize items-center justify-center group hover:bg-muted/60"
      >
        <span className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          <GripVertical className="h-4 w-4" />
        </span>
      </div>

      <div
        className={cn(
          'flex-1 min-h-0 flex flex-col',
          contentClassName ?? 'overflow-hidden',
        )}
      >
        {children}
      </div>
    </div>
  );
}
