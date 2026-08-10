'use client';

import { useMapContext } from '../../_mapComponents/MapContext';

/** 식별용 singleclick 브릿지와 배타 — 측정·도형 Draw 중이면 true */
export function useMapSplitDrawInteractionActive(): boolean {
  const mapContext = useMapContext();
  return (
    Boolean(mapContext?.measurementActive) ||
    Boolean(mapContext?.spatialDrawRequest) ||
    Boolean(mapContext?.layerRowGeomEdit)
  );
}
