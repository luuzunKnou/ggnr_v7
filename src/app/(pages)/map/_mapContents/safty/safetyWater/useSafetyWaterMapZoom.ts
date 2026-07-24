'use client';

import { useEffect, useRef } from 'react';
import { call } from '@/lib/api';
import { useMapContext } from '../../../_mapComponents/MapContext';
import { scheduleFitMapToExtent3857 } from '../../../_mapComponents/config/mapAutoNavigation';
import { transformCoordinate } from '../../../_mapComponents/services/coordinateService';

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
 * 침수현황 진입 시 사업 시군구(schema.emd envelope)가 화면에 다 보이도록 fit.
 */
export function useSafetyWaterMapZoom(active: boolean, mapReady: boolean) {
  const mapContext = useMapContext();
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!active) {
      fittedRef.current = false;
      return;
    }
    if (!mapReady || fittedRef.current) return;

    let cancelled = false;

    const run = async () => {
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;

      try {
        const res = await call('', 'POST', {
          service: 'devTestService',
          action: 'getEmdExtent5181',
          params: {},
        });
        if (cancelled || fittedRef.current) return;
        const data = res?.data ?? res;
        const minX = Number(data?.minX);
        const maxX = Number(data?.maxX);
        const minY = Number(data?.minY);
        const maxY = Number(data?.maxY);
        if (![minX, maxX, minY, maxY].every(Number.isFinite)) return;

        const ext3857 = extent5181To3857(minX, minY, maxX, maxY);
        if (!ext3857) return;

        const paddingLeft = Math.max(24, mapContext?.mapPaddingLeft ?? 0);
        scheduleFitMapToExtent3857(map, ext3857, {
          duration: 500,
          fitPadding: [48, 48, 48, paddingLeft + 24],
          applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
        });
        fittedRef.current = true;
      } catch {
        /* 맞춤 실패해도 진행 */
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    active,
    mapReady,
    mapContext?.mapInstanceRef,
    mapContext?.applyMapViewPaddingRef,
    mapContext?.mapPaddingLeft,
  ]);
}
