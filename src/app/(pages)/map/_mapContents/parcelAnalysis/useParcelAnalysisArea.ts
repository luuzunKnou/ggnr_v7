'use client';

import { useCallback, useState } from 'react';
import WKT from 'ol/format/WKT';
import type { BoundaryEmdSelection, ParcelAnalysisArea } from './parcelAnalysisTypes';
import { formatBoundaryAreaSummary } from './boundarySelectionUtils';

/** 제곱미터 표시용 포맷 (천 단위 구분 + ㎡) */
export function formatAreaSqm(areaSqm: number): string {
  return `약 ${areaSqm.toLocaleString('ko-KR')} ㎡`;
}

/**
 * 5181 평면 WKT → 제곱미터(㎡).
 * EPSG:5181은 미터 단위 평면 좌표라 (변환 없이 읽은) geometry.getArea()가 곧 m².
 * 지도 표시용 3857로 읽으면 면적이 왜곡되므로 면적 계산에는 5181 원본을 쓴다.
 */
export function computeAreaSqmFromWkt5181(wkt5181: string): number {
  try {
    const geom = new WKT().readGeometry(wkt5181);
    const areaSqm = geom.getArea();
    if (!Number.isFinite(areaSqm) || areaSqm <= 0) return 0;
    return Math.round(areaSqm);
  } catch {
    return 0;
  }
}

export function useParcelAnalysisArea() {
  const [area, setArea] = useState<ParcelAnalysisArea | null>(null);
  const [boundaryDraft, setBoundaryDraft] = useState<BoundaryEmdSelection[]>([]);

  const applyDrawArea = useCallback((wkt5181: string) => {
    const areaSqm = computeAreaSqmFromWkt5181(wkt5181);
    setArea({
      method: 'draw',
      summaryLabel: `도형 1개 · ${formatAreaSqm(areaSqm)}`,
      targetLabel: '도형 1개',
      wkt: wkt5181,
      itemCount: 1,
      areaSqm,
    });
  }, []);

  const applyBoundaryArea = useCallback(
    (selection: BoundaryEmdSelection[], wkt5181: string) => {
      setBoundaryDraft(selection);
      const areaSqm = computeAreaSqmFromWkt5181(wkt5181);
      const { itemCount, summaryLabel, summaryDetail, targetLabel } = formatBoundaryAreaSummary(
        selection,
        areaSqm
      );
      setArea({
        method: 'boundary',
        summaryLabel,
        summaryDetail,
        targetLabel,
        wkt: wkt5181,
        itemCount,
        areaSqm,
      });
    },
    []
  );

  const clearArea = useCallback(() => {
    setArea(null);
  }, []);

  return {
    area,
    boundaryDraft,
    applyDrawArea,
    applyBoundaryArea,
    clearArea,
    setBoundaryDraft,
  };
}
