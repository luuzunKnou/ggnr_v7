'use client';

import { useEffect, useMemo, useState } from 'react';
import { ParcelAnalysisPanel } from './ParcelAnalysisPanel';
import { useParcelAnalysis } from './parcelAnalysisContext';
import {
  STATIC_PARCEL_ANALYSIS_GROUPS,
  STATIC_PARCEL_ITEM_IDS,
} from './parcelAnalysisItems';

function filterStaticSelectedIds(ids: Set<string>): Set<string> {
  const staticSet = new Set(STATIC_PARCEL_ITEM_IDS);
  const next = new Set<string>();
  for (const id of ids) {
    if (staticSet.has(id)) next.add(id);
  }
  return next;
}

export function ParcelAnalysisMapSidePanel() {
  const {
    area,
    panelEngaged,
    analysisGroups,
    facilityCatalogLoaded,
    selectedIds,
    setSelectedIds,
    openChangeAreaModal,
    resetArea,
    handleAnalyze,
    analyzing,
    exitParcelAnalysis,
  } = useParcelAnalysis();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const areaCleared = panelEngaged && area == null;
  const itemsReady = mounted && facilityCatalogLoaded;

  const displayGroups = itemsReady ? analysisGroups : STATIC_PARCEL_ANALYSIS_GROUPS;
  const displaySelectedIds = useMemo(
    () => (itemsReady ? selectedIds : filterStaticSelectedIds(selectedIds)),
    [itemsReady, selectedIds]
  );

  return (
    <ParcelAnalysisPanel
      area={area}
      areaCleared={areaCleared}
      groups={displayGroups}
      selectedIds={displaySelectedIds}
      itemsReady={itemsReady}
      onSelectedIdsChange={setSelectedIds}
      onChangeArea={openChangeAreaModal}
      onClearArea={resetArea}
      onSpecifyArea={openChangeAreaModal}
      onAnalyze={handleAnalyze}
      analyzing={analyzing}
      onClose={exitParcelAnalysis}
    />
  );
}
