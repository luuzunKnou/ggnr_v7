'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ListChevronsUpDown, UnfoldHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  MAP_SPLIT_ANIM_MS,
  MAP_SPLIT_CONTROL_BTN_GAP_PX,
  MAP_SPLIT_CONTROL_BTN_PX,
  MAP_SPLIT_CONTROL_OFFSET_MAX,
  MAP_SPLIT_CONTROL_OFFSET_MIN,
  MAP_SPLIT_CONTROL_RIGHT_MENU_RESERVE_PX,
  MAP_SPLIT_GUTTER_Z_INDEX,
  type MapSplitOrientation,
} from './mapSplitTypes';
import { MAP_SPLIT_GUTTER_ICON_COLOR } from './mapSplitGutterIconColor';
import './mapSplitControl.css';

const EXPAND_DRAG_TITLE_SUFFIX = '드래그로 위치 이동';
const EXPAND_DRAG_THRESHOLD_PX = 4;
/** lock 버튼 1개 + 기능 버튼 */
const LOCK_BUTTON_COUNT = 1;

type MapSplitterGutterProps = {
  orientation: MapSplitOrientation;
  controls?: MapSplitControlItem[] | ((orientation: MapSplitOrientation) => MapSplitControlItem[]);
  ratioLocked: boolean;
  onRatioLockedChange: (locked: boolean) => void;
  onDragStart: (clientPos: number) => void;
  /** 분할선에 포인터 진입 — 비율 드래그 직전 스냅샷 갱신용 */
  onRatioDragApproach?: () => void;
  controlOffsetRatio?: number;
  onControlOffsetRatioChange?: (ratio: number) => void;
  /** false면 pill 위치 드래그 비활성·가운데(0.5) 고정. 기본 false */
  controlOffsetDraggable?: boolean;
  /**
   * 기능 버튼 2개 이상일 때 펼침 여부.
   * false면 Lock + 펼치기만, true면 Lock + 기능 + 접기.
   */
  controlsExpanded?: boolean;
  onControlsExpandedChange?: (expanded: boolean) => void;
  /** 상하 분할 pill 가용 범위 — 좌측 패널·우측 확장 패널 제외 */
  mapPaddingLeft?: number;
  mapPaddingRight?: number;
};

export type MapSplitControlItem = {
  key: string;
  title: string;
  active: boolean;
  /** 활성 시 아이콘 색 (hex 등 CSS color) */
  iconActiveColor: string;
  /** 비활성 시 아이콘 색. 기본 slate-400 */
  iconInactiveColor?: string;
  onClick: () => void;
  icon: ReactNode;
  /**
   * true면 접기 영역 밖(잠금·접기 토글과 함께)에 항상 표시.
   * key가 exit/close 이면 기본 true.
   */
  pinOutsideCollapse?: boolean;
};

const DEFAULT_ICON_INACTIVE = '#94a3b8';

/** 종료·닫기 — 접기 밖 고정 */
function isPinnedOutsideCollapse(item: MapSplitControlItem): boolean {
  if (item.pinOutsideCollapse != null) return item.pinOutsideCollapse;
  return item.key === 'exit' || item.key === 'close';
}

function visibleControlButtonCount(opts: {
  foldableCount: number;
  pinnedCount: number;
  canCollapse: boolean;
  controlsExpanded: boolean;
}): number {
  const lock = LOCK_BUTTON_COUNT;
  const expand = opts.canCollapse ? 1 : 0;
  if (!opts.canCollapse) {
    return lock + opts.foldableCount + opts.pinnedCount;
  }
  if (opts.controlsExpanded) {
    return expand + lock + opts.foldableCount + opts.pinnedCount;
  }
  // 접힘: 펼치기 + 닫기(고정)만
  return expand + opts.pinnedCount;
}

