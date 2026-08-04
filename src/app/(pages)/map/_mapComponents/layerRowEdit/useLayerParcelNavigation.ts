"use client";

import { useCallback, useState } from "react";
import { useMapContext } from "../MapContext";
import { getParcelExtent3857, fitMapToLayerRowParcel } from "./layerRowParcelUtils";
import { resolveParcelItemForHighlight } from "./resolveParcelItemForHighlight";
import type { LayerRowParcelItem } from "./types";

export function useLayerParcelNavigation(wmsLayerId?: string) {
  const mapContext = useMapContext();
  const [movingParcelIdx, setMovingParcelIdx] = useState<number | null>(null);
  const [selectedParcelIdx, setSelectedParcelIdx] = useState<number | null>(null);

  const clearSelection = useCallback(() => {
    setSelectedParcelIdx(null);
  }, []);

  const selectParcel = useCallback(
    async (
      item: LayerRowParcelItem,
      idx: number,
      options?: { onHighlight?: (resolved: LayerRowParcelItem | null) => void }
    ) => {
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;

      setSelectedParcelIdx(idx);
      setMovingParcelIdx(idx);
      try {
        const target = await resolveParcelItemForHighlight(item, wmsLayerId);
        if (!getParcelExtent3857(target) && !target.geometry3857) {
          options?.onHighlight?.(null);
          return;
        }
        options?.onHighlight?.(target);
        fitMapToLayerRowParcel(map, target, {
          wmsLayerId,
          setVisibleLayerNames: mapContext?.setVisibleLayerNames,
          applyMapViewPadding: mapContext?.applyMapViewPaddingRef?.current,
        });
      } finally {
        setMovingParcelIdx(null);
      }
    },
    [mapContext, wmsLayerId]
  );

  return {
    selectParcel,
    /** @deprecated selectParcel 사용 */
    navigateToParcel: selectParcel,
    selectedParcelIdx,
    clearSelection,
    movingParcelIdx,
  };
}
