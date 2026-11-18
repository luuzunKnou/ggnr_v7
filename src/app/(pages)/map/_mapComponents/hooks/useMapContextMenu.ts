'use client';

import { useEffect } from 'react';
import type { Map } from 'ol';

export type MapContextMenuPayload = {
  coordinate: [number, number];
  viewProjection: string;
  screenX: number;
  screenY: number;
};

/**
 * 지도 우클릭 시 좌표·뷰 좌표계·화면 좌표를 콜백으로 전달.
 * 팝업은 콜백에서 context 등으로 메뉴·패널을 띄우는 방식 사용.
 */
export function useMapContextMenu(
  map: Map | null,
  mapReady: boolean,
  onContextMenu: (payload: MapContextMenuPayload) => void
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

      onContextMenu({
        coordinate: coordinate as [number, number],
        viewProjection,
        screenX: evt.clientX,
        screenY: evt.clientY,
      });
    };

    const viewport = map.getViewport();
    viewport.addEventListener('contextmenu', handleContextMenu);

    return () => {
      viewport.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [map, mapReady, onContextMenu]);
}
