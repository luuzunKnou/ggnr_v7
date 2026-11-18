'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import {
  clearMapUiZPanelSelection,
  MAP_UI_Z_CLASS,
  selectMapUiZPanel,
  type MapUiZLayer,
} from '@/lib/mapUiZIndex';

const DEFAULT_POSITION = { top: 80, right: 80 };
/** 화면 밖으로만 못 나가게 하고, 하단 배치 시 살짝 띄움 */
const VIEWPORT_EDGE_GAP = 0;
const VIEWPORT_BOTTOM_GAP = 12;

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
  /** 루트 패널 DOM (높이·위치 측정용) */
  panelRef?: React.Ref<HTMLDivElement | null>;
  /**
   * true면 지도 영역이 아니라 브라우저 화면 기준으로 띄운다.
   * 목록·업무 패널 위로 옮길 수 있고, 화면 밖으로는 나가지 않는다.
   */
  viewport?: boolean;
  /**
   * standard-utilities.css `.map-ui-z-*` 티어.
   * 미지정 + viewport면 viewportFloating. 클릭 시 selected(+1).
   */
  zLayer?: MapUiZLayer;
}

export function MapFloatingPanel({
  header,
  children,
  className,
  style,
  defaultPosition = DEFAULT_POSITION,
  width = '380px',
  maxHeight = '80vh',
  panelRef,
  viewport = false,
  zLayer,
}: MapFloatingPanelProps) {
  const useLeft = defaultPosition.left != null;
  const [position, setPosition] = useState(defaultPosition);
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** 화면 기준 모드에서 사용자가 옮긴 뒤에는 기본 위치로 되돌리지 않는다 */
  const movedRef = useRef(false);
  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    startTop: 0,
    startRight: 0,
    startLeft: 0,
  });

  const resolvedLayer: MapUiZLayer | undefined =
    zLayer ?? (viewport ? 'viewportFloating' : undefined);
  const zClass = resolvedLayer ? MAP_UI_Z_CLASS[resolvedLayer] : undefined;

  const bringToFront = useCallback(() => {
    if (!zClass || !rootRef.current) return;
    selectMapUiZPanel(rootRef.current);
  }, [zClass]);

  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (rootRef.current && rootRef.current !== node) {
        clearMapUiZPanelSelection(rootRef.current);
      }
      rootRef.current = node;
      if (typeof panelRef === 'function') {
        panelRef(node);
      } else if (panelRef && typeof panelRef === 'object') {
        (panelRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    [panelRef]
  );

  /** 열릴 때(마운트) selected — 이미 열린 다른 동티어 패널보다 앞으로 */
  useEffect(() => {
    if (!zClass) return;
    const el = rootRef.current;
    if (el) selectMapUiZPanel(el);
    return () => {
      clearMapUiZPanelSelection(rootRef.current);
    };
  }, [zClass]);

  const clampToViewport = useCallback((next: { top: number; left: number }) => {
    const el = rootRef.current;
    const panelWidth = el?.offsetWidth ?? 0;
    const panelHeight = el?.offsetHeight ?? 0;
    const maxLeft = Math.max(
      VIEWPORT_EDGE_GAP,
      window.innerWidth - panelWidth - VIEWPORT_EDGE_GAP
    );
    const maxTop = Math.max(
      VIEWPORT_EDGE_GAP,
      window.innerHeight - panelHeight - VIEWPORT_BOTTOM_GAP
    );
    return {
      top: Math.min(Math.max(VIEWPORT_EDGE_GAP, next.top), maxTop),
      left: Math.min(Math.max(VIEWPORT_EDGE_GAP, next.left), maxLeft),
    };
  }, []);

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
    if (!viewport) {
      if (useLeft) {
        setPosition({ top: anchorTop, left: anchorH });
      } else {
        setPosition({ top: anchorTop, right: anchorH });
      }
      return;
    }
    if (movedRef.current) return;
    const place = () => {
      const panelWidth = rootRef.current?.offsetWidth ?? 0;
      const rawLeft = useLeft
        ? anchorH
        : Math.max(0, window.innerWidth - anchorH - panelWidth);
      setPosition(clampToViewport({ top: anchorTop, left: rawLeft }));
    };
    place();
    // 첫 페인트 후 실측 높이로 하단 배치 등을 한 번 더 맞춤
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [anchorTop, anchorH, useLeft, viewport, clampToViewport]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current.isDragging) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (viewport) {
        movedRef.current = true;
        setPosition(
          clampToViewport({
            top: dragRef.current.startTop + dy,
            left: dragRef.current.startLeft + dx,
          })
        );
        return;
      }
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
  }, [useLeft, viewport, clampToViewport]);

  /** 창 크기가 줄어도 패널이 화면 밖에 남지 않게 */
  useEffect(() => {
    if (!viewport) return;
    const onResize = () => {
      setPosition((prev) => clampToViewport({ top: prev.top, left: prev.left ?? 0 }));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [viewport, clampToViewport]);

  const { zIndex: _ignoredZ, ...restStyle } = style ?? {};

  const panel = (
    <div
      ref={setRootRef}
      onPointerDownCapture={bringToFront}
      className={cn(
        'flex flex-col rounded-xl border border-border bg-card/95 shadow-2xl backdrop-blur-md overflow-hidden pointer-events-auto',
        zClass,
        className
      )}
      style={{
        position: viewport ? 'fixed' : 'absolute',
        top: position.top,
        ...(viewport || useLeft ? { left: position.left } : { right: position.right }),
        width,
        maxWidth: viewport ? '100vw' : '95vw',
        maxHeight,
        ...restStyle,
        // zLayer 미사용·절대 배치만 zIndex 인라인 허용
        ...(!zClass && _ignoredZ != null ? { zIndex: _ignoredZ } : null),
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        className="flex items-center justify-between border-b border-border/60 px-3 py-1.5 shrink-0 cursor-grab active:cursor-grabbing hover:bg-muted/60 select-none bg-muted/40"
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') e.preventDefault();
        }}
      >
        {header}
      </div>
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
  );

  if (!viewport) return panel;
  if (typeof document === 'undefined') return null;
  return createPortal(panel, document.body);
}