/** 공통: 어두운 원 + 아이콘 색만 활성 표시 (전부 파란 채우기 지양) */
export function MapSplitControlButton({
  title,
  active,
  iconActiveColor,
  iconInactiveColor = DEFAULT_ICON_INACTIVE,
  onClick,
  onPointerDown,
  className,
  children,
}: {
  title: string;
  active: boolean;
  iconActiveColor: string;
  iconInactiveColor?: string;
  onClick: () => void;
  onPointerDown?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      className={cn(
        'flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors',
        'bg-slate-800/90 hover:bg-slate-700',
        className
      )}
      style={{ color: active ? iconActiveColor : iconInactiveColor }}
      onClick={onClick}
      onPointerDown={onPointerDown}
    >
      {children}
    </button>
  );
}

type OffsetBounds = {
  min: number;
  max: number;
  /** 상하 분할: 우측 앵커 전환 기준 (메뉴 침범 전) */
  baseMax: number;
};

/** stackAlongGutter: 좌우 분할(세로 거터)이면 버튼을 세로로 쌓음 */
function estimatePillSizePx(
  buttonCount: number,
  hasExtra: boolean,
  stackAlongGutter: boolean
) {
  const pad = hasExtra ? 6 : 2;
  const count = Math.max(1, buttonCount);
  const main =
    pad * 2 +
    count * MAP_SPLIT_CONTROL_BTN_PX +
    Math.max(0, count - 1) * MAP_SPLIT_CONTROL_BTN_GAP_PX;
  const cross = pad * 2 + MAP_SPLIT_CONTROL_BTN_PX;
  return stackAlongGutter
    ? { width: cross, height: main }
    : { width: main, height: cross };
}

function clamp(r: number, min: number, max: number) {
  return Math.min(max, Math.max(min, r));
}

/** 좌우 분할: pill 상단 / 상하 분할: pill 좌측(펼치기 버튼) */
function pillDragAnchorOnAxis(rect: DOMRect, isHorizontal: boolean) {
  return isHorizontal ? rect.top : rect.left;
}

function computeOffsetBounds(
  gutterEl: HTMLElement | null,
  pillSize: { width: number; height: number },
  isHorizontal: boolean,
  mapPaddingLeft: number,
  mapPaddingRight: number
): OffsetBounds {
  const fallback: OffsetBounds = {
    min: MAP_SPLIT_CONTROL_OFFSET_MIN,
    max: MAP_SPLIT_CONTROL_OFFSET_MAX,
    baseMax: MAP_SPLIT_CONTROL_OFFSET_MAX,
  };
  if (!gutterEl) return fallback;

  const rect = gutterEl.getBoundingClientRect();
  const travel = isHorizontal ? rect.height : rect.width;
  if (travel <= 0) return fallback;

  if (isHorizontal) {
    /** ratio = pill 상단. center [half/travel, 1−half/travel] 와 동일: top [0, 1−pill/travel] */
    const pillFull = pillSize.height;
    const maxRaw = (travel - pillFull) / travel;
    const max = Math.max(0, Math.min(1, maxRaw));
    return { min: 0, max, baseMax: max };
  }

  /** ratio = pill 좌측. 좌·우 패널(mapPadding) 안에서만 이동 */
  const pillFull = pillSize.width;
  const leftEdge = Math.max(0, mapPaddingLeft);
  const rightReserve = Math.max(
    MAP_SPLIT_CONTROL_RIGHT_MENU_RESERVE_PX,
    mapPaddingRight
  );

  const minRaw = (leftEdge - rect.left) / travel;
  const min = Math.max(0, minRaw);

  const maxRaw = (window.innerWidth - rightReserve - rect.left - pillFull) / travel;
  const max = Math.max(
    min,
    Math.min(MAP_SPLIT_CONTROL_OFFSET_MAX, Math.max(0, maxRaw))
  );
  return { min, max, baseMax: max };
}

/**
 * 분할 실선 + 컨트롤 pill.
 * 실선 드래그 = 비율 변경(잠금 시 무시). 펼치기 버튼 드래그 = pill 위치.
 */
