'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';
import { MapSplitterGutter } from './MapSplitterGutter';
import {
  MAP_SPLIT_ANIM_MS,
  MAP_SPLIT_DEFAULT_PRIMARY_RATIO,
  MAP_SPLIT_MAX_RATIO,
  MAP_SPLIT_MIN_RATIO,
  MAP_SPLIT_VERTICAL_PRIMARY_RATIO,
  type MapSplitOrientation,
} from './mapSplitTypes';

type MapSplitLayoutProps = {
  splitActive: boolean;
  primary: ReactNode;
  secondary: ReactNode;
  gutterControls?: ReactNode | ((orientation: MapSplitOrientation) => ReactNode);
  primaryRatio?: number;
  onPrimaryRatioChange?: (ratio: number) => void;
  onSizeTick?: () => void;
  /** 좌측 사이드바·패널 폭(px) */
  mapPaddingLeft?: number;
  /** 좌우/상하 전환 알림 */
  onOrientationChange?: (orientation: MapSplitOrientation) => void;
  /** 분할선 컨트롤 pill 위치 (0~1) */
  controlOffsetRatio?: number;
  onControlOffsetRatioChange?: (ratio: number) => void;
  /** false면 pill 위치 드래그 비활성·가운데 고정. 기본 false */
  controlOffsetDraggable?: boolean;
  /** false면 Lock·기능 버튼 숨김 */
  controlsExpanded?: boolean;
};

function clampRatio(r: number) {
  return Math.min(MAP_SPLIT_MAX_RATIO, Math.max(MAP_SPLIT_MIN_RATIO, r));
}

/**
 * 좌우 분할: 좌측 메뉴·패널(mapPaddingLeft)을 제외한 가용 너비의 정중앙에 분할선.
 * primaryRatio = (containerW + paddingLeft) / (2 × containerW)
 */
function computeHorizontalPrimaryRatio(containerWidth: number, mapPaddingLeft: number) {
  if (containerWidth <= 0) return MAP_SPLIT_DEFAULT_PRIMARY_RATIO;
  return clampRatio((containerWidth + mapPaddingLeft) / (2 * containerWidth));
}

/**
 * 공통 지도 분할 셸.
 * 상하 분할 시 좌측 패널 폭만큼 비우고 남은 너비만 상·하로 나눈다.
 */
