'use client';

import { useMemo } from 'react';
import { PARCEL_ANALYSIS_GROUPS } from './parcelAnalysisItems';
import {
  buildMockParcelAnalysisResult,
  buildResultSections,
  type MockParcelAnalysisResult,
  type ResultSectionDef,
} from './mockParcelAnalysisResult';

export function useParcelAnalysisResultSections(selectedItemIds: string[]) {
  const sections = useMemo(
    () => buildResultSections(selectedItemIds, PARCEL_ANALYSIS_GROUPS),
    [selectedItemIds]
  );

  const mockResult: MockParcelAnalysisResult = useMemo(
    () => buildMockParcelAnalysisResult(selectedItemIds),
    [selectedItemIds]
  );

  return { sections, mockResult };
}

export type { ResultSectionDef, MockParcelAnalysisResult };
