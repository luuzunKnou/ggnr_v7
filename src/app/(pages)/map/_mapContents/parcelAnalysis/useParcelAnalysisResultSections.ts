'use client';

import { useMemo } from 'react';
import type { ParcelAnalysisGroupDef } from './parcelAnalysisItems';
import {
  buildResultSections,
  type MockParcelAnalysisResult,
  type ResultSectionDef,
} from './mockParcelAnalysisResult';

export function useParcelAnalysisResultSections(
  selectedItemIds: string[],
  groups: ParcelAnalysisGroupDef[]
) {
  const sections = useMemo(
    () => buildResultSections(selectedItemIds, groups),
    [selectedItemIds, groups]
  );

  return { sections };
}

export type { ResultSectionDef, MockParcelAnalysisResult };
