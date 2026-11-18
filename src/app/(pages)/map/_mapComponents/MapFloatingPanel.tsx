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
  /** 마운트·클릭으로 앞으로 올 때 (활성 상세·Escape 등) */
  onActivate?: () => void;
  /** 증가 시 재마운트 없이 앞으로 (이미 열린 상세 포커스) */
  focusToken?: number;
  /**
   * 지정 시 해당 좌표로 고정(드래그·moved 무시).
   * 최소화 하단 도킹 등. null/미지정이면 defaultPosition.
   */
  pinPosition?: { top: number; left: number } | null;
  /** 헤더 더블클릭 (최소화 펼치기 등). 버튼·select 위는 무시 */
  onHeaderDoubleClick?: () => void;
  /**
   * true면 화면 밖만 막음(여백 0).
   * 클릭 모서리 부착 모달이 bottom gap clamp로 밀리지 않게 할 때.
   */
  flushViewportClamp?: boolean;
  /**
   * mapFloat: 우측 레이어 패널과 동일 surface·헤더(rounded-[5px]).
   * default: 상세 플로팅(rounded-xl).
   */
  variant?: 'default' | 'mapFloat';
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
  onActivate,
  focusToken = 0,
  pinPosition = null,
  onHeaderDoubleClick,
  flushViewportClamp = false,
  variant = 'default',
}: MapFloatingPanelProps) {
  const isMapFloat = variant === 'mapFloat';
  const useLeft = defaultPosition.left != null;
  const [position, setPosition] = useState(defaultPosition);
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** 화면 기준 모드에서 사용자가 옮긴 뒤에는 기본 위치로 되돌리지 않는다 */
  const movedRef = useRef(false);
  const edgeGap = flushViewportClamp ? 0 : VIEWPORT_EDGE_GAP;
  const bottomGap = flushViewportClamp ? 0 : VIEWPORT_BOTTOM_GAP;
  /** 최소화(pin) 직전 펼침 위치 — 최대화 시 복원 */
  const prePinPositionRef = useRef<MapFloatingPanelPosition | null>(null);
  const wasPinnedRef = useRef(false);
  const positionRef = useRef(position);
  positionRef.current = position;
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
    onActivate?.();
  }, [zClass, onActivate]);

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
    if (el) {
      selectMapUiZPanel(el);
      onActivate?.();
    }
    return () => {
      clearMapUiZPanelSelection(rootRef.current);
    };
    // onActivate는 마운트 시 1회만 — 의존에 넣지 않음
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount activate
  }, [zClass]);

  /**
   * viewport portal은 body에 직접 붙는다.
   * 부모(업무 패널)가 route/opened 이탈로 언마운트될 때 React 정리보다
   * DOM이 남는 경우가 있어(특히 최소화 pin), 언마운트 시 루트를 강제 제거한다.
   */
  useEffect(() => {
    if (!viewport) return;
    return () => {
      const el = rootRef.current;
      if (!el) return;
      clearMapUiZPanelSelection(el);
      if (el.isConnected) el.remove();
    };
  }, [viewport]);

  /** 이미 마운트된 패널을 다시 앞으로 */
  useEffect(() => {
    if (!zClass || focusToken <= 0) return;
    const el = rootRef.current;
    if (!el) return;
    selectMapUiZPanel(el);
    onActivate?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- token-driven focus
  }, [focusToken, zClass]);

  const clampToViewport = useCallback(
    (next: { top: number; left: number }) => {
      const el = rootRef.current;
      const panelWidth = el?.offsetWidth ?? 0;
      const panelHeight = el?.offsetHeight ?? 0;
      const maxLeft = Math.max(
        edgeGap,
        window.innerWidth - panelWidth - edgeGap
      );
      const maxTop = Math.max(
        edgeGap,
        window.innerHeight - panelHeight - bottomGap
      );
      return {
        top: Math.min(Math.max(edgeGap, next.top), maxTop),
        left: Math.min(Math.max(edgeGap, next.left), maxLeft),
      };
    },
    [edgeGap, bottomGap]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (pinPosition) return;
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
    [position, pinPosition]
  );

  const anchorTop = defaultPosition.top;
  const anchorH = useLeft
    ? (defaultPosition as { left: number }).left
    : (defaultPosition as { right: number }).right;
  const pinTop = pinPosition?.top;
  const pinLeft = pinPosition?.left;

  useEffect(() => {
    const isPinned = pinTop != null && pinLeft != null;
    if (isPinned) {
      if (!wasPinnedRef.current) {
        prePinPositionRef.current = positionRef.current;
      }
      wasPinnedRef.current = true;
      setPosition({ top: pinTop, left: pinLeft });
      return;
    }
    if (wasPinnedRef.current) {
      wasPinnedRef.current = false;
      const restored = prePinPositionRef.current;
      prePinPositionRef.current = null;
      if (restored) {
        movedRef.current = true;
        const applyRestored = () => {
          if (viewport || restored.left != null) {
            setPosition(
              clampToViewport({
                top: restored.top,
                left: restored.left ?? 0,
              })
            );
          } else {
            setPosition(restored);
          }
        };
        applyRestored();
        // 펼침 폭·높이 반영 후 화면 밖 클램프
        const raf = requestAnimationFrame(applyRestored);
        return () => cancelAnimationFrame(raf);
      }
    }
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
  }, [anchorTop, anchorH, useLeft, viewport, clampToViewport, pinTop, pinLeft]);

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
  // 최소화 독 — pin 좌표를 스타일에 직접 반영(패널 폭 변경 시 effect 지연 없이 이동)
  const isPinned = pinTop != null && pinLeft != null
  const renderTop = isPinned ? pinTop : position.top
  const renderLeft = isPinned ? pinLeft : position.left

  const panel = (
    <div
      ref={setRootRef}
      onPointerDownCapture={bringToFront}
      className={cn(
        'flex flex-col overflow-hidden pointer-events-auto',
        isMapFloat
          ? // 우측 패널 surface와 동일 톤·radius. opacity-90은 센터마크가 비치므로 플로팅은 불투명
            'standard-map-float-surface !opacity-100'
          : 'rounded-xl border border-border bg-card/95 shadow-2xl backdrop-blur-md',
        zClass,
        className
      )}
      style={{
        position: viewport ? 'fixed' : 'absolute',
        top: renderTop,
        ...(viewport || useLeft || isPinned
          ? { left: renderLeft }
          : { right: position.right }),
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
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('button, select, input, a')) return
          onHeaderDoubleClick?.()
        }}
        className={cn(
          'flex shrink-0 items-center justify-between select-none',
          isMapFloat
            ? cn(
                'standard-map-float-header',
                pinPosition
                  ? 'cursor-pointer'
                  : 'cursor-grab active:cursor-grabbing'
              )
            : cn(
                'bg-muted/40 hover:bg-muted/60',
                pinPosition
                  ? 'cursor-pointer border-b-0 px-2 py-1'
                  : 'cursor-grab border-b border-border/60 px-3 py-1.5 active:cursor-grabbing'
              )
        )}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') e.preventDefault();
        }}
      >
        {header}
      </div>
      {/* 최소화(pin) 시 본문 숨김(마운트 유지) — 높이·클릭은 헤더만 */}
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          pinPosition && 'pointer-events-none hidden h-0 max-h-0 overflow-hidden !flex-none'
        )}
        aria-hidden={Boolean(pinPosition)}
      >
        {children}
      </div>
    </div>
  );

  if (!viewport) return panel;
  if (typeof document === 'undefined') return null;
  return createPortal(panel, document.body);
}
