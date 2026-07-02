'use client';

import { useMemo } from 'react';
import { useParcelAnalysis } from './parcelAnalysisContext';
import { useParcelAnalysisResultSections } from './useParcelAnalysisResultSections';
import { ParcelAnalysisMethodModal } from './ParcelAnalysisMethodModal';
import {
  ParcelAnalysisAnalyzingModal,
  ParcelAnalysisResultModal,
} from './ParcelAnalysisResultModal';

export function ParcelAnalysisOrchestrator() {
  const {
    isOpen,
    area,
    panelEngaged,
    modalOpen,
    modalStep,
    boundarySessionDraft,
    setBoundarySessionDraft,
    selectedIds,
    analyzing,
    drawerOpen,
    setDrawerOpen,
    setModalStep,
    exitParcelAnalysis,
    closeAreaModal,
    handleApplyDraw,
    handleApplyBoundary,
  } = useParcelAnalysis();

  const selectedIdList = useMemo(() => [...selectedIds], [selectedIds]);
  const { sections, mockResult } = useParcelAnalysisResultSections(selectedIdList);

  if (!isOpen) return null;

  return (
    <>
      <ParcelAnalysisMethodModal
        open={modalOpen}
        step={modalStep}
        hasConfirmedArea={area != null || panelEngaged}
        boundarySessionDraft={boundarySessionDraft}
        onBoundarySessionDraftChange={setBoundarySessionDraft}
        onStepChange={setModalStep}
        onClose={exitParcelAnalysis}
        onDismiss={closeAreaModal}
        onApplyDraw={handleApplyDraw}
        onApplyBoundary={handleApplyBoundary}
      />

      <ParcelAnalysisAnalyzingModal open={analyzing} />

      <ParcelAnalysisResultModal
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sections={sections}
        mockResult={mockResult}
        areaSummary={area?.summaryLabel}
      />
    </>
  );
}
