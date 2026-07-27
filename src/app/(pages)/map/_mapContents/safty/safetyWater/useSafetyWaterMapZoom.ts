'use client';

import type { Map as OlMap } from 'ol';
import { fromLonLat } from 'ol/proj';
import { useEffect, useRef } from 'react';
import { useMapContext } from '../../../_mapComponents/MapContext';
import {
  scheduleFitMapToExtent3857,
  type Extent3857,
} from '../../../_mapComponents/config/mapAutoNavigation';
import type { SafetyWaterStation } from './safetyWaterTypes';

const OVERVIEW_FIT_PADDING: [number, number, number, number] = [48, 48, 48, 48];

/** 관측소 lon/lat → 3857 extent. 유효 좌표 없으면 null */
export function stationsExtent3857(stations: SafetyWaterStation[]): Extent3857 | null {
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  let count = 0;
  for (const st of stations) {
    const lon = Number(st.lon);
    const lat = Number(st.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const [x, y] = fromLonLat([lon, lat]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    xmin = Math.min(xmin, x);
    ymin = Math.min(ymin, y);
    xmax = Math.max(xmax, x);
    ymax = Math.max(ymax, y);
    count += 1;
  }
  if (count === 0) return null;
  return [xmin, ymin, xmax, ymax];
}

/** 전체 관측소가 보이도록 fit (좌측 패널은 view.padding으로만 보정) */
export function fitStationsOverview(
  map: OlMap,
  stations: SafetyWaterStation[],
  applyMapViewPadding?: (() => void) | null
): boolean {
  const extent = stationsExtent3857(stations);
  if (!extent) return false;
  scheduleFitMapToExtent3857(map, extent, {
    duration: 500,
    fitPadding: OVERVIEW_FIT_PADDING,
    applyMapViewPadding: applyMapViewPadding ?? null,
  });
  return true;
}

/**
 * 침수현황 진입 시 전체 관측소 extent가 화면에 다 보이도록 fit.
 */
export function useSafetyWaterMapZoom(
  active: boolean,
  mapReady: boolean,
  stations: SafetyWaterStation[]
) {
  const mapContext = useMapContext();
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!active) {
      fittedRef.current = false;
      return;
    }
    if (!mapReady || fittedRef.current) return;
    if (!stations.length) return;

    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;

    const ok = fitStationsOverview(map, stations, () =>
      mapContext?.applyMapViewPaddingRef?.current?.()
    );
    if (ok) fittedRef.current = true;
  }, [
    active,
    mapReady,
    stations,
    mapContext?.mapInstanceRef,
    mapContext?.applyMapViewPaddingRef,
  ]);
}
