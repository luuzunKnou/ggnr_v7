'use client';

import { ParcelAnalysisPanel } from './ParcelAnalysisPanel';
import { useParcelAnalysis } from './parcelAnalysisContext';

export function ParcelAnalysisMapSidePanel() {
  const {
    area,
    panelEngaged,
    selectedIds,
    setSelectedIds,
    openChangeAreaModal,
    resetArea,
    handleAnalyze,
    analyzing,
  } = useParcelAnalysis();

  const areaCleared = panelEngaged && area == null;

  return (
    <ParcelAnalysisPanel
      area={area}
      areaCleared={areaCleared}
      selectedIds={selectedIds}
      onSelectedIdsChange={setSelectedIds}
      onChangeArea={openChangeAreaModal}
      onClearArea={resetArea}
      onSpecifyArea={openChangeAreaModal}
      onAnalyze={handleAnalyze}
      analyzing={analyzing}
    />
  );
}
