'use client';

import { useEffect } from 'react';
import type Map from 'ol/Map';
import type { MapBrowserEvent } from 'ol';
import { unByKey } from 'ol/Observable';
import type { EventsKey } from 'ol/events';
import { transform } from 'ol/proj';
import type { Coordinate } from 'ol/coordinate';
import {
  armMapSplitSelectionViewMirror,
  syncSecondaryViewFromPrimary,
} from './useMapSplitViewSync';
import { useMapSplitDrawInteractionActive } from './useMapSplitDrawPointerBridge';

const FORWARD_TYPES = ['singleclick', 'dblclick'] as const;
const RENDER_FALLBACK_MS = 200;

type ForwardType = (typeof FORWARD_TYPES)[number];

function transformCoord(
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

function pixelInMap(primary: Map, pixel: number[] | null): pixel is [number, number] {
  if (!pixel) return false;
  const size = primary.getSize();
  if (!size || size[0] <= 0 || size[1] <= 0) return false;
  return (
    pixel[0] >= 0 &&
    pixel[1] >= 0 &&
    pixel[0] <= size[0] &&
    pixel[1] <= size[1]
  );
}

/**
 * 클릭 좌표가 좌측에서 히트되도록 맞춤.
 * 패딩(좌측 패널)과 무관하게 setCenter(클릭좌표)로 화면 중앙에 두고,
 * 확대는 우측과 같게 해 심볼 히트 범위를 맞춘다.
 */
function preparePrimaryViewForHit(primary: Map, secondary: Map, coordinate: Coordinate): void {
  const pView = primary.getView();
  const sView = secondary.getView();
  const zoom = sView.getZoom();
  if (zoom != null) pView.setZoom(zoom);
  else pView.setResolution(sView.getResolution());
  pView.setCenter(coordinate);
}

/**
 * 우측 분할지도 포인터 이벤트를 좌측 맵으로 전달.
 * 이동 싱크 OFF로 우측이 좌측 화면 밖이어도, 클릭 좌표를 좌측 중앙에 맞춘 뒤
 * 렌더 완료(또는 fallback) 후 전달해 객체 클릭·식별이 동작한다.
 */
export function useMapSplitPointerBridge(
  primary: Map | null,
  secondary: Map | null,
  active: boolean
) {
  const drawInteractionActive = useMapSplitDrawInteractionActive();

  useEffect(() => {
    if (!active || drawInteractionActive || !primary || !secondary) return;

    const keys: EventsKey[] = [];
    const forwardTimeouts: number[] = [];
    let renderWaitKey: EventsKey | null = null;
    let fallbackTimer: number | null = null;

    const clearRenderWait = () => {
      if (renderWaitKey) {
        unByKey(renderWaitKey);
        renderWaitKey = null;
      }
      if (fallbackTimer != null) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    };

    const scheduleSecondarySync = () => {
      syncSecondaryViewFromPrimary(primary, secondary);
      for (const ms of [100, 400, 800]) {
        forwardTimeouts.push(
          window.setTimeout(() => {
            syncSecondaryViewFromPrimary(primary, secondary);
          }, ms)
        );
      }
    };

    const dispatchToPrimary = (
      type: ForwardType,
      evt: MapBrowserEvent<PointerEvent>,
      coordinate: Coordinate,
      pixel: [number, number]
    ) => {
      armMapSplitSelectionViewMirror();
      primary.dispatchEvent({
        type,
        map: primary,
        target: primary,
        currentTarget: primary,
        originalEvent: evt.originalEvent,
        coordinate,
        pixel,
        dragging: Boolean(evt.dragging),
        preventDefault: () => evt.preventDefault?.(),
        stopPropagation: () => evt.stopPropagation?.(),
      } as never);
      scheduleSecondarySync();
    };

    const resolvePixelAndDispatch = (
      type: ForwardType,
      evt: MapBrowserEvent<PointerEvent>,
      coordinate: Coordinate
    ) => {
      const pixel = primary.getPixelFromCoordinate(coordinate);
      if (!pixelInMap(primary, pixel)) return;
      dispatchToPrimary(type, evt, coordinate, pixel.slice() as [number, number]);
    };

    /**
     * 화면 밖: 뷰 변경 전에 rendercomplete 구독 → 변경 → render → fallback.
     * (구독보다 렌더가 먼저 끝나면 once가 영구 대기하는 문제 방지)
     */
    const forwardAfterPrimaryReady = (
      type: ForwardType,
      evt: MapBrowserEvent<PointerEvent>,
      coordinate: Coordinate
    ) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearRenderWait();
        resolvePixelAndDispatch(type, evt, coordinate);
      };

      renderWaitKey = primary.once('rendercomplete', finish);
      preparePrimaryViewForHit(primary, secondary, coordinate);
      primary.render();
      fallbackTimer = window.setTimeout(finish, RENDER_FALLBACK_MS);
    };

    for (const type of FORWARD_TYPES) {
      const key = secondary.on(type, ((evt: MapBrowserEvent<PointerEvent>) => {
        if (!evt?.coordinate) return;
        clearRenderWait();

        const coordinate = transformCoord(
          evt.coordinate.slice(),
          secondary.getView().getProjection()?.getCode(),
          primary.getView().getProjection()?.getCode()
        );

        const inViewPixel = primary.getPixelFromCoordinate(coordinate);
        if (pixelInMap(primary, inViewPixel)) {
          dispatchToPrimary(type, evt, coordinate, inViewPixel.slice() as [number, number]);
          return;
        }

        forwardAfterPrimaryReady(type, evt, coordinate);
      }) as never);
      keys.push(key);
    }

    return () => {
      clearRenderWait();
      for (const key of keys) unByKey(key);
      for (const t of forwardTimeouts) window.clearTimeout(t);
    };
  }, [active, drawInteractionActive, primary, secondary]);
}
