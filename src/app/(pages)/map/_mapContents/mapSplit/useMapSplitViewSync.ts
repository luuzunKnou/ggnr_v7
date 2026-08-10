'use client';

import { useEffect, useRef } from 'react';
import type Map from 'ol/Map';
import { unByKey } from 'ol/Observable';
import type { EventsKey } from 'ol/events';
import { transform } from 'ol/proj';
import type { Coordinate } from 'ol/coordinate';

/** 객체 선택 후 animate/fit 동안 이동 싱크 OFF여도 좌→우 뷰 미러 */
const SELECTION_VIEW_MIRROR_MS = 2000;

let selectionMirrorUntil = 0;

/** 레이어 객체 클릭·식별 직전 호출 — 이후 좌측 view 변경을 우측에 한시 반영 */
export function armMapSplitSelectionViewMirror(durationMs = SELECTION_VIEW_MIRROR_MS): void {
  selectionMirrorUntil = Math.max(selectionMirrorUntil, performance.now() + durationMs);
}

function isSelectionViewMirrorArmed(): boolean {
  return performance.now() < selectionMirrorUntil;
}

function transformCenter(
  center: Coordinate,
  fromCode: string | undefined,
  toCode: string | undefined
): Coordinate {
  if (!fromCode || !toCode || fromCode === toCode) return center;
  try {
    return transform(center, fromCode, toCode);
  } catch {
    return center;
  }
}

/** 좌측 view의 center·zoom/resolution을 우측으로 복사 */
export function syncSecondaryViewFromPrimary(
  primary: Map | null | undefined,
  secondary: Map | null | undefined
): void {
  const pView = primary?.getView();
  const sView = secondary?.getView();
  if (!pView || !sView) return;
  const center = pView.getCenter();
  if (center) {
    sView.setCenter(
      transformCenter(
        center,
        pView.getProjection()?.getCode(),
        sView.getProjection()?.getCode()
      )
    );
  }
  const zoom = pView.getZoom();
  if (zoom != null) sView.setZoom(zoom);
  else sView.setResolution(pView.getResolution());
}

/**
 * 좌·우 View center/zoom 동기화.
 * - 이동 싱크 ON: 양방향 상시 동기
 * - 이동 싱크 OFF: 객체 선택(arm) 직후에만 좌→우 한시 미러 (중심·확대 포함)
 * 배경 변경으로 View가 교체돼도 change:view 로 다시 구독한다.
 */
export function useMapSplitViewSync(
  primary: Map | null,
  secondary: Map | null,
  enabled: boolean,
  mapSync: boolean
) {
  const skipFromPrimaryRef = useRef(false);
  const skipFromSecondaryRef = useRef(false);

  useEffect(() => {
    if (!enabled || !primary || !secondary) return;

    let viewKeys: EventsKey[] = [];
    let mapKeys: EventsKey[] = [];
    let clickArmKey: EventsKey | null = null;

    const unbindViews = () => {
      viewKeys.forEach((k) => unByKey(k));
      viewKeys = [];
    };

    const copyToSecondary = () => {
      if (skipFromSecondaryRef.current) return;
      skipFromPrimaryRef.current = true;
      syncSecondaryViewFromPrimary(primary, secondary);
      queueMicrotask(() => {
        skipFromPrimaryRef.current = false;
      });
    };

    const copyToPrimary = () => {
      if (skipFromPrimaryRef.current) return;
      skipFromSecondaryRef.current = true;
      const pView = primary.getView();
      const sView = secondary.getView();
      const center = sView.getCenter();
      if (center) {
        pView.setCenter(
          transformCenter(
            center,
            sView.getProjection()?.getCode(),
            pView.getProjection()?.getCode()
          )
        );
      }
      const zoom = sView.getZoom();
      if (zoom != null) pView.setZoom(zoom);
      else pView.setResolution(sView.getResolution());
      queueMicrotask(() => {
        skipFromSecondaryRef.current = false;
      });
    };

    const bindViews = () => {
      unbindViews();
      const pView = primary.getView();
      const sView = secondary.getView();

      if (mapSync) {
        copyToSecondary();
        viewKeys = [
          pView.on('change:center', copyToSecondary),
          pView.on('change:resolution', copyToSecondary),
          sView.on('change:center', copyToPrimary),
          sView.on('change:resolution', copyToPrimary),
        ];
        return;
      }

      // 이동 싱크 OFF: 선택(arm) 구간만 좌→우 (animate/fit의 center·zoom 포함)
      const copyIfArmed = () => {
        if (!isSelectionViewMirrorArmed()) return;
        copyToSecondary();
      };
      viewKeys = [
        pView.on('change:center', copyIfArmed),
        pView.on('change:resolution', copyIfArmed),
      ];
    };

    bindViews();
    mapKeys = [
      primary.on('change:view', bindViews),
      secondary.on('change:view', bindViews),
    ];

    // click은 singleclick보다 먼저 발생 → 다른 핸들러의 animate 전에 arm
    if (!mapSync) {
      clickArmKey = primary.on('click', () => {
        armMapSplitSelectionViewMirror();
      });
    }

    return () => {
      unbindViews();
      mapKeys.forEach((k) => unByKey(k));
      if (clickArmKey) unByKey(clickArmKey);
    };
  }, [enabled, mapSync, primary, secondary]);
}

/** 객체 선택 등 — 이동 싱크 OFF여도 양맵 중심을 맞춤 */
export function centerBothMaps(
  primary: Map | null | undefined,
  secondary: Map | null | undefined,
  coordinate: [number, number]
): void {
  if (!primary && !secondary) return;
  armMapSplitSelectionViewMirror();
  const pView = primary?.getView();
  const sView = secondary?.getView();
  const pCode = pView?.getProjection()?.getCode();
  const sCode = sView?.getProjection()?.getCode();
  if (pView) pView.setCenter(coordinate);
  if (sView) {
    sView.setCenter(transformCenter(coordinate, pCode, sCode));
  }
  // 식별 후 좌측이 zoom/fit 하면 arm 구간에서 해상도도 따라감. 즉시 zoom도 맞춤
  if (primary && secondary) {
    syncSecondaryViewFromPrimary(primary, secondary);
  }
}
