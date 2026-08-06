'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ListChevronsUpDown, UnfoldHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  MAP_SPLIT_ANIM_MS,
  MAP_SPLIT_CONTROL_BTN_GAP_PX,
  MAP_SPLIT_CONTROL_BTN_PX,
  MAP_SPLIT_CONTROL_EDGE_SHAKE_MS,
  MAP_SPLIT_CONTROL_OFFSET_MAX,
  MAP_SPLIT_CONTROL_OFFSET_MIN,
  MAP_SPLIT_CONTROL_RIGHT_EXTEND_PX,
  MAP_SPLIT_CONTROL_RIGHT_MENU_RESERVE_PX,
  type MapSplitOrientation,
} from './mapSplitTypes';
import { MAP_SPLIT_GUTTER_ICON_COLOR } from './mapSplitGutterIconColor';
import './mapSplitControl.css';

const PILL_DRAG_TITLE = '버튼 위치 조절';
const ANCHOR_SWITCH_RATIO = 0.71;
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
  children,
}: {
  title: string;
  active: boolean;
  iconActiveColor: string;
  iconInactiveColor?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      className={cn(
        'flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors',
        'bg-slate-800/90 hover:bg-slate-700'
      )}
      style={{ color: active ? iconActiveColor : iconInactiveColor }}
      onClick={onClick}
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

function computeOffsetBounds(
  gutterEl: HTMLElement | null,
  pillSize: { width: number; height: number },
  isHorizontal: boolean
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
    const half = pillSize.height / 2;
    const edge = Math.min(0.45, Math.max(MAP_SPLIT_CONTROL_OFFSET_MIN, half / travel));
    return {
      min: edge,
      max: 1 - edge,
      baseMax: 1 - edge,
    };
  }

  const pillFull = pillSize.width;
  const pillHalf = pillFull / 2;
  const menuLeft = window.innerWidth - MAP_SPLIT_CONTROL_RIGHT_MENU_RESERVE_PX;
  const edgeByHalf = pillHalf / travel;
  const min = Math.min(0.45, Math.max(MAP_SPLIT_CONTROL_OFFSET_MIN, edgeByHalf));

  const maxForLeftAnchor = (menuLeft - rect.left - pillFull) / travel;
  const maxForRightAnchor = (menuLeft - rect.left - Math.min(pillHalf, 8)) / travel;
  const byGutter = (travel - MAP_SPLIT_CONTROL_RIGHT_MENU_RESERVE_PX - pillFull) / travel;
  const baseRaw = Math.min(maxForLeftAnchor, byGutter, MAP_SPLIT_CONTROL_OFFSET_MAX);
  const baseMax = Math.max(min, Math.min(MAP_SPLIT_CONTROL_OFFSET_MAX, baseRaw));
  const extendRatio = MAP_SPLIT_CONTROL_RIGHT_EXTEND_PX / travel;
  const extendedMax = Math.max(
    min,
    Math.min(
      MAP_SPLIT_CONTROL_OFFSET_MAX,
      Math.min(maxForRightAnchor, baseMax + extendRatio)
    )
  );

  return { min, max: extendedMax, baseMax };
}