export function MapSplitterGutter({
  orientation,
  controls,
  ratioLocked,
  onRatioLockedChange,
  onDragStart,
  onRatioDragApproach,
  controlOffsetRatio = 0.5,
  onControlOffsetRatioChange,
  controlOffsetDraggable = false,
  controlsExpanded = true,
  onControlsExpandedChange,
  mapPaddingLeft = 0,
  mapPaddingRight = MAP_SPLIT_CONTROL_RIGHT_MENU_RESERVE_PX,
}: MapSplitterGutterProps) {
  const isHorizontal = orientation === 'horizontal';
  /** 좌우 분할 → 세로 거터 → 버튼 세로 나열 / 상하 분할 → 가로 나열 */
  const stackAlongGutter = isHorizontal;
  const offsetMoveEnabled = controlOffsetDraggable && Boolean(onControlOffsetRatioChange);
  const effectiveOffsetRatio = offsetMoveEnabled ? controlOffsetRatio : 0.5;
  const gutterRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const offsetDragRef = useRef(false);
  const expandPointerRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    buttonEl: HTMLButtonElement;
  } | null>(null);
  /** 펼치기 버튼 드래그: 버튼 중심 − pill 앵커(좌우=상단). pointer − offset = 앵커 */
  const buttonDragPillOffsetRef = useRef<number | null>(null);
  const suppressExpandClickRef = useRef(false);
  const dragRatioRef = useRef<number | null>(null);
  const boundsRef = useRef<OffsetBounds>({
    min: MAP_SPLIT_CONTROL_OFFSET_MIN,
    max: MAP_SPLIT_CONTROL_OFFSET_MAX,
    baseMax: MAP_SPLIT_CONTROL_OFFSET_MAX,
  });
  const onOffsetChangeRef = useRef(onControlOffsetRatioChange);
  onOffsetChangeRef.current = onControlOffsetRatioChange;

  const resolvedControls =
    !controls ? [] : typeof controls === 'function' ? controls(orientation) : controls;
  const pinnedControls = resolvedControls.filter(isPinnedOutsideCollapse);
  const foldableControls = resolvedControls.filter((c) => !isPinnedOutsideCollapse(c));
  /** foldable 1개 이상, 또는 닫기만 있어도(거리뷰) 잠금·기능 접기 */
  const canCollapse = foldableControls.length >= 1 || resolvedControls.length > 0;
  const hasExtraControls = resolvedControls.length > 0 || canCollapse;
  const buttonCount = visibleControlButtonCount({
    foldableCount: foldableControls.length,
    pinnedCount: pinnedControls.length,
    canCollapse,
    controlsExpanded,
  });
  const estimatedPill = estimatePillSizePx(
    buttonCount,
    hasExtraControls,
    stackAlongGutter
  );

  const [bounds, setBounds] = useState<OffsetBounds>(boundsRef.current);
  const [dragOffsetRatio, setDragOffsetRatio] = useState<number | null>(null);
  const refreshBoundsRafRef = useRef(0);

  const animMs = MAP_SPLIT_ANIM_MS;
  const isOffsetDragging = dragOffsetRatio != null;

  const scheduleRefreshBounds = () => {
    if (refreshBoundsRafRef.current) return;
    refreshBoundsRafRef.current = requestAnimationFrame(() => {
      refreshBoundsRafRef.current = 0;
      refreshBounds();
    });
  };

  const mapPaddingLeftRef = useRef(mapPaddingLeft);
  const mapPaddingRightRef = useRef(mapPaddingRight);
  mapPaddingLeftRef.current = mapPaddingLeft;
  mapPaddingRightRef.current = mapPaddingRight;

  const refreshBounds = () => {
    const measured = pillRef.current?.getBoundingClientRect();
    const pillSize =
      measured && measured.width > 0 && measured.height > 0
        ? { width: measured.width, height: measured.height }
        : estimatedPill;
    const next = computeOffsetBounds(
      gutterRef.current,
      pillSize,
      isHorizontal,
      mapPaddingLeftRef.current,
      mapPaddingRightRef.current
    );
    const prev = boundsRef.current;
    boundsRef.current = next;
    if (
      prev.min !== next.min ||
      prev.max !== next.max ||
      prev.baseMax !== next.baseMax
    ) {
      setBounds(next);
    }
  };

  useEffect(() => {
    refreshBounds();
    const gutter = gutterRef.current;
    const pill = pillRef.current;
    if (!gutter) return;
    const ro = new ResizeObserver(() => scheduleRefreshBounds());
    ro.observe(gutter);
    if (pill) ro.observe(pill);
    window.addEventListener('resize', scheduleRefreshBounds);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', scheduleRefreshBounds);
      if (refreshBoundsRafRef.current) {
        cancelAnimationFrame(refreshBoundsRafRef.current);
        refreshBoundsRafRef.current = 0;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buttonCount/expanded·패딩으로 재측정
  }, [isHorizontal, buttonCount, hasExtraControls, controlsExpanded, mapPaddingLeft, mapPaddingRight]);

  useEffect(() => {
    if (!offsetMoveEnabled || isOffsetDragging) return;
    const { min, max } = boundsRef.current;
    const next = clamp(controlOffsetRatio, min, max);
    if (next !== controlOffsetRatio) onControlOffsetRatioChange?.(next);
  }, [
    controlOffsetRatio,
    onControlOffsetRatioChange,
    bounds,
    isOffsetDragging,
    offsetMoveEnabled,
  ]);

  useEffect(() => {
    if (!offsetMoveEnabled) {
      offsetDragRef.current = false;
      dragRatioRef.current = null;
      setDragOffsetRatio(null);
      return;
    }
    const onMove = (e: PointerEvent) => {
      const expandPtr = expandPointerRef.current;
      if (expandPtr && expandPtr.pointerId === e.pointerId && !offsetDragRef.current) {
        const dx = e.clientX - expandPtr.startX;
        const dy = e.clientY - expandPtr.startY;
        if (Math.hypot(dx, dy) >= EXPAND_DRAG_THRESHOLD_PX) {
          offsetDragRef.current = true;
          suppressExpandClickRef.current = true;
          const pill = pillRef.current;
          const btn = expandPtr.buttonEl;
          if (pill && btn) {
            const pillRect = pill.getBoundingClientRect();
            const btnRect = btn.getBoundingClientRect();
            const pillAnchor = pillDragAnchorOnAxis(pillRect, isHorizontal);
            const btnAnchor = isHorizontal
              ? btnRect.top + btnRect.height / 2
              : btnRect.left;
            buttonDragPillOffsetRef.current = btnAnchor - pillAnchor;
          } else {
            buttonDragPillOffsetRef.current = null;
          }
          const { min, max } = boundsRef.current;
          const gutterEl = gutterRef.current;
          if (gutterEl && buttonDragPillOffsetRef.current != null) {
            const rect = gutterEl.getBoundingClientRect();
            const size = isHorizontal ? rect.height : rect.width;
            if (size > 0) {
              const gutterStart = isHorizontal ? rect.top : rect.left;
              const pointerOnAxis = isHorizontal ? e.clientY : e.clientX;
              const pillAnchorOnAxis = pointerOnAxis - buttonDragPillOffsetRef.current;
              const startRatio = clamp((pillAnchorOnAxis - gutterStart) / size, min, max);
              dragRatioRef.current = startRatio;
              setDragOffsetRatio(startRatio);
            }
          } else {
            const startRatio = clamp(effectiveOffsetRatio, min, max);
            dragRatioRef.current = startRatio;
            setDragOffsetRatio(startRatio);
          }
        }
      }
      if (!offsetDragRef.current) return;
      const el = gutterRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const size = isHorizontal ? rect.height : rect.width;
      if (size <= 0) return;
      const start = isHorizontal ? rect.top : rect.left;
      const pointerOnAxis = isHorizontal ? e.clientY : e.clientX;
      const pillAnchorOnAxis =
        pointerOnAxis - (buttonDragPillOffsetRef.current ?? 0);
      const raw = (pillAnchorOnAxis - start) / size;
      const { min, max } = boundsRef.current;
      const next = clamp(raw, min, max);
      dragRatioRef.current = next;
      setDragOffsetRatio(next);
    };
    const onUp = (e: PointerEvent) => {
      const expandPtr = expandPointerRef.current;
      if (expandPtr && expandPtr.pointerId === e.pointerId) {
        try {
          expandPtr.buttonEl.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        expandPointerRef.current = null;
      }
      if (!offsetDragRef.current) return;
      offsetDragRef.current = false;
      buttonDragPillOffsetRef.current = null;
      const next = dragRatioRef.current;
      dragRatioRef.current = null;
      setDragOffsetRatio(null);
      if (next != null) onOffsetChangeRef.current?.(next);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [isHorizontal, offsetMoveEnabled, effectiveOffsetRatio]);

  useEffect(() => {
    if (!offsetMoveEnabled) {
      expandPointerRef.current = null;
      suppressExpandClickRef.current = false;
      buttonDragPillOffsetRef.current = null;
    }
  }, [offsetMoveEnabled]);

  const clampedOffset = clamp(
    offsetMoveEnabled ? (dragOffsetRatio ?? effectiveOffsetRatio) : 0.5,
    offsetMoveEnabled ? bounds.min : 0.5,
    offsetMoveEnabled ? bounds.max : 0.5
  );
  const offsetPercent = `${clampedOffset * 100}%`;

  /** pill 앵커 transform — 좌우: 상단, 상하: 좌측 */
  const pillTransform = isHorizontal ? 'translate(-50%, 0)' : 'translate(0, -50%)';

  const pillPositionStyle = isHorizontal
    ? { top: offsetPercent, left: '50%', transform: pillTransform }
    : { left: offsetPercent, top: '50%', transform: pillTransform };

  const stackClass = stackAlongGutter
    ? 'flex flex-col items-center'
    : 'flex flex-row items-center';

  const toggleExpand = () => {
    onControlsExpandedChange?.(!controlsExpanded);
  };

  const expandToggleTitle = controlsExpanded ? '컨트롤 접기' : '컨트롤 펼치기';
  const expandButtonTitle = offsetMoveEnabled
    ? `클릭: ${expandToggleTitle}\n드래그: ${EXPAND_DRAG_TITLE_SUFFIX}`
    : expandToggleTitle;

  const handleExpandPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!offsetMoveEnabled) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    expandPointerRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      buttonEl: e.currentTarget,
    };
  };

  const handleExpandClick = () => {
    if (suppressExpandClickRef.current) {
      suppressExpandClickRef.current = false;
      return;
    }
    toggleExpand();
  };

  const expandAnimClass = stackAlongGutter
    ? 'map-split-control-expand-y'
    : 'map-split-control-expand-x';

  const ratioTitle = ratioLocked ? '분할 비율 고정됨' : '분할 비율 조절';
  const ratioCursor = ratioLocked
    ? 'cursor-default'
    : isHorizontal
      ? 'cursor-col-resize'
      : 'cursor-row-resize';

  return (
    <div
      ref={gutterRef}
      className={cn(
        'pointer-events-none relative h-full w-full shrink-0',
      )}
      role="separator"
      aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
    >
      {/* 실선(표시만) — hit은 pill 아래 z-[5] 슬랫 */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute z-0 bg-slate-500 dark:bg-muted/60',
          isHorizontal
            ? 'inset-y-0 left-1/2 w-[3px] -translate-x-1/2'
            : 'inset-x-0 top-1/2 h-[3px] -translate-y-1/2'
        )}
      />
      {!ratioLocked ? (
        <div
          aria-hidden
          title={ratioTitle}
          className={cn(
            'pointer-events-auto absolute z-[1] bg-transparent',
            ratioCursor,
            isHorizontal
              ? 'inset-y-0 left-1/2 w-2 -translate-x-1/2'
              : 'inset-x-0 top-1/2 h-2 -translate-y-1/2'
          )}
          onPointerEnter={() => onRatioDragApproach?.()}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('[data-split-controls]')) return;
            e.preventDefault();
            e.stopPropagation();
            onDragStart(isHorizontal ? e.clientX : e.clientY);
          }}
        />
      ) : null}
      <div
        ref={pillRef}
        data-split-controls
        className={cn(
          'pointer-events-auto absolute isolate cursor-default rounded-full bg-slate-800 shadow-md',
          'opacity-95 transition-opacity hover:opacity-100',
          'dark:bg-slate-900 dark:shadow-black/40',
          hasExtraControls ? 'p-1.5' : 'p-0.5'
        )}
        style={{
          zIndex: MAP_SPLIT_GUTTER_Z_INDEX,
          ...pillPositionStyle,
        }}
      >
        <div className="inline-grid items-center">
          <div className={cn('col-start-1 row-start-1', stackClass, 'gap-1')}>
            {canCollapse ? (
              <div className="relative z-[1] shrink-0">
                <MapSplitControlButton
                  title={expandButtonTitle}
                  active={false}
                  iconActiveColor={MAP_SPLIT_GUTTER_ICON_COLOR.expandToggle.active}
                  iconInactiveColor={MAP_SPLIT_GUTTER_ICON_COLOR.expandToggle.inactive}
                  className={cn(
                    'relative z-[2]',
                    offsetMoveEnabled ? 'cursor-grab active:cursor-grabbing' : undefined
                  )}
                  onPointerDown={handleExpandPointerDown}
                  onClick={handleExpandClick}
                >
                  <ListChevronsUpDown className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                </MapSplitControlButton>
              </div>
            ) : null}

            {canCollapse ? (
              <div
                className={expandAnimClass}
                data-open={controlsExpanded ? 'true' : 'false'}
                style={{ transitionDuration: `${animMs}ms` }}
                aria-hidden={!controlsExpanded}
              >
                <div className="map-split-control-expand-inner">
                  <div className={cn(stackClass, 'gap-1')}>
                    <MapSplitControlButton
                      title={ratioLocked ? '분할선 이동 해제' : '분할선 이동 잠금'}
                      active={!ratioLocked}
                      iconActiveColor={MAP_SPLIT_GUTTER_ICON_COLOR.lock.active}
                      iconInactiveColor={MAP_SPLIT_GUTTER_ICON_COLOR.lock.inactive}
                      onClick={() => onRatioLockedChange(!ratioLocked)}
                    >
                      <UnfoldHorizontal className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                    </MapSplitControlButton>
                    {foldableControls.map((item) => (
                      <MapSplitControlButton
                        key={item.key}
                        title={item.title}
                        active={item.active}
                        iconActiveColor={item.iconActiveColor}
                        iconInactiveColor={item.iconInactiveColor}
                        onClick={item.onClick}
                      >
                        {item.icon}
                      </MapSplitControlButton>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <MapSplitControlButton
                  title={ratioLocked ? '분할선 이동 해제' : '분할선 이동 잠금'}
                  active={!ratioLocked}
                  iconActiveColor={MAP_SPLIT_GUTTER_ICON_COLOR.lock.active}
                  iconInactiveColor={MAP_SPLIT_GUTTER_ICON_COLOR.lock.inactive}
                  onClick={() => onRatioLockedChange(!ratioLocked)}
                >
                  <UnfoldHorizontal className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                </MapSplitControlButton>
                {foldableControls.map((item) => (
                  <MapSplitControlButton
                    key={item.key}
                    title={item.title}
                    active={item.active}
                    iconActiveColor={item.iconActiveColor}
                    iconInactiveColor={item.iconInactiveColor}
                    onClick={item.onClick}
                  >
                    {item.icon}
                  </MapSplitControlButton>
                ))}
              </>
            )}

            {pinnedControls.map((item) => (
              <MapSplitControlButton
                key={item.key}
                title={item.title}
                active={item.active}
                iconActiveColor={item.iconActiveColor}
                iconInactiveColor={item.iconInactiveColor}
                onClick={item.onClick}
              >
                {item.icon}
              </MapSplitControlButton>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
