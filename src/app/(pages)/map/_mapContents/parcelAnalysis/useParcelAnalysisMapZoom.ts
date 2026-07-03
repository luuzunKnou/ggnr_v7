'use client';

import { useCallback, useRef } from 'react';
import { call } from '@/lib/api';
import { useMapContext } from '../../_mapComponents/MapContext';
import { scheduleAnimateMapToCenter3857 } from '../../_mapComponents/config/mapAutoNavigation';
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../_mapComponents/config/mapDefaults';
import { transformCoordinate } from '../../_mapComponents/services/coordinateService';

/**
 * 시군구가 뷰포트에서 차지할 목표 비율.
 * 1.0 = 화면에 딱 맞춤, 1.0 초과 = 중심 좌표 기준 더 확대(가장자리 크롭).
 * (1.5 = 시군구가 화면의 약 150% → 중앙만 크게)
 * fit(contain)은 100% 초과가 안 되므로 중심+줌 계산 방식으로 처리한다.
 */
const TARGET_VIEWPORT_FILL = 1.5;

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
 * 필지분석 진입 시 사업 시군구(schema.emd 전체) 범위를 중심 좌표 기준으로 확대.
 * 좌측 패널이 없는 진입 단계에서 대상 지역을 크게 보여주기 위한 용도.
 */
export function useParcelAnalysisMapZoom() {
  const mapContext = useMapContext();
  const zoomedRef = useRef(false);

  const fitProjectEmdExtent = useCallback(async () => {
    if (zoomedRef.current) return;
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

      const [xmin, ymin, xmax, ymax] = ext3857;
      const center: [number, number] = [(xmin + xmax) / 2, (ymin + ymax) / 2];
      const extentWidth = xmax - xmin;
      const extentHeight = ymax - ymin;

      const size = map.getSize();
      const view = map.getView();
      if (!size || extentWidth <= 0 || extentHeight <= 0) return;

      // 좌측 패널이 없는 진입 단계 — 사이드바 패딩만 가시영역에서 제외
      const paddingLeft = mapContext?.mapPaddingLeft ?? 0;
      const usableWidth = Math.max(1, size[0] - paddingLeft);
      const usableHeight = Math.max(1, size[1]);

      // 시군구의 큰 변이 가시영역의 (목표 비율)을 차지하도록 해상도 계산
      const targetResolution = Math.max(
        extentWidth / (usableWidth * TARGET_VIEWPORT_FILL),
        extentHeight / (usableHeight * TARGET_VIEWPORT_FILL)
      );

      const rawZoom = view.getZoomForResolution(targetResolution);
      if (rawZoom == null || !Number.isFinite(rawZoom)) return;
      const zoom = Math.min(rawZoom, MAP_AUTO_NAV_MAX_ZOOM);

      scheduleAnimateMapToCenter3857(map, center, zoom, {
        applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
      });
      zoomedRef.current = true;
    } catch {
      /* 맞춤 실패해도 진행 — 사용자가 수동으로 이동 가능 */
    }
  }, [mapContext?.mapInstanceRef, mapContext?.applyMapViewPaddingRef, mapContext?.mapPaddingLeft]);

  const resetZoomFlag = useCallback(() => {
    zoomedRef.current = false;
  }, []);

  return { fitProjectEmdExtent, resetZoomFlag, zoomedRef };
}
