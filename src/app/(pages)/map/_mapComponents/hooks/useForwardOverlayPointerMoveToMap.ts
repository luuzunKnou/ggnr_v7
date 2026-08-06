'use client';

import { useEffect } from 'react';
import type OlMap from 'ol/Map';

/**
 * 우측 배경지도 등 지도 위 UI가 pointer-events-auto 이면
 * 그 위에서는 OL viewport가 pointermove를 못 받아 Draw/측정 고무줄이 멈춘다.
 * 지도 사각형 안·viewport 밖 타깃의 pointermove를 viewport로 한 번 더 전달한다.
 */
export function useForwardOverlayPointerMoveToMap(map: OlMap | null, enabled: boolean) {
  useEffect(() => {
    if (!map || !enabled) return;

    const viewport = map.getViewport();
    if (!viewport) return;

    const onPointerMove = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (viewport.contains(target)) return;

      const rect = viewport.getBoundingClientRect();
      const { clientX, clientY } = e;
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        return;
      }

      viewport.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX,
          clientY,
          screenX: e.screenX,
          screenY: e.screenY,
          movementX: e.movementX,
          movementY: e.movementY,
          pointerId: e.pointerId,
          pointerType: e.pointerType,
          isPrimary: e.isPrimary,
          buttons: e.buttons,
          button: e.button,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          pressure: e.pressure,
          tangentialPressure: e.tangentialPressure,
          tiltX: e.tiltX,
          tiltY: e.tiltY,
          twist: e.twist,
          width: e.width,
          height: e.height,
        })
      );
    };

    document.addEventListener('pointermove', onPointerMove, true);
    return () => document.removeEventListener('pointermove', onPointerMove, true);
  }, [map, enabled]);
}
