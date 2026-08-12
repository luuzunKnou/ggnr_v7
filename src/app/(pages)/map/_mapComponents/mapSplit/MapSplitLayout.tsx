'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { MapSplitControlItem } from './MapSplitterGutter';
import { cn } from '@/lib/utils';
import { MapSplitterGutter } from './MapSplitterGutter';
import {
  MAP_SPLIT_ANIM_MS,
  MAP_SPLIT_DEFAULT_PRIMARY_RATIO,
  MAP_SPLIT_GUTTER_HIT_CROSS_PX,
  MAP_SPLIT_GUTTER_Z_INDEX,
  MAP_SPLIT_CONTROL_RIGHT_MENU_RESERVE_PX,
  MAP_SPLIT_MAX_RATIO,
  MAP_SPLIT_MIN_RATIO,
  type MapSplitOrientation,
} from './mapSplitTypes';
type MapSplitLayoutProps = {
  splitActive: boolean;
  primary: ReactNode;
  secondary: ReactNode;
  gutterControls?: MapSplitControlItem[] | ((orientation: MapSplitOrientation) => MapSplitControlItem[]);
  primaryRatio?: number;
  onPrimaryRatioChange?: (ratio: number) => void;
  onSizeTick?: () => void;
  /** 좌측 사이드바·패널 폭(px) */
  mapPaddingLeft?: number;
  /** 우측 메뉴·확장 패널 폭(px) */
  mapPaddingRight?: number;
  /** 좌우/상하 전환 알림 */
  onOrientationChange?: (orientation: MapSplitOrientation) => void;
  /** 분할선 컨트롤 pill 위치 (0~1) */
  controlOffsetRatio?: number;
  onControlOffsetRatioChange?: (ratio: number) => void;
  /** false면 pill 위치 드래그 비활성·가운데 고정. 기본 false */
  controlOffsetDraggable?: boolean;
  /** false면 Lock·기능 버튼 숨김 */
  controlsExpanded?: boolean;
  onControlsExpandedChange?: (expanded: boolean) => void;
};

function clampRatio(r: number) {
  return Math.min(MAP_SPLIT_MAX_RATIO, Math.max(MAP_SPLIT_MIN_RATIO, r));
}

function queryRoadviewStage(content: HTMLElement | null): HTMLElement | null {
  return content?.querySelector('[data-roadview-stage]') as HTMLElement | null;
}

/**
 * 좌우 분할: 좌·우 패널(mapPaddingLeft·Right)을 제외한 가용 너비 기준 분할.
 * usableFraction 0.5 = 가용 영역 정중앙(보이는 지도 1:1).
 * primaryRatio = (padL + usableFraction × usable) / W
 */
function primaryRatioFromUsableFraction(
  containerWidth: number,
  mapPaddingLeft: number,
  mapPaddingRight: number,
  usableFraction: number
) {
  if (containerWidth <= 0) return MAP_SPLIT_DEFAULT_PRIMARY_RATIO;
  const padL = Math.max(0, Math.min(mapPaddingLeft, containerWidth));
  const padR = Math.max(0, Math.min(mapPaddingRight, containerWidth - padL));
  const usable = containerWidth - padL - padR;
  if (usable <= 0) return clampRatio(1);
  const f = Math.min(1, Math.max(0, usableFraction));
  return clampRatio((padL + f * usable) / containerWidth);
}

