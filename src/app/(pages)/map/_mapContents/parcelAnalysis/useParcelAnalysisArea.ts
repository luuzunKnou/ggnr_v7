'use client';

import { useCallback, useState } from 'react';
import type { BoundaryEmdSelection, ParcelAnalysisArea, ParcelAreaMethod } from './parcelAnalysisTypes';
import { formatBoundaryAreaSummary } from './boundarySelectionUtils';

const MOCK_DRAW_AREA: ParcelAnalysisArea = {
  method: 'draw',
  summaryLabel: '도형 1개 · 약 2.1 ha',
  wkt: 'MOCK_WKT_DRAW',
  itemCount: 1,
  areaHa: 2.1,
};

const MOCK_BOUNDARY_AREA: ParcelAnalysisArea = {
  method: 'boundary',
  summaryLabel: '행정경계 3개 · 약 4.2 ha',
  wkt: 'MOCK_WKT_BOUNDARY',
  itemCount: 3,
  areaHa: 4.2,
};

export function useParcelAnalysisArea() {
  const [area, setArea] = useState<ParcelAnalysisArea | null>(null);
  const [boundaryDraft, setBoundaryDraft] = useState<BoundaryEmdSelection[]>([]);

  const applyMockDraw = useCallback(() => {
    setArea({ ...MOCK_DRAW_AREA });
  }, []);

  const applyMockBoundary = useCallback((selection: BoundaryEmdSelection[]) => {
    setBoundaryDraft(selection);
    const areaHa = MOCK_BOUNDARY_AREA.areaHa;
    const { itemCount, summaryLabel, summaryDetail } = formatBoundaryAreaSummary(selection, areaHa);
    setArea({
      ...MOCK_BOUNDARY_AREA,
      itemCount,
      summaryLabel,
      summaryDetail,
    });
  }, []);

  const clearArea = useCallback(() => {
    setArea(null);
  }, []);

  const restoreBoundaryDraft = useCallback((): BoundaryEmdSelection[] => {
    return boundaryDraft.length > 0 ? boundaryDraft.map((s) => ({ ...s, riCodes: [...s.riCodes] })) : [];
  }, [boundaryDraft]);

  return {
    area,
    boundaryDraft,
    applyMockDraw,
    applyMockBoundary,
    clearArea,
    restoreBoundaryDraft,
    setBoundaryDraft,
  };
}

/** 2차에서 실 WKT로 교체 */
export function mockAreaForMethod(method: ParcelAreaMethod): ParcelAnalysisArea {
  return method === 'draw' ? { ...MOCK_DRAW_AREA } : { ...MOCK_BOUNDARY_AREA };
}
