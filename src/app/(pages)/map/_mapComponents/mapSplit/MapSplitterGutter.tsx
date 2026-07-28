'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Lock, LockOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  MAP_SPLIT_ANIM_MS,
  MAP_SPLIT_CONTROL_OFFSET_MAX,
  MAP_SPLIT_CONTROL_OFFSET_MIN,
  MAP_SPLIT_CONTROL_PILL_EXPANDED_WIDTH_PX,
  MAP_SPLIT_CONTROL_RIGHT_EXTEND_PX,
  MAP_SPLIT_CONTROL_RIGHT_MENU_RESERVE_PX,
  MAP_SPLIT_CONTROL_VERTICAL_MAX_RATIO,
  type MapSplitOrientation,
} from './mapSplitTypes';

const PILL_DRAG_TITLE = '버튼 위치 조절';
const ANCHOR_SWITCH_RATIO = 0.71;

type MapSplitterGutterProps = {
  orientation: MapSplitOrientation;
  controls?: MapSplitControlItem[] | ((orientation: MapSplitOrientation) => MapSplitControlItem[]);
  ratioLocked: boolean;
  onRatioLockedChange: (locked: boolean) => void;
  onDragStart: (clientPos: number) => void;
  controlOffsetRatio?: number;
  onControlOffsetRatioChange?: (ratio: number) => void;
  /** false면 Lock·기능 버튼 숨기고 controls(펼치기)만 */
  controlsExpanded?: boolean;
};

export type MapSplitControlItem = {
  key: string;
  title: string;
  active: boolean;
  activeClassName: string;
  onClick: () => void;
  icon: ReactNode;
};

