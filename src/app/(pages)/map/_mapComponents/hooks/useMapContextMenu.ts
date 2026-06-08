'use client';

import { useEffect } from 'react';
import type { Map } from 'ol';

/**
 * 지도 우클릭 시 좌표·뷰 좌표계를 콜백으로 전달.
 * 팝업은 콜백에서 context 등으로 패널을 띄우는 방식 사용.
 */
export function useMapContextMenu(
  map: Map | null,
  mapReady: boolean,
  onContextMenu: (coordinate: [number, number], viewProjection: string) => void
) {
  useEffect(() => {
    if (!mapReady || !map) return;

    const handleContextMenu = (evt: MouseEvent) => {
      evt.preventDefault();
      const viewport = map.getViewport();
      const rect = viewport.getBoundingClientRect();
      const pixel: [number, number] = [
        evt.clientX - rect.left,
        evt.clientY - rect.top,
      ];
      const coordinate = map.getCoordinateFromPixel(pixel);
      if (!coordinate || coordinate.length < 2) return;

      const view = map.getView();
      const viewProjection = view.getProjection()?.getCode() ?? 'EPSG:3857';

      onContextMenu(coordinate as [number, number], viewProjection);
    };

    const viewport = map.getViewport();
    viewport.addEventListener('contextmenu', handleContextMenu);

    return () => {
      viewport.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [map, mapReady, onContextMenu]);
}