/** primary flex 비율 → 가용 영역 내 분할선 위치(0~1) */
function usableFractionFromPrimaryRatio(
  containerWidth: number,
  mapPaddingLeft: number,
  mapPaddingRight: number,
  primaryRatio: number
) {
  if (containerWidth <= 0) return 0.5;
  const padL = Math.max(0, Math.min(mapPaddingLeft, containerWidth));
  const padR = Math.max(0, Math.min(mapPaddingRight, containerWidth - padL));
  const usable = containerWidth - padL - padR;
  if (usable <= 0) return 0.5;
  const gutter = clampRatio(primaryRatio) * containerWidth;
  return Math.min(1, Math.max(0, (gutter - padL) / usable));
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
  mapPaddingRight = MAP_SPLIT_CONTROL_RIGHT_MENU_RESERVE_PX,
  onOrientationChange,
  controlOffsetRatio,
  onControlOffsetRatioChange,
  controlOffsetDraggable = false,
  controlsExpanded,
  onControlsExpandedChange,
}: MapSplitLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [orientation, setOrientation] = useState<MapSplitOrientation>('horizontal');
  const [primaryRatio, setPrimaryRatio] = useState(
    primaryRatioProp ?? MAP_SPLIT_DEFAULT_PRIMARY_RATIO
  );
  const [animReady, setAnimReady] = useState(false);
  const [ratioLocked, setRatioLocked] = useState(false);
  /** 분할선 드래그 중 — flexGrow transition 끄고 지도 updateSize 강제 */
  const [isRatioDragging, setIsRatioDragging] = useState(false);

  // 분할 ON 시 비율 잠금 해제(거터 «분할선 이동» 활성 기본)
  useEffect(() => {
    if (splitActive) setRatioLocked(false);
  }, [splitActive]);

  const dragRef = useRef<{ startPos: number; startRatio: number } | null>(null);
  const draggingRef = useRef(false);
  const pendingRatioRef = useRef<number | null>(null);
  const sizeTickAtRef = useRef(0);
  const stretchRafRef = useRef(0);
  /** 맞춤 대기 실패 시 덮개 해제 상한 */
  const layoutCoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stretchEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 손 뗀 직후 unlock 전 표시용 (동기 commit 중 플래그) */
  const stretchEndWaitRef = useRef(false);
  /** unlock 후 · 로드뷰 재생성(init) 대기 */
  const waitingRevealRef = useRef(false);
  /** 드래그 시작 시 stage 픽셀 크기 — CSS scale로 잡아당김 */
  const stretchBaseRef = useRef<{ w: number; h: number } | null>(null);
  const stretchStageRef = useRef<HTMLElement | null>(null);
  /** stage 위 시각 스냅샷(재생성 중 이전 화면 유지). 컨트롤은 stage 밖 */
  const layoutCoverRef = useRef<{
    wrap: HTMLDivElement;
    stageEl: HTMLElement;
  } | null>(null);
  const splitActiveRef = useRef(splitActive);
  splitActiveRef.current = splitActive;
  const onSizeTickRef = useRef(onSizeTick);
  onSizeTickRef.current = onSizeTick;
  const primaryPaneRef = useRef<HTMLDivElement>(null);
  const secondaryPaneRef = useRef<HTMLDivElement>(null);
  const secondaryContentRef = useRef<HTMLDivElement>(null);
  const mapPaddingLeftRef = useRef(mapPaddingLeft);
  mapPaddingLeftRef.current = mapPaddingLeft;
  const mapPaddingRightRef = useRef(mapPaddingRight);
  mapPaddingRightRef.current = mapPaddingRight;
  const orientationRef = useRef(orientation);
  orientationRef.current = orientation;
  const primaryRatioPropRef = useRef(primaryRatioProp);
  primaryRatioPropRef.current = primaryRatioProp;
  const onPrimaryRatioChangeRef = useRef(onPrimaryRatioChange);
  onPrimaryRatioChangeRef.current = onPrimaryRatioChange;
  const onOrientationChangeRef = useRef(onOrientationChange);
  onOrientationChangeRef.current = onOrientationChange;
  /** 가용 영역 기준 분할 위치(0.5 = 보이는 지도 1:1). 패널 폭 변동 시 유지 */
  const usableSplitFractionRef = useRef(0.5);
  const primaryRatioRef = useRef(primaryRatio);
  primaryRatioRef.current = primaryRatio;

  /**
   * 분할·로드뷰 OFF → 비율 초기화.
   * ON → 가용 영역 1:1(0.5)부터 시작 (이전 드래그 비율 유지 금지).
   */
  useLayoutEffect(() => {
    if (primaryRatioPropRef.current != null) return;

    if (!splitActive) {
      usableSplitFractionRef.current = 0.5;
      const next = MAP_SPLIT_DEFAULT_PRIMARY_RATIO;
      if (Math.abs(primaryRatioRef.current - next) > 1e-4) {
        primaryRatioRef.current = next;
        setPrimaryRatio(next);
        onPrimaryRatioChangeRef.current?.(next);
      }
      return;
    }

    usableSplitFractionRef.current = 0.5;
    const el = containerRef.current;
    const next =
      el && orientationRef.current === 'horizontal'
        ? primaryRatioFromUsableFraction(
            el.clientWidth,
            mapPaddingLeftRef.current,
            mapPaddingRightRef.current,
            0.5
          )
        : MAP_SPLIT_DEFAULT_PRIMARY_RATIO;
    primaryRatioRef.current = next;
    setPrimaryRatio(next);
    onPrimaryRatioChangeRef.current?.(next);
  }, [splitActive]);

  /** 가용 분율 → primaryRatio 반영 (패널·리사이즈 시). 드래그 중에는 스킵 */
  const syncHorizontalRatioFromUsable = useCallback(() => {
    if (primaryRatioPropRef.current != null) return;
    const el = containerRef.current;
    if (!el || !splitActiveRef.current) return;
    if (orientationRef.current !== 'horizontal') return;
    if (draggingRef.current) return;

    const next = primaryRatioFromUsableFraction(
      el.clientWidth,
      mapPaddingLeftRef.current,
      mapPaddingRightRef.current,
      usableSplitFractionRef.current
    );
    if (Math.abs(next - primaryRatioRef.current) < 1e-4) return;
    primaryRatioRef.current = next;
    setPrimaryRatio(next);
    onPrimaryRatioChangeRef.current?.(next);
  }, []);

  useEffect(() => {
    if (primaryRatioProp != null) setPrimaryRatio(clampRatio(primaryRatioProp));
  }, [primaryRatioProp]);

  const setRatio = useCallback((r: number) => {
    const next = clampRatio(r);
    const el = containerRef.current;
    if (el && orientationRef.current === 'horizontal') {
      usableSplitFractionRef.current = usableFractionFromPrimaryRatio(
        el.clientWidth,
        mapPaddingLeftRef.current,
        mapPaddingRightRef.current,
        next
      );
    } else if (el && orientationRef.current === 'vertical') {
      usableSplitFractionRef.current = next;
    }
    primaryRatioRef.current = next;
    setPrimaryRatio(next);
    onPrimaryRatioChangeRef.current?.(next);
  }, []);

  const clearPaneInlineFlex = useCallback(() => {
    for (const el of [primaryPaneRef.current, secondaryPaneRef.current]) {
      if (!el) continue;
      el.style.transition = '';
      el.style.transitionDuration = '';
      el.style.transitionProperty = '';
      // flex 값은 React style이 다시 적용. 여기서 비우면 다음 페인트 전 0폭이 됨.
    }
  }, []);

  const applyPaneFlex = useCallback((ratio: number) => {
    const next = clampRatio(ratio);
    const primary = primaryPaneRef.current;
    const secondary = secondaryPaneRef.current;
    if (primary) {
      primary.style.transition = 'none';
      primary.style.flex = `${next} 1 0%`;
    }
    if (secondary) {
      secondary.style.transition = 'none';
      secondary.style.flex = `${1 - next} 1 0%`;
    }
  }, []);

  const syncRoadviewLayout = useCallback(() => {
    const host = secondaryContentRef.current?.querySelector('[data-roadview-host]');
    host?.dispatchEvent(new Event('roadview-relayout'));
  }, []);

  /** 분할선 손 뗌: 로드뷰 teardown / mount (unlock 사이에 끼움) */
  const syncRoadviewRecreateTeardown = useCallback(() => {
    const host = secondaryContentRef.current?.querySelector('[data-roadview-host]');
    host?.dispatchEvent(new Event('roadview-recreate-teardown'));
  }, []);

  const syncRoadviewRecreateMount = useCallback(() => {
    const host = secondaryContentRef.current?.querySelector('[data-roadview-host]');
    host?.dispatchEvent(new Event('roadview-recreate-mount'));
  }, []);

  const cancelLayoutCoverTimer = useCallback(() => {
    if (layoutCoverTimerRef.current) {
      clearTimeout(layoutCoverTimerRef.current);
      layoutCoverTimerRef.current = null;
    }
  }, []);

  const cancelStretchEndTimer = useCallback(() => {
    if (stretchEndTimerRef.current) {
      clearTimeout(stretchEndTimerRef.current);
      stretchEndTimerRef.current = null;
    }
  }, []);

  const cancelRevealTimer = useCallback(() => {
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
  }, []);

  const endLayoutCover = useCallback(() => {
    cancelLayoutCoverTimer();
    const cover = layoutCoverRef.current;
    if (!cover) return;
    cover.wrap.remove();
    layoutCoverRef.current = null;
  }, [cancelLayoutCoverTimer]);

  /**
   * css-fill 상태의 stage 안 프레임을 복제해 덮개로 고정.
   * teardown 이후에도 이전 화면을 유지하고, init/ready 때 제거.
   */
  const beginFreezeSnapshot = useCallback(() => {
    const content = secondaryContentRef.current;
    const stageEl = stretchStageRef.current ?? queryRoadviewStage(content);
    if (!stageEl) return;

    endLayoutCover();

    const frame = stageEl.querySelector('[data-roadview-frame]') as HTMLElement | null;
    const host = stageEl.querySelector('[data-roadview-host]') as HTMLElement | null;
    const source = frame ?? host;
    if (!source) return;

    const baseW = stretchBaseRef.current?.w ?? stageEl.offsetWidth;
    const baseH = stretchBaseRef.current?.h ?? stageEl.offsetHeight;
    if (baseW <= 0 || baseH <= 0) return;

    const wrap = document.createElement('div');
    wrap.setAttribute('data-roadview-freeze', '');
    wrap.style.cssText = [
      'position:absolute',
      'inset:0',
      'z-index:2',
      'overflow:hidden',
      'pointer-events:none',
    ].join(';');

    const holder = document.createElement('div');
    holder.style.cssText = [
      'position:absolute',
      'left:0',
      'top:0',
      `width:${baseW}px`,
      `height:${baseH}px`,
      `transform:${stageEl.style.transform || 'none'}`,
      'transform-origin:left top',
      'overflow:hidden',
      'background:#888888',
    ].join(';');

    const clone = source.cloneNode(true) as HTMLElement;
    clone.setAttribute('data-roadview-freeze-clone', '');
    clone.style.cssText = [
      'position:absolute',
      'inset:0',
      'width:100%',
      'height:100%',
      'margin:0',
      'pointer-events:none',
    ].join(';');
    holder.appendChild(clone);
    wrap.appendChild(holder);

    if (getComputedStyle(stageEl).position === 'static') {
      stageEl.style.position = 'relative';
    }
    stageEl.appendChild(wrap);
    layoutCoverRef.current = { wrap, stageEl };

    cancelLayoutCoverTimer();
    layoutCoverTimerRef.current = setTimeout(() => {
      layoutCoverTimerRef.current = null;
      if (draggingRef.current) return;
      endLayoutCover();
    }, 8000);
  }, [cancelLayoutCoverTimer, endLayoutCover]);

  const updateSecondaryStretch = useCallback(() => {
    const base = stretchBaseRef.current;
    const stageEl = stretchStageRef.current;
    if (!base || !stageEl || base.w <= 0 || base.h <= 0) return;
    // stage 부모가 아닌 분할 칸(실제 보이는 영역) 기준으로 scale — 가로 fill 누락 방지
    const shell = secondaryContentRef.current ?? secondaryPaneRef.current;
    const sw = shell?.clientWidth ?? 0;
    const sh = shell?.clientHeight ?? 0;
    if (sw <= 0 || sh <= 0) return;
    stageEl.style.transform = `scale(${sw / base.w}, ${sh / base.h})`;
  }, []);

  const scheduleStretch = useCallback(() => {
    if (stretchRafRef.current) return;
    stretchRafRef.current = requestAnimationFrame(() => {
      stretchRafRef.current = 0;
      updateSecondaryStretch();
    });
  }, [updateSecondaryStretch]);

  const endSecondaryStretch = useCallback(() => {
    const stageEl = stretchStageRef.current;
    if (stageEl) {
      stageEl.style.boxSizing = '';
      stageEl.style.width = '';
      stageEl.style.height = '';
      stageEl.style.minHeight = '';
      stageEl.style.flex = '';
      stageEl.style.transformOrigin = '';
      stageEl.style.willChange = '';
      stageEl.style.transform = '';
      stageEl.removeAttribute('data-roadview-css-fill');
      stretchStageRef.current = null;
    }
    stretchBaseRef.current = null;
    const content = secondaryContentRef.current;
    if (content) content.style.overflow = '';
  }, []);

  /** 분할선 드래그: stage CSS scale (컨트롤은 stage 밖 — 숨기지 않음) */
  const beginSecondaryStretch = useCallback(() => {
    cancelStretchEndTimer();
    cancelRevealTimer();
    cancelLayoutCoverTimer();
    stretchEndWaitRef.current = false;
    waitingRevealRef.current = false;
    endLayoutCover();
    endSecondaryStretch();
    const content = secondaryContentRef.current;
    const stageEl = queryRoadviewStage(content);
    if (!stageEl) return;
    const sw = stageEl.offsetWidth;
    const sh = stageEl.offsetHeight;
    if (sw <= 0 || sh <= 0) return;
    stretchBaseRef.current = { w: sw, h: sh };
    stretchStageRef.current = stageEl;
    // 스케일된 그림이 칸 밖으로 새지 않게 shell clip
    if (content) content.style.overflow = 'hidden';
    stageEl.style.boxSizing = 'border-box';
    stageEl.style.width = `${sw}px`;
    stageEl.style.height = `${sh}px`;
    stageEl.style.minHeight = '0';
    stageEl.style.flex = 'none';
    stageEl.style.transformOrigin = 'left top';
    stageEl.style.willChange = 'transform';
    stageEl.style.transform = 'scale(1, 1)';
    stageEl.setAttribute('data-roadview-css-fill', '1');
    updateSecondaryStretch();
  }, [
    cancelStretchEndTimer,
    cancelRevealTimer,
    cancelLayoutCoverTimer,
    endLayoutCover,
    endSecondaryStretch,
    updateSecondaryStretch,
  ]);

  const scheduleSizeTick = useCallback((force = false) => {
    const tick = onSizeTickRef.current;
    if (!tick) return;
    const now = performance.now();
    if (!force && now - sizeTickAtRef.current < 80) return;
    sizeTickAtRef.current = now;
    tick();
  }, []);

  /**
   * 고정 덮개 → teardown → (css-fill 해제) → 새 칸 크기로 mount.
   * 분할선 손 뗌·상하↔좌우 전환 공통.
   */
  const runRoadviewRecreateCycle = useCallback(
    (opts?: { refreshFreeze?: boolean }) => {
      if (draggingRef.current) return;

      if (opts?.refreshFreeze || !layoutCoverRef.current) {
        if (stretchStageRef.current) updateSecondaryStretch();
        beginFreezeSnapshot();
      }

      syncRoadviewRecreateTeardown();
      endSecondaryStretch();
      waitingRevealRef.current = true;
      stretchEndWaitRef.current = false;

      scheduleSizeTick(true);
      void secondaryPaneRef.current?.offsetWidth;
      syncRoadviewRecreateMount();

      cancelStretchEndTimer();
      stretchEndTimerRef.current = setTimeout(() => {
        stretchEndTimerRef.current = null;
        if (draggingRef.current) return;
        waitingRevealRef.current = false;
        endLayoutCover();
      }, 8000);
    },
    [
      updateSecondaryStretch,
      beginFreezeSnapshot,
      syncRoadviewRecreateTeardown,
      endSecondaryStretch,
      scheduleSizeTick,
      syncRoadviewRecreateMount,
      cancelStretchEndTimer,
      endLayoutCover,
    ]
  );

  /**
   * 분할선 손 뗌: css-fill 유지 직후 재생성.
   */
  const finishCssFillAndRecreate = useCallback(() => {
    if (draggingRef.current) return;
    if (!stretchStageRef.current && !stretchEndWaitRef.current) return;

    cancelStretchEndTimer();
    stretchEndWaitRef.current = false;
    runRoadviewRecreateCycle({ refreshFreeze: true });
  }, [cancelStretchEndTimer, runRoadviewRecreateCycle]);

  /**
   * 상하↔좌우: 전환 전 css-fill을 켠 뒤, 칸 애니메이션 동안 scale로 따라가고
   * 끝나면 분할선 손 뗌과 같이 고정→재생성.
   * (호출 전에 beginSecondaryStretch 로 기준 크기를 잡아 둘 것)
   */
  const scheduleOrientationRoadviewRecreate = useCallback(() => {
    if (!splitActiveRef.current) return;
    if (draggingRef.current) return;

    cancelStretchEndTimer();
    cancelRevealTimer();
    if (!stretchStageRef.current) beginSecondaryStretch();
    waitingRevealRef.current = true;
    stretchEndWaitRef.current = true;

    if (stretchRafRef.current) {
      cancelAnimationFrame(stretchRafRef.current);
      stretchRafRef.current = 0;
    }

    const start = performance.now();
    const tick = (t: number) => {
      if (draggingRef.current) {
        stretchRafRef.current = 0;
        return;
      }
      updateSecondaryStretch();
      scheduleSizeTick(false);
      if (t - start < MAP_SPLIT_ANIM_MS + 40) {
        stretchRafRef.current = requestAnimationFrame(tick);
        return;
      }
      stretchRafRef.current = 0;
      stretchEndWaitRef.current = false;
      runRoadviewRecreateCycle({ refreshFreeze: true });
    };
    stretchRafRef.current = requestAnimationFrame(tick);
  }, [
    cancelStretchEndTimer,
    cancelRevealTimer,
    beginSecondaryStretch,
    updateSecondaryStretch,
    scheduleSizeTick,
    runRoadviewRecreateCycle,
  ]);
  const scheduleOrientationRoadviewRecreateRef = useRef(scheduleOrientationRoadviewRecreate);
  scheduleOrientationRoadviewRecreateRef.current = scheduleOrientationRoadviewRecreate;
  const beginSecondaryStretchRef = useRef(beginSecondaryStretch);
  beginSecondaryStretchRef.current = beginSecondaryStretch;
  const syncHorizontalRatioFromUsableRef = useRef(syncHorizontalRatioFromUsable);
  syncHorizontalRatioFromUsableRef.current = syncHorizontalRatioFromUsable;

  /**
   * 손 뗌: flex 반영 후 unlock → 재생성.
   */
  const scheduleEndSecondaryStretch = useCallback(() => {
    cancelStretchEndTimer();
    cancelRevealTimer();
    stretchEndWaitRef.current = true;
    waitingRevealRef.current = true;
    updateSecondaryStretch();
    scheduleSizeTick(true);

    stretchEndTimerRef.current = setTimeout(() => {
      stretchEndTimerRef.current = null;
      if (draggingRef.current) return;
      finishCssFillAndRecreate();
    }, 120);
  }, [
    cancelStretchEndTimer,
    cancelRevealTimer,
    updateSecondaryStretch,
    scheduleSizeTick,
    finishCssFillAndRecreate,
  ]);

  /** unlock·재생성 후 ready → 스냅샷 제거 */
  const scheduleRevealAfterReady = useCallback(() => {
    if (!waitingRevealRef.current) return;
    if (draggingRef.current) return;
    if (stretchStageRef.current || stretchEndWaitRef.current) return;

    cancelRevealTimer();
    cancelStretchEndTimer();
    waitingRevealRef.current = false;
    endLayoutCover();
  }, [cancelRevealTimer, cancelStretchEndTimer, endLayoutCover]);

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
      const usableW = Math.max(
        0,
        el.clientWidth - mapPaddingLeftRef.current - mapPaddingRightRef.current
      );
      const next: MapSplitOrientation =
        usableW < window.innerWidth / 2 ? 'vertical' : 'horizontal';

      if (orientationRef.current !== next) {
        // 방향 전환: 가용 분율(패널 제외) 유지 → 새 축 primaryRatio 로 변환
        const elW = el.clientWidth;
        if (orientationRef.current === 'horizontal') {
          usableSplitFractionRef.current = usableFractionFromPrimaryRatio(
            elW,
            mapPaddingLeftRef.current,
            mapPaddingRightRef.current,
            primaryRatioRef.current
          );
        } else {
          usableSplitFractionRef.current = primaryRatioRef.current;
        }
        const f = usableSplitFractionRef.current;
        const ratioForOrientation =
          next === 'vertical'
            ? clampRatio(f)
            : primaryRatioFromUsableFraction(
                elW,
                mapPaddingLeftRef.current,
                mapPaddingRightRef.current,
                f
              );
        primaryRatioRef.current = ratioForOrientation;
        setPrimaryRatio(ratioForOrientation);
        onPrimaryRatioChangeRef.current?.(ratioForOrientation);

        if (splitActiveRef.current) {
          beginSecondaryStretchRef.current();
        }
        orientationRef.current = next;
        setOrientation(next);
        onOrientationChangeRef.current?.(next);
        if (splitActiveRef.current) {
          scheduleOrientationRoadviewRecreateRef.current();
        }
        return;
      }
      // 방향 유지·컨테이너 리사이즈: 가용 분율 기준으로 primaryRatio 재계산
      syncHorizontalRatioFromUsableRef.current();
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    window.addEventListener('resize', apply);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, [mapPaddingLeft, mapPaddingRight]);

  useEffect(() => {
    onOrientationChangeRef.current?.(orientation);
  }, [orientation]);

  // 패널 폭·분할 ON·가로 방향 변경 시 가용 영역 비율 유지
  useLayoutEffect(() => {
    if (!splitActive || orientation !== 'horizontal') return;
    syncHorizontalRatioFromUsable();
  }, [splitActive, orientation, mapPaddingLeft, mapPaddingRight, syncHorizontalRatioFromUsable]);

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
      let next: number;
      if (isH) {
        const padL = mapPaddingLeftRef.current;
        const padR = mapPaddingRightRef.current;
        const usable = size - padL - padR;
        if (usable <= 0) return;
        const f = Math.min(1, Math.max(0, (pos - rect.left - padL) / usable));
        usableSplitFractionRef.current = f;
        next = primaryRatioFromUsableFraction(size, padL, padR, f);
      } else {
        next = clampRatio(drag.startRatio + (pos - drag.startPos) / size);
        usableSplitFractionRef.current = next;
      }
      pendingRatioRef.current = next;
      applyPaneFlex(next);
      // 드래그 중엔 throttle 없이 매 이동마다 지도 크기 맞춤 (흰 화면 방지)
      scheduleSizeTick(true);
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
      clearPaneInlineFlex();
      setIsRatioDragging(false);
      if (stretchRafRef.current) {
        cancelAnimationFrame(stretchRafRef.current);
        stretchRafRef.current = 0;
      }
      scheduleSizeTick(true);
      scheduleEndSecondaryStretch();
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
      cancelStretchEndTimer();
      cancelRevealTimer();
      stretchEndWaitRef.current = false;
      waitingRevealRef.current = false;
      endSecondaryStretch();
      endLayoutCover();
    };
  }, [
    setRatio,
    applyPaneFlex,
    clearPaneInlineFlex,
    scheduleSizeTick,
    scheduleStretch,
    scheduleEndSecondaryStretch,
    cancelStretchEndTimer,
    cancelRevealTimer,
    endSecondaryStretch,
    endLayoutCover,
  ]);

  useEffect(() => {
    if (!splitActive) {
      cancelStretchEndTimer();
      cancelRevealTimer();
      stretchEndWaitRef.current = false;
      waitingRevealRef.current = false;
      endSecondaryStretch();
      endLayoutCover();
      return;
    }

    const content = secondaryContentRef.current;
    const pane = secondaryPaneRef.current;
    const stageEl = queryRoadviewStage(content);
    const host = stageEl?.querySelector('[data-roadview-host]');
    if (!pane || !host) return;

    const onSnapInvalidate = () => {
      /* 재생성 중 invalidate — cover 없음 */
    };
    const onSnapReady = () => {
      if (draggingRef.current) return;
      scheduleRevealAfterReady();
    };
    const ro = new ResizeObserver(() => {
      if (draggingRef.current) return;
      if (stretchStageRef.current || stretchEndWaitRef.current) return;
      if (layoutCoverRef.current) return;
      if (waitingRevealRef.current) return;
      syncRoadviewLayout();
    });
    ro.observe(pane);
    host.addEventListener('roadview-snap-invalidate', onSnapInvalidate);
    host.addEventListener('roadview-snap-ready', onSnapReady);

    return () => {
      ro.disconnect();
      host.removeEventListener('roadview-snap-invalidate', onSnapInvalidate);
      host.removeEventListener('roadview-snap-ready', onSnapReady);
    };
  }, [
    splitActive,
    cancelStretchEndTimer,
    cancelRevealTimer,
    endSecondaryStretch,
    endLayoutCover,
    syncRoadviewLayout,
    scheduleRevealAfterReady,
  ]);

  const isH = orientation === 'horizontal';
  const gutterHitHalf = MAP_SPLIT_GUTTER_HIT_CROSS_PX / 2;
  const primaryFlex = splitActive ? primaryRatio : 1;
  const secondaryFlex = splitActive ? 1 - primaryRatio : 0;
  const useLeftInset = splitActive && !isH && mapPaddingLeft > 0;
  /** 분할 OFF 시 transition 끔 — 상하 분할 종료 때 하단 칸이 커지며 흰 화면 되는 현상 방지 */
  const paneAnimOn = animReady && !isRatioDragging && splitActive;
  const paneTransitionMs = paneAnimOn ? `${MAP_SPLIT_ANIM_MS}ms` : '0ms';
  // flex 단축 전환 — flexGrow만 쓰면 분할 OFF 시 주 칸이 0폭으로 무너지는 환경이 있음
  const paneTransitionClass = paneAnimOn ? 'transition-[flex] ease-out' : undefined;

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex h-full w-full min-h-0 min-w-0 flex-row',
        splitActive ? 'overflow-visible' : 'overflow-hidden'
      )}
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
          'relative flex min-h-0 min-w-0 flex-1',
          splitActive ? 'overflow-visible' : 'overflow-hidden',
          /* splitActive 여부와 무관하게 방향 유지 — OFF 순간 flex-row 로 바뀌면 상단(주) 지도가 줄어듦 */
          isH ? 'flex-row' : 'flex-col'
        )}
      >
        <div
          ref={primaryPaneRef}
          className={cn('relative min-h-0 min-w-0 overflow-hidden', paneTransitionClass)}
          style={{
            // 분할 OFF: flex-1과 동일하게 전체 폭 확보 (flexGrow+basis 0%만 쓰면 0폭 되는 경우 있음)
            flex: splitActive ? `${primaryFlex} 1 0%` : '1 1 auto',
            transitionDuration: paneTransitionMs,
            transitionProperty: isRatioDragging ? 'none' : 'flex',
          }}
        >
          {primary}
        </div>

        {/* 거터 항상 유지 — OFF 시 폭 0. ON일 때 overflow-visible 로 컨트롤러 잘림 방지.
            self-stretch로 세로 높이를 확보해야 pill top:50%가 화면 중앙에 맞음 */}
        <div
          className={cn(
            'relative shrink-0',
            isH ? 'self-stretch' : 'w-full self-center',
            animReady && (isH ? 'transition-[width] ease-out' : 'transition-[height] ease-out'),
            splitActive
              ? 'overflow-visible pointer-events-none'
              : 'overflow-hidden pointer-events-none'
          )}
          style={{
            zIndex: splitActive ? MAP_SPLIT_GUTTER_Z_INDEX : undefined,
            width: isH ? (splitActive ? MAP_SPLIT_GUTTER_HIT_CROSS_PX : 0) : '100%',
            height: isH ? undefined : splitActive ? MAP_SPLIT_GUTTER_HIT_CROSS_PX : 0,
            marginLeft: isH && splitActive ? -gutterHitHalf : undefined,
            marginRight: isH && splitActive ? -gutterHitHalf : undefined,
            marginTop: !isH && splitActive ? -gutterHitHalf : undefined,
            marginBottom: !isH && splitActive ? -gutterHitHalf : undefined,
            opacity: splitActive ? 1 : 0,
            transitionDuration: paneTransitionMs,
          }}
          aria-hidden={!splitActive}
        >
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
            onControlsExpandedChange={onControlsExpandedChange}
            mapPaddingLeft={mapPaddingLeft}
            mapPaddingRight={mapPaddingRight}
            onDragStart={(clientPos) => {
              if (!splitActive || ratioLocked) return;
              draggingRef.current = true;
              setIsRatioDragging(true);
              dragRef.current = { startPos: clientPos, startRatio: primaryRatio };
              beginSecondaryStretch();
            }}
          />
        </div>

        <div
          ref={secondaryPaneRef}
          className={cn(
            'relative min-h-0 min-w-0 overflow-hidden bg-[#888888]',
            paneTransitionClass,
            !splitActive && 'pointer-events-none'
          )}
          style={{
            flex: splitActive ? `${secondaryFlex} 1 0%` : '0 0 0px',
            transitionDuration: paneTransitionMs,
            transitionProperty: isRatioDragging ? 'none' : 'flex',
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
