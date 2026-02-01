import { useEffect, useRef } from 'react';
import { Map } from 'ol';
import { Draw } from 'ol/interaction';
import VectorSource from 'ol/source/Vector';
import { Feature } from 'ol';

export type DrawType = 'Point' | 'LineString' | 'Polygon' | 'Circle';

/**
 * Draw 인터랙션 훅
 * 지도에 그리기 기능을 추가/제거
 */
export function useDraw(
  map: Map | null,
  isActive: boolean,
  drawType: DrawType,
  source: VectorSource,
  onDrawEnd?: (feature: Feature) => void
) {
  const drawRef = useRef<Draw | null>(null);

  useEffect(() => {
    if (!map || !isActive || !source) return;

    const draw = new Draw({
      source: source,
      type: drawType,
    });

    if (onDrawEnd) {
      draw.on('drawend', (e) => {
        onDrawEnd(e.feature);
      });
    }

    map.addInteraction(draw);
    drawRef.current = draw;

    return () => {
      map.removeInteraction(draw);
      drawRef.current = null;
    };
  }, [map, isActive, drawType, source, onDrawEnd]);

  return drawRef;
}