/** 공통: 어두운 원 + 아이콘 색만 활성 표시 (전부 파란 채우기 지양) */
export function MapSplitControlButton({
  title,
  active,
  activeClassName,
  onClick,
  children,
}: {
  title: string;
  active: boolean;
  /** 활성 시 아이콘 색 (예: text-blue-400, text-amber-300) */
  activeClassName: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      className={cn(
        'flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors',
        'bg-slate-700/90 hover:bg-slate-600',
        active ? activeClassName : 'text-slate-400'
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function clampOffsetRatio(r: number, max = MAP_SPLIT_CONTROL_OFFSET_MAX) {
  return Math.min(max, Math.max(MAP_SPLIT_CONTROL_OFFSET_MIN, r));
}

function resolveControls(
  controls: MapSplitterGutterProps['controls'],
  orientation: MapSplitOrientation
) {
  if (!controls) return [];
  return typeof controls === 'function' ? controls(orientation) : controls;
}

type VerticalOffsetMetrics = {
  baseMax: number;
  extendedMax: number;
};

function computeVerticalOffsetMetrics(gutterEl: HTMLElement | null): VerticalOffsetMetrics {
  if (!gutterEl) {
    return {
      baseMax: MAP_SPLIT_CONTROL_VERTICAL_MAX_RATIO,
      extendedMax: MAP_SPLIT_CONTROL_VERTICAL_MAX_RATIO,
    };
  }
  const rect = gutterEl.getBoundingClientRect();
  const w = rect.width;
  if (w <= 0) {
    return {
      baseMax: MAP_SPLIT_CONTROL_VERTICAL_MAX_RATIO,
      extendedMax: MAP_SPLIT_CONTROL_VERTICAL_MAX_RATIO,
    };
  }

  const pillFull = MAP_SPLIT_CONTROL_PILL_EXPANDED_WIDTH_PX;
  const menuLeft = window.innerWidth - MAP_SPLIT_CONTROL_RIGHT_MENU_RESERVE_PX;
  const maxForLeftAnchor = (menuLeft - rect.left - pillFull) / w;
  const maxForRightAnchor = (menuLeft - rect.left) / w;
  const byViewport = Math.min(maxForLeftAnchor, maxForRightAnchor);
  const byGutter = (w - MAP_SPLIT_CONTROL_RIGHT_MENU_RESERVE_PX - pillFull) / w;
  const baseRaw = Math.min(byViewport, byGutter);
  const baseMax = Math.min(
    MAP_SPLIT_CONTROL_VERTICAL_MAX_RATIO,
    Math.max(MAP_SPLIT_CONTROL_OFFSET_MIN, baseRaw)
  );
  const extendRatio = MAP_SPLIT_CONTROL_RIGHT_EXTEND_PX / w;
  const extendedRaw = baseMax + extendRatio;
  const extendedMax = Math.min(
    MAP_SPLIT_CONTROL_VERTICAL_MAX_RATIO,
    Math.max(MAP_SPLIT_CONTROL_OFFSET_MIN, Math.min(maxForRightAnchor, extendedRaw))
  );

  return { baseMax, extendedMax };
}

function computeOffsetMaxRatio(
  gutterEl: HTMLElement | null,
  isHorizontal: boolean
): number {
  if (isHorizontal) return MAP_SPLIT_CONTROL_OFFSET_MAX;
  return computeVerticalOffsetMetrics(gutterEl).extendedMax;
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
  controlOffsetRatio = 0.5,
  onControlOffsetRatioChange,
  controlsExpanded = true,
}: MapSplitterGutterProps) {
  const isHorizontal = orientation === 'horizontal';
  const gutterRef = useRef<HTMLDivElement>(null);
  const offsetDragRef = useRef(false);
  const offsetMaxRef = useRef(MAP_SPLIT_CONTROL_OFFSET_MAX);
  const offsetBaseMaxRef = useRef(MAP_SPLIT_CONTROL_OFFSET_MAX);
  const [offsetMax, setOffsetMax] = useState(MAP_SPLIT_CONTROL_OFFSET_MAX);
  const resolvedControls = resolveControls(controls, orientation);
  const hasExtraControls = resolvedControls.length > 0;
  const hasManyExtraControls = resolvedControls.length > 1;

  const animMs = MAP_SPLIT_ANIM_MS;

  useEffect(() => {
    const updateMax = () => {
      if (isHorizontal) {
        offsetMaxRef.current = MAP_SPLIT_CONTROL_OFFSET_MAX;
        offsetBaseMaxRef.current = MAP_SPLIT_CONTROL_OFFSET_MAX;
        setOffsetMax(MAP_SPLIT_CONTROL_OFFSET_MAX);
        return;
      }
      const metrics = computeVerticalOffsetMetrics(gutterRef.current);
      offsetBaseMaxRef.current = metrics.baseMax;
      offsetMaxRef.current = metrics.extendedMax;
      setOffsetMax(metrics.extendedMax);
    };
    updateMax();
    const el = gutterRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateMax);
    ro.observe(el);
    window.addEventListener('resize', updateMax);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateMax);
    };
  }, [isHorizontal]);

  useEffect(() => {
    if (isHorizontal || !onControlOffsetRatioChange) return;
    const max = computeOffsetMaxRatio(gutterRef.current, false);
    if (controlOffsetRatio > max) {
      onControlOffsetRatioChange(max);
    }
  }, [isHorizontal, controlOffsetRatio, onControlOffsetRatioChange, offsetMax]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!offsetDragRef.current || !onControlOffsetRatioChange) return;
      const el = gutterRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const size = isHorizontal ? rect.height : rect.width;
      if (size <= 0) return;
      const start = isHorizontal ? rect.top : rect.left;
      const pos = isHorizontal ? e.clientY : e.clientX;
      const max = offsetMaxRef.current;
      onControlOffsetRatioChange(clampOffsetRatio((pos - start) / size, max));
    };
    const onUp = () => {
      offsetDragRef.current = false;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [isHorizontal, onControlOffsetRatioChange]);

  const clampedOffset = clampOffsetRatio(controlOffsetRatio, offsetMax);
  const offsetPercent = `${clampedOffset * 100}%`;
  const oppositePercent = `${(1 - clampedOffset) * 100}%`;
  const useOppositeAnchor = isHorizontal
    ? clampedOffset > ANCHOR_SWITCH_RATIO
    : clampedOffset > offsetBaseMaxRef.current || clampedOffset > ANCHOR_SWITCH_RATIO;

  const expandOriginClass = useOppositeAnchor ? 'origin-right' : 'origin-left';

  const expandedPanelClass = cn(
    'flex flex-row items-center gap-1 overflow-hidden ease-out max-w-0 opacity-0',
    expandOriginClass,
    controlsExpanded && hasManyExtraControls && 'max-w-40 opacity-100'
  );

  const collapsedPanelClass = cn(
    'flex flex-row items-center overflow-hidden ease-out max-w-0 opacity-0',
    expandOriginClass,
    !controlsExpanded && hasManyExtraControls && 'max-w-10 opacity-100'
  );

  return (
    <div
      ref={gutterRef}
      className={cn(
        'relative z-[5] shrink-0 bg-slate-500 dark:bg-slate-600',
        isHorizontal ? 'w-[3px] self-stretch' : 'h-[3px] w-full self-center',
        ratioLocked
          ? 'cursor-default'
          : isHorizontal
            ? 'cursor-col-resize hover:bg-slate-400 dark:hover:bg-slate-500'
            : 'cursor-row-resize hover:bg-slate-400 dark:hover:bg-slate-500'
      )}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('[data-split-controls]')) return;
        if (ratioLocked) return;
        e.preventDefault();
        onDragStart(isHorizontal ? e.clientX : e.clientY);
      }}
      role="separator"
      aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
      title={ratioLocked ? '분할 비율 고정됨' : '분할 비율 조절'}
    >
      <div
        data-split-controls
        data-split-control-drag={onControlOffsetRatioChange ? 'true' : undefined}
        title={onControlOffsetRatioChange ? PILL_DRAG_TITLE : undefined}
        className={cn(
          'absolute rounded-full bg-slate-700 shadow-md',
          'dark:bg-slate-800 dark:shadow-black/40',
          hasExtraControls ? 'p-1.5' : 'p-0.5',
          onControlOffsetRatioChange && 'cursor-grab active:cursor-grabbing'
        )}
        style={{
          transitionDuration: `${animMs}ms`,
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
          if (!onControlOffsetRatioChange) return;
          offsetDragRef.current = true;
        }}
      >
        <div className="inline-grid items-center">
          <div
            className={cn(
              'col-start-1 row-start-1 flex flex-row items-center',
              hasExtraControls && 'gap-1'
            )}
          >
            <MapSplitControlButton
              title={ratioLocked ? '비율 고정 해제' : '비율 고정'}
              active={ratioLocked}
              activeClassName="text-blue-400"
              onClick={() => onRatioLockedChange(!ratioLocked)}
            >
              {ratioLocked ? (
                <Lock className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              ) : (
                <LockOpen className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              )}
            </MapSplitControlButton>
            <div
              className={expandedPanelClass}
              style={{ transitionDuration: `${animMs}ms` }}
              aria-hidden={!controlsExpanded || !hasManyExtraControls}
            >
              {controlsExpanded
                ? resolvedControls.map((item) => (
                    <MapSplitControlButton
                      key={item.key}
                      title={item.title}
                      active={item.active}
                      activeClassName={item.activeClassName}
                      onClick={item.onClick}
                    >
                      {item.icon}
                    </MapSplitControlButton>
                  ))
                : null}
            </div>
            {hasManyExtraControls ? (
              <div
                className={collapsedPanelClass}
                style={{ transitionDuration: `${animMs}ms` }}
                aria-hidden={controlsExpanded || !hasManyExtraControls}
              >
                {!controlsExpanded
                  ? resolvedControls.map((item) => (
                      <MapSplitControlButton
                        key={item.key}
                        title={item.title}
                        active={item.active}
                        activeClassName={item.activeClassName}
                        onClick={item.onClick}
                      >
                        {item.icon}
                      </MapSplitControlButton>
                    ))
                  : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
