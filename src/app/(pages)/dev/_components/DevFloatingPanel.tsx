'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const DEFAULT_POSITION = { top: 80, right: 80 };

type PanelPosition =
  | { top: number; right: number; left?: never }
  | { top: number; left: number; right?: never };

type DevFloatingPanelProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
  minHeight?: string;
  maxHeight?: string;
  defaultPosition?: PanelPosition;
  /** Dialog처럼 뒤 화면을 어둡게 — 붕 뜨는 느낌 완화 */
  dimBackdrop?: boolean;
  className?: string;
};

export function DevFloatingPanel({
  open,
  onClose,
  title,
  children,
  width = '36rem',
  minHeight = '500px',
  maxHeight = '90vh',
  defaultPosition = DEFAULT_POSITION,
  dimBackdrop = false,
  className,
}: DevFloatingPanelProps) {
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
    if (!open) return;
    if (useLeft) {
      setPosition({ top: anchorTop, left: anchorH });
    } else {
      setPosition({ top: anchorTop, right: anchorH });
    }
  }, [open, anchorTop, anchorH, useLeft]);

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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      {dimBackdrop ? (
        <div
          className="pointer-events-auto fixed inset-0 bg-black/50"
          aria-hidden
          onClick={onClose}
        />
      ) : null}
      <div
        className={cn(
          'pointer-events-auto flex flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-lg dark:shadow-none dark:ring-1 dark:ring-border',
          className
        )}
        style={{
          position: 'fixed',
          top: position.top,
          ...(useLeft ? { left: position.left } : { right: position.right }),
          width,
          maxWidth: '95vw',
          minHeight,
          maxHeight,
        }}
      >
        <div
          role="button"
          tabIndex={0}
          onPointerDown={handlePointerDown}
          className="flex shrink-0 cursor-grab select-none items-center justify-between border-b border-border bg-card px-4 py-3 text-foreground active:cursor-grabbing hover:bg-muted/30"
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') e.preventDefault();
          }}
        >
          <span className="text-sm font-medium">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="닫기"
            title="닫기"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