export function MapSplitLayout({
  splitActive,
  primary,
  secondary,
  gutterControls,
  primaryRatio: primaryRatioProp,
  onPrimaryRatioChange,
  onSizeTick,
  mapPaddingLeft = 0,
  onOrientationChange,
  controlOffsetRatio,
  onControlOffsetRatioChange,
  controlOffsetDraggable = false,
  controlsExpanded,
}: MapSplitLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [orientation, setOrientation] = useState<MapSplitOrientation>('horizontal');
  const [primaryRatio, setPrimaryRatio] = useState(
    primaryRatioProp ?? MAP_SPLIT_DEFAULT_PRIMARY_RATIO
  );
  const [animReady, setAnimReady] = useState(false);
  const [ratioLocked, setRatioLocked] = useState(false);
  const dragRef = useRef<{ startPos: number; startRatio: number } | null>(null);
  const draggingRef = useRef(false);
  const pendingRatioRef = useRef<number | null>(null);
  const sizeTickAtRef = useRef(0);
  const onSizeTickRef = useRef(onSizeTick);
  onSizeTickRef.current = onSizeTick;
  const primaryPaneRef = useRef<HTMLDivElement>(null);
  const secondaryPaneRef = useRef<HTMLDivElement>(null);
  const mapPaddingLeftRef = useRef(mapPaddingLeft);
  mapPaddingLeftRef.current = mapPaddingLeft;
  const orientationRef = useRef(orientation);
  orientationRef.current = orientation;
  const primaryRatioPropRef = useRef(primaryRatioProp);
  primaryRatioPropRef.current = primaryRatioProp;
  const onPrimaryRatioChangeRef = useRef(onPrimaryRatioChange);
  onPrimaryRatioChangeRef.current = onPrimaryRatioChange;
  const onOrientationChangeRef = useRef(onOrientationChange);
  onOrientationChangeRef.current = onOrientationChange;

  const applyHorizontalInitialRatio = useCallback(() => {
    if (primaryRatioPropRef.current != null) return;
    const el = containerRef.current;
    if (!el || orientationRef.current !== 'horizontal') return;
    const ratio = computeHorizontalPrimaryRatio(el.clientWidth, mapPaddingLeftRef.current);
    setPrimaryRatio(ratio);
    onPrimaryRatioChangeRef.current?.(ratio);
  }, []);

  useEffect(() => {
    if (primaryRatioProp != null) setPrimaryRatio(clampRatio(primaryRatioProp));
  }, [primaryRatioProp]);

  const setRatio = useCallback((r: number) => {
    const next = clampRatio(r);
    setPrimaryRatio(next);
    onPrimaryRatioChangeRef.current?.(next);
  }, []);

  const applyPaneFlex = useCallback((ratio: number) => {
    const next = clampRatio(ratio);
    const primary = primaryPaneRef.current;
    const secondary = secondaryPaneRef.current;
    if (primary) {
      primary.style.transitionDuration = '0ms';
      primary.style.flex = `${next} 1 0%`;
    }
    if (secondary) {
      secondary.style.transitionDuration = '0ms';
      secondary.style.flex = `${1 - next} 1 0%`;
    }
  }, []);

  const scheduleSizeTick = useCallback((force = false) => {
    const tick = onSizeTickRef.current;
    if (!tick) return;
    const now = performance.now();
    if (!force && now - sizeTickAtRef.current < 80) return;
    sizeTickAtRef.current = now;
    tick();
  }, []);

  // 분할 ON/OFF·방향·패딩 변경 시에만 애니메이션 구간 updateSize 루프
  useLayoutEffect(() => {
    if (!onSizeTick) return;
    if (draggingRef.current) return;
    onSizeTick();
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      if (draggingRef.current) return;
      onSizeTick();
      if (t - start < MAP_SPLIT_ANIM_MS + 40) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [splitActive, orientation, mapPaddingLeft, onSizeTick]);

  // 비율 변경(드래그 종료 등) 시 1회 size tick — 드래그 중 primaryRatio 연쇄 루프 방지
  useLayoutEffect(() => {
    if (!onSizeTick || draggingRef.current) return;
    scheduleSizeTick(true);
  }, [primaryRatio, onSizeTick, scheduleSizeTick]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const apply = () => {
      const usableW = Math.max(0, el.clientWidth - mapPaddingLeftRef.current);
      const next: MapSplitOrientation =
        usableW < window.innerWidth / 2 ? 'vertical' : 'horizontal';

      if (orientationRef.current !== next) {
        const ratio =
          next === 'vertical'
            ? MAP_SPLIT_VERTICAL_PRIMARY_RATIO
            : computeHorizontalPrimaryRatio(el.clientWidth, mapPaddingLeftRef.current);
        orientationRef.current = next;
        setOrientation(next);
        if (primaryRatioPropRef.current == null) {
          setPrimaryRatio(ratio);
          onPrimaryRatioChangeRef.current?.(ratio);
        }
        onOrientationChangeRef.current?.(next);
        return;
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    window.addEventListener('resize', apply);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, [mapPaddingLeft]);

  useEffect(() => {
    onOrientationChangeRef.current?.(orientation);
  }, [orientation]);

  useEffect(() => {
    if (!splitActive || orientation !== 'horizontal') return;
    applyHorizontalInitialRatio();
  }, [splitActive, orientation, applyHorizontalInitialRatio]);

  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      const el = containerRef.current;
      if (!drag || !el) return;
      const rect = el.getBoundingClientRect();
      const isH = orientationRef.current === 'horizontal';
      const size = isH ? rect.width : rect.height;
      if (size <= 0) return;
      const pos = isH ? e.clientX : e.clientY;
      const next = clampRatio(drag.startRatio + (pos - drag.startPos) / size);
      pendingRatioRef.current = next;
      applyPaneFlex(next);
      scheduleSizeTick(false);
    };
    const onUp = () => {
      if (!dragRef.current && !draggingRef.current) return;
      dragRef.current = null;
      draggingRef.current = false;
      const pending = pendingRatioRef.current;
      if (pending != null) {
        pendingRatioRef.current = null;
        setRatio(pending);
      }
      scheduleSizeTick(true);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [setRatio, applyPaneFlex, scheduleSizeTick]);

  const isH = orientation === 'horizontal';
  const primaryFlex = splitActive ? primaryRatio : 1;
  const secondaryFlex = splitActive ? 1 - primaryRatio : 0;
  const useLeftInset = splitActive && !isH && mapPaddingLeft > 0;

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full min-h-0 min-w-0 flex-row overflow-hidden"
    >
      {useLeftInset && (
        <div
          className="h-full shrink-0 pointer-events-none"
          style={{ width: mapPaddingLeft }}
          aria-hidden
        />
      )}

      <div
        className={cn(
          'relative flex min-h-0 min-w-0 flex-1 overflow-hidden',
          isH || !splitActive ? 'flex-row' : 'flex-col'
        )}
      >
        <div
          ref={primaryPaneRef}
          className={cn(
            'relative min-h-0 min-w-0 overflow-hidden',
            animReady && 'transition-[flex] ease-out'
          )}
          style={{
            flex: `${primaryFlex} 1 0%`,
            transitionDuration: animReady ? `${MAP_SPLIT_ANIM_MS}ms` : '0ms',
          }}
        >
          {primary}
        </div>

        {splitActive && (
          <MapSplitterGutter
            orientation={orientation}
            controls={gutterControls}
            ratioLocked={ratioLocked}
            onRatioLockedChange={setRatioLocked}
            controlOffsetRatio={controlOffsetDraggable ? controlOffsetRatio : 0.5}
            onControlOffsetRatioChange={
              controlOffsetDraggable ? onControlOffsetRatioChange : undefined
            }
            controlOffsetDraggable={controlOffsetDraggable}
            controlsExpanded={controlsExpanded}
            onDragStart={(clientPos) => {
              if (ratioLocked) return;
              draggingRef.current = true;
              dragRef.current = { startPos: clientPos, startRatio: primaryRatio };
            }}
          />
        )}

        <div
          ref={secondaryPaneRef}
          className={cn(
            'relative min-h-0 min-w-0 overflow-hidden',
            animReady && 'transition-[flex] ease-out',
            !splitActive && 'pointer-events-none'
          )}
          style={{
            flex: `${secondaryFlex} 1 0%`,
            transitionDuration: animReady ? `${MAP_SPLIT_ANIM_MS}ms` : '0ms',
            opacity: splitActive ? 1 : 0,
          }}
          aria-hidden={!splitActive}
        >
          {splitActive ? secondary : null}
        </div>
      </div>
    </div>
  );
}