/**
 * 분할 실선 + 컨트롤 pill(분할선 따라 이동 가능).
 * 실선 드래그 = 비율 변경(잠금 시 무시). pill 배경 드래그 = pill 위치.
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
}: MapSplitterGutterProps) {
  const isHorizontal = orientation === 'horizontal';
  /** 좌우 분할 → 세로 거터 → 버튼 세로 나열 / 상하 분할 → 가로 나열 */
  const stackAlongGutter = isHorizontal;
  const offsetMoveEnabled = controlOffsetDraggable && Boolean(onControlOffsetRatioChange);
  const effectiveOffsetRatio = offsetMoveEnabled ? controlOffsetRatio : 0.5;
  const gutterRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const offsetDragRef = useRef(false);
  const dragRatioRef = useRef<number | null>(null);
  const boundsRef = useRef<OffsetBounds>({
    min: MAP_SPLIT_CONTROL_OFFSET_MIN,
    max: MAP_SPLIT_CONTROL_OFFSET_MAX,
    baseMax: MAP_SPLIT_CONTROL_OFFSET_MAX,
  });
  const edgeLatchRef = useRef<'min' | 'max' | null>(null);
  const onOffsetChangeRef = useRef(onControlOffsetRatioChange);
  onOffsetChangeRef.current = onControlOffsetRatioChange;

  const resolvedControls =
    !controls ? [] : typeof controls === 'function' ? controls(orientation) : controls;
  const pinnedControls = resolvedControls.filter(isPinnedOutsideCollapse);
  const foldableControls = resolvedControls.filter((c) => !isPinnedOutsideCollapse(c));
  /** 닫기·분할선 이동(잠금) 제외 나머지가 1개 이상이면 접기 */
  const canCollapse = foldableControls.length >= 1;
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
  const [edgeShake, setEdgeShake] = useState(false);
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const animMs = MAP_SPLIT_ANIM_MS;
  const isOffsetDragging = dragOffsetRatio != null;

  const triggerEdgeShake = (edge: 'min' | 'max') => {
    if (edgeLatchRef.current === edge) return;
    edgeLatchRef.current = edge;
    setEdgeShake(false);
    requestAnimationFrame(() => setEdgeShake(true));
    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = setTimeout(() => {
      setEdgeShake(false);
      shakeTimerRef.current = null;
    }, MAP_SPLIT_CONTROL_EDGE_SHAKE_MS);
  };

  const refreshBounds = () => {
    const measured = pillRef.current?.getBoundingClientRect();
    const pillSize =
      measured && measured.width > 0 && measured.height > 0
        ? { width: measured.width, height: measured.height }
        : estimatedPill;
    const next = computeOffsetBounds(gutterRef.current, pillSize, isHorizontal);
    boundsRef.current = next;
    setBounds(next);
  };

  useEffect(() => {
    refreshBounds();
    const gutter = gutterRef.current;
    const pill = pillRef.current;
    if (!gutter) return;
    const ro = new ResizeObserver(() => refreshBounds());
    ro.observe(gutter);
    if (pill) ro.observe(pill);
    window.addEventListener('resize', refreshBounds);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', refreshBounds);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buttonCount/expanded로 재측정
  }, [isHorizontal, buttonCount, hasExtraControls, controlsExpanded]);

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
      if (!offsetDragRef.current) return;
      const el = gutterRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const size = isHorizontal ? rect.height : rect.width;
      if (size <= 0) return;
      const start = isHorizontal ? rect.top : rect.left;
      const pos = isHorizontal ? e.clientY : e.clientX;
      const raw = (pos - start) / size;
      const { min, max } = boundsRef.current;
      const next = clamp(raw, min, max);
      if (raw < min) triggerEdgeShake('min');
      else if (raw > max) triggerEdgeShake('max');
      else edgeLatchRef.current = null;
      dragRatioRef.current = next;
      setDragOffsetRatio(next);
    };
    const onUp = () => {
      if (!offsetDragRef.current) return;
      offsetDragRef.current = false;
      edgeLatchRef.current = null;
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
  }, [isHorizontal, offsetMoveEnabled]);

  useEffect(() => {
    return () => {
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    };
  }, []);

  const clampedOffset = clamp(
    offsetMoveEnabled ? (dragOffsetRatio ?? effectiveOffsetRatio) : 0.5,
    offsetMoveEnabled ? bounds.min : 0.5,
    offsetMoveEnabled ? bounds.max : 0.5
  );
  const offsetPercent = `${clampedOffset * 100}%`;
  const oppositePercent = `${(1 - clampedOffset) * 100}%`;
  const useOppositeAnchor = isHorizontal
    ? clampedOffset > ANCHOR_SWITCH_RATIO
    : clampedOffset > bounds.baseMax || clampedOffset > ANCHOR_SWITCH_RATIO;

  /** 좌우 분할(가로 배치) → 좌우 진동, 상하 분할 → 세로 진동 */
  const shakeAxisClass = isHorizontal
    ? 'map-split-control-shake-x'
    : 'map-split-control-shake-y';

  const stackClass = stackAlongGutter
    ? 'flex flex-col items-center'
    : 'flex flex-row items-center';

  const toggleExpand = () => {
    onControlsExpandedChange?.(!controlsExpanded);
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
        'relative z-[5] shrink-0',
        isHorizontal ? 'w-[3px] self-stretch' : 'h-[3px] w-full self-center'
      )}
      role="separator"
      aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
    >
      {/* 실선만 비율 조절 커서·툴팁·드래그 — 컨트롤러와 분리 */}
      <div
        aria-hidden
        title={ratioTitle}
        className={cn(
          'absolute z-0 bg-slate-500 dark:bg-muted/60',
          ratioCursor,
          isHorizontal
            ? cn(
                'inset-y-0 left-1/2 w-[3px] -translate-x-1/2',
                !ratioLocked && 'hover:w-2 hover:bg-slate-400 dark:hover:bg-muted/80'
              )
            : cn(
                'inset-x-0 top-1/2 h-[3px] -translate-y-1/2',
                !ratioLocked && 'hover:h-2 hover:bg-slate-400 dark:hover:bg-muted/80'
              )
        )}
        onPointerEnter={() => {
          if (!ratioLocked) onRatioDragApproach?.();
        }}
        onPointerDown={(e) => {
          if (ratioLocked) return;
          e.preventDefault();
          onDragStart(isHorizontal ? e.clientX : e.clientY);
        }}
      />
      <div
        ref={pillRef}
        data-split-controls
        data-split-control-drag={offsetMoveEnabled ? 'true' : undefined}
        title={offsetMoveEnabled ? PILL_DRAG_TITLE : undefined}
        className={cn(
          'absolute z-[1] rounded-full bg-slate-800 shadow-md',
          'opacity-95 transition-opacity hover:opacity-100',
          'dark:bg-slate-900 dark:shadow-black/40',
          hasExtraControls ? 'p-1.5' : 'p-0.5',
          /* 부모/실선 리사이즈 커서가 컨트롤러로 새지 않게 */
          offsetMoveEnabled ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
        )}
        style={{
          ...(isHorizontal
            ? useOppositeAnchor
              ? {
                  bottom: oppositePercent,
                  left: '50%',
                  transform: 'translate(-50%, 50%)',
                }
              : {
                  top: offsetPercent,
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                }
            : useOppositeAnchor
              ? { right: oppositePercent, top: '50%', transform: 'translate(0, -50%)' }
              : { left: offsetPercent, top: '50%', transform: 'translate(0, -50%)' }),
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          if ((e.target as HTMLElement).closest('button')) return;
          if (!offsetMoveEnabled) return;
          e.preventDefault();
          const { min, max } = boundsRef.current;
          const startRatio = clamp(effectiveOffsetRatio, min, max);
          offsetDragRef.current = true;
          edgeLatchRef.current = null;
          dragRatioRef.current = startRatio;
          setDragOffsetRatio(startRatio);
        }}
      >
        <div className={cn('inline-grid items-center', edgeShake && shakeAxisClass)}>
          <div className={cn('col-start-1 row-start-1', stackClass, 'gap-1')}>
            {canCollapse ? (
              <MapSplitControlButton
                title={controlsExpanded ? '컨트롤 접기' : '컨트롤 펼치기'}
                active={false}
                iconActiveColor={MAP_SPLIT_GUTTER_ICON_COLOR.expandToggle.active}
                iconInactiveColor={MAP_SPLIT_GUTTER_ICON_COLOR.expandToggle.inactive}
                onClick={toggleExpand}
              >
                <ListChevronsUpDown className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              </MapSplitControlButton>
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
