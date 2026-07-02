'use client';

import { useCallback, useRef } from 'react';
import { call } from '@/lib/api';
import { useMapContext } from '../../_mapComponents/MapContext';
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation';
import { transformCoordinate } from '../../_mapComponents/services/coordinateService';

function extent5181To3857(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): [number, number, number, number] | null {
  const corners: [number, number][] = [
    [minX, minY],
    [minX, maxY],
    [maxX, minY],
    [maxX, maxY],
  ];
  const transformed = corners.map(
    (c) => transformCoordinate(c, 'EPSG:5181', 'EPSG:3857') as [number, number]
  );
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  for (const [x, y] of transformed) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    xmin = Math.min(xmin, x);
    ymin = Math.min(ymin, y);
    xmax = Math.max(xmax, x);
    ymax = Math.max(ymax, y);
  }
  return [xmin, ymin, xmax, ymax];
}

/**
 * 필지분석 진입 시 시군구(emd 전체) extent fit.
 * TODO: 뷰포트 80% 채움·필요 시에만 fit — 2차에서 재구현
 */
export function useParcelAnalysisMapZoom() {
  const mapContext = useMapContext();
  const zoomedRef = useRef(false);

  const fitProjectEmdExtent = useCallback(async () => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;

    try {
      const res = await call('', 'POST', {
        service: 'devTestService',
        action: 'getEmdExtent5181',
        params: {},
      });
      const data = res?.data ?? res;
      const minX = Number(data?.minX);
      const maxX = Number(data?.maxX);
      const minY = Number(data?.minY);
      const maxY = Number(data?.maxY);
      if (![minX, maxX, minY, maxY].every(Number.isFinite)) return;

      const ext3857 = extent5181To3857(minX, minY, maxX, maxY);
      if (!ext3857) return;

      scheduleFitMapToExtent3857(map, ext3857, {
        fitPadding: [48, 48, 48, 48],
        maxZoom: 16,
      });
      zoomedRef.current = true;
    } catch {
      /* ignore — 1차 UI는 맞춤 실패해도 진행 */
    }
  }, [mapContext?.mapInstanceRef]);

  const resetZoomFlag = useCallback(() => {
    zoomedRef.current = false;
  }, []);

  return { fitProjectEmdExtent, resetZoomFlag, zoomedRef };
}
