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
import { captureRoadviewFrame } from '../../_mapContents/streetView/captureRoadviewFrame';

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
  const stretchRafRef = useRef(0);
  /** 드래그 시작 시 보조칸 콘텐츠 픽셀 크기 — CSS scale로 잡아당김 */
  const stretchBaseRef = useRef<{ w: number; h: number } | null>(null);
  /** host 스냅샷 모드이면 true — content 전체가 아닌 오버레이만 scale */
  const stretchSnapshotRef = useRef<{
    wrap: HTMLDivElement;
    objectUrl: string | null;
    host: HTMLElement;
    panelRoot: HTMLElement | null;
  } | null>(null);
  /** 드래그 전에 미리 캡처 — 드래그 시작 시점에는 scrape 하지 않음 */
  const roadviewSnapCacheRef = useRef<{ url: string; w: number; h: number } | null>(null);
  const snapRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const splitActiveRef = useRef(splitActive);
  splitActiveRef.current = splitActive;
  const onSizeTickRef = useRef(onSizeTick);
  onSizeTickRef.current = onSizeTick;
  const primaryPaneRef = useRef<HTMLDivElement>(null);
  const secondaryPaneRef = useRef<HTMLDivElement>(null);
  const secondaryContentRef = useRef<HTMLDivElement>(null);
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

  const syncRoadviewLayout = useCallback(() => {
    const host = secondaryContentRef.current?.querySelector('[data-roadview-host]');
    host?.dispatchEvent(new Event('roadview-relayout'));
  }, []);

  const clearRoadviewSnapCache = useCallback(() => {
    roadviewSnapCacheRef.current = null;
  }, []);

  const refreshRoadviewSnapCache = useCallback(() => {
    if (draggingRef.current || !splitActiveRef.current) return;
    const content = secondaryContentRef.current;
    const host = content?.querySelector('[data-roadview-host]') as HTMLElement | null;
    if (!host || host.clientWidth <= 0 || host.clientHeight <= 0) return;
    const canvas = host.querySelector('canvas');
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) return;
    const frame = captureRoadviewFrame(host);
    if (frame) roadviewSnapCacheRef.current = frame;
  }, []);

  const scheduleRoadviewSnapRefresh = useCallback(
    (delayMs = 200) => {
      if (!splitActiveRef.current || draggingRef.current) return;
      if (snapRefreshTimerRef.current) clearTimeout(snapRefreshTimerRef.current);
      snapRefreshTimerRef.current = setTimeout(() => {
        snapRefreshTimerRef.current = null;
        refreshRoadviewSnapCache();
      }, delayMs);
    },
    [refreshRoadviewSnapCache]
  );

  const pickRoadviewSnapFrame = useCallback(
    (host: HTMLElement | null) => {
      const cache = roadviewSnapCacheRef.current;
      if (cache && host) {
        const dw = Math.abs(cache.w - host.clientWidth);
        const dh = Math.abs(cache.h - host.clientHeight);
        if (dw <= 2 && dh <= 2) return cache;
      }
      return null;
    },
    []
  );

  const updateSecondaryStretch = useCallback(() => {
    const base = stretchBaseRef.current;
    const pane = secondaryPaneRef.current;
    const content = secondaryContentRef.current;
    if (!base || !pane) return;
    const pw = pane.clientWidth;
    const ph = pane.clientHeight;
    if (pw <= 0 || ph <= 0 || base.w <= 0 || base.h <= 0) return;
    const sx = pw / base.w;
    const sy = ph / base.h;
    const snap = stretchSnapshotRef.current;
    if (snap) {
      snap.wrap.style.transform = `scale(${sx}, ${sy})`;
      if (content) {
        content.style.boxSizing = 'border-box';
        content.style.width = `${pw}px`;
        content.style.height = `${ph}px`;
        content.style.flex = 'none';
      }
      if (snap.panelRoot) {
        snap.panelRoot.style.width = `${pw}px`;
        snap.panelRoot.style.height = `${ph}px`;
      }
      return;
    }
    if (content) content.style.transform = `scale(${sx}, ${sy})`;
  }, []);

  const scheduleStretch = useCallback(() => {
    if (stretchRafRef.current) return;
    stretchRafRef.current = requestAnimationFrame(() => {
      stretchRafRef.current = 0;
      updateSecondaryStretch();
    });
  }, [updateSecondaryStretch]);

  const beginSecondaryStretch = useCallback(() => {
    const pane = secondaryPaneRef.current;
    const content = secondaryContentRef.current;
    if (!pane || !content) return;
    const w = content.offsetWidth;
    const h = content.offsetHeight;
    if (w <= 0 || h <= 0) return;
    stretchBaseRef.current = { w, h };

    const host = content.querySelector('[data-roadview-host]') as HTMLElement | null;
    const frame = pickRoadviewSnapFrame(host) ?? null;

    if (host && frame) {
      stretchBaseRef.current = { w: frame.w, h: frame.h };
      const wrap = document.createElement('div');
      wrap.setAttribute('data-roadview-stretch-snap', '');
      wrap.style.cssText = [
        'position:absolute',
        'left:0',
        'top:0',
        `width:${frame.w}px`,
        `height:${frame.h}px`,
        'overflow:hidden',
        'transform-origin:left top',
        'will-change:transform',
        'z-index:1',
        'pointer-events:none',
        'background:#888888',
      ].join(';');
      const img = document.createElement('img');
      img.src = frame.url;
      img.alt = '';
      img.draggable = false;
      img.style.cssText = 'display:block;width:100%;height:100%;object-fit:fill;';
      wrap.appendChild(img);
      content.style.position = 'relative';
      content.insertBefore(wrap, content.firstChild);
      host.style.visibility = 'hidden';
      // 스냅샷(z-1) 위에 로드뷰 패널·컨트롤(z-3) 유지 — 컨트롤은 스냅샷에 포함되지 않음
      content.style.background = 'transparent';
      const panelRoot = Array.from(content.children).find(
        (el) => !el.hasAttribute('data-roadview-stretch-snap')
      ) as HTMLElement | undefined;
      if (panelRoot) {
        panelRoot.dataset.stretchBg = panelRoot.style.background || '';
        panelRoot.style.background = 'transparent';
      }
      stretchSnapshotRef.current = { wrap, objectUrl: null, host, panelRoot: panelRoot ?? null };
      updateSecondaryStretch();
      return;
    }

    // 폴백: content 전체 CSS scale
    content.style.boxSizing = 'border-box';
    content.style.width = `${w}px`;
    content.style.height = `${h}px`;
    content.style.flex = 'none';
    content.style.transformOrigin = 'left top';
    content.style.willChange = 'transform';
    content.style.transform = 'scale(1, 1)';
    updateSecondaryStretch();
  }, [pickRoadviewSnapFrame, updateSecondaryStretch]);

  const endSecondaryStretch = useCallback(() => {
    const snap = stretchSnapshotRef.current;
    const content = secondaryContentRef.current;
    if (snap) {
      snap.host.style.visibility = '';
      snap.wrap.remove();
      if (snap.objectUrl) URL.revokeObjectURL(snap.objectUrl);
      stretchSnapshotRef.current = null;
      if (content) {
        if (snap.panelRoot) {
          snap.panelRoot.style.background = snap.panelRoot.dataset.stretchBg ?? '';
          snap.panelRoot.style.width = '';
          snap.panelRoot.style.height = '';
          delete snap.panelRoot.dataset.stretchBg;
        }
        content.style.background = '';
        content.style.position = '';
      }
    }
    stretchBaseRef.current = null;
    if (!content) return;
    content.style.boxSizing = '';
    content.style.width = '';
    content.style.height = '';
    content.style.flex = '';
    content.style.transformOrigin = '';
    content.style.willChange = '';
    content.style.transform = '';
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
      scheduleStretch();
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
      if (stretchRafRef.current) {
        cancelAnimationFrame(stretchRafRef.current);
        stretchRafRef.current = 0;
      }
      endSecondaryStretch();
      scheduleSizeTick(true);
      syncRoadviewLayout();
      requestAnimationFrame(() => {
        syncRoadviewLayout();
        scheduleRoadviewSnapRefresh(350);
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (stretchRafRef.current) {
        cancelAnimationFrame(stretchRafRef.current);
        stretchRafRef.current = 0;
      }
      endSecondaryStretch();
    };
  }, [
    setRatio,
    applyPaneFlex,
    scheduleSizeTick,
    scheduleStretch,
    endSecondaryStretch,
    syncRoadviewLayout,
    scheduleRoadviewSnapRefresh,
  ]);

  useEffect(() => {
    if (!splitActive) {
      clearRoadviewSnapCache();
      if (snapRefreshTimerRef.current) {
        clearTimeout(snapRefreshTimerRef.current);
        snapRefreshTimerRef.current = null;
      }
      return;
    }

    const content = secondaryContentRef.current;
    const pane = secondaryPaneRef.current;
    const host = content?.querySelector('[data-roadview-host]');
    if (!pane || !host) return;

    const onRelayout = () => scheduleRoadviewSnapRefresh(280);
    const ro = new ResizeObserver(() => {
      if (draggingRef.current) return;
      scheduleRoadviewSnapRefresh(320);
    });
    ro.observe(pane);
    host.addEventListener('roadview-relayout', onRelayout);

    return () => {
      ro.disconnect();
      host.removeEventListener('roadview-relayout', onRelayout);
      if (snapRefreshTimerRef.current) {
        clearTimeout(snapRefreshTimerRef.current);
        snapRefreshTimerRef.current = null;
      }
    };
  }, [splitActive, clearRoadviewSnapCache, scheduleRoadviewSnapRefresh]);

  useLayoutEffect(() => {
    if (!splitActive || draggingRef.current) return;
    scheduleRoadviewSnapRefresh(MAP_SPLIT_ANIM_MS + 80);
  }, [primaryRatio, splitActive, scheduleRoadviewSnapRefresh]);

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
            onRatioDragApproach={() => scheduleRoadviewSnapRefresh(0)}
            onDragStart={(clientPos) => {
              if (ratioLocked) return;
              if (!roadviewSnapCacheRef.current) refreshRoadviewSnapCache();
              draggingRef.current = true;
              dragRef.current = { startPos: clientPos, startRatio: primaryRatio };
              beginSecondaryStretch();
            }}
          />
        )}

        <div
          ref={secondaryPaneRef}
          className={cn(
            'relative min-h-0 min-w-0 overflow-hidden bg-[#888888]',
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
          {splitActive ? (
            <div ref={secondaryContentRef} className="h-full w-full min-h-0 min-w-0">
              {secondary}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
