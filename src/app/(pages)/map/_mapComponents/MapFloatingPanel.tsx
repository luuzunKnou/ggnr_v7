'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';

const DEFAULT_POSITION = { top: 80, right: 80 };

export type MapFloatingPanelPosition =
  | { top: number; right: number; left?: never }
  | { top: number; left: number; right?: never };

export interface MapFloatingPanelProps {
  header: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  defaultPosition?: MapFloatingPanelPosition;
  width?: string;
  maxHeight?: string;
}

export function MapFloatingPanel({
  header,
  children,
  className,
  style,
  defaultPosition = DEFAULT_POSITION,
  width = '380px',
  maxHeight = '80vh',
}: MapFloatingPanelProps) {
  const useLeft = defaultPosition.left != null;
  const [position, setPosition] = useState(defaultPosition);
  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    startTop: 0,
    startRight: 0,
    startLeft: 0,
  });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      dragRef.current = {
        isDragging: true,
        startX: e.clientX,
        startY: e.clientY,
        startTop: position.top,
        startRight: position.right ?? 0,
        startLeft: position.left ?? 0,
      };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [position]
  );

  const anchorTop = defaultPosition.top;
  const anchorH = useLeft
    ? (defaultPosition as { left: number }).left
    : (defaultPosition as { right: number }).right;

  useEffect(() => {
    if (useLeft) {
      setPosition({ top: anchorTop, left: anchorH });
    } else {
      setPosition({ top: anchorTop, right: anchorH });
    }
  }, [anchorTop, anchorH, useLeft]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current.isDragging) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPosition((prev) =>
        useLeft
          ? {
              top: Math.max(0, dragRef.current.startTop + dy),
              left: Math.max(0, dragRef.current.startLeft + dx),
            }
          : {
              top: Math.max(0, dragRef.current.startTop + dy),
              right: Math.max(0, dragRef.current.startRight - dx),
            }
      );
    };
    const onUp = () => {
      dragRef.current.isDragging = false;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [useLeft]);

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border border-slate-200 bg-white/95 shadow-2xl backdrop-blur-md overflow-hidden pointer-events-auto',
        className
      )}
      style={{
        position: 'absolute',
        top: position.top,
        ...(useLeft ? { left: position.left } : { right: position.right }),
        width,
        maxWidth: '95vw',
        maxHeight,
        ...style,
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5 shrink-0 cursor-grab active:cursor-grabbing hover:bg-slate-50/60 select-none bg-slate-50/40"
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') e.preventDefault();
        }}
      >
        {header}
      </div>
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
  );
}
