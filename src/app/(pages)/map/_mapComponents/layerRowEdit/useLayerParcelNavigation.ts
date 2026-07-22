"use client";

import { useCallback, useState } from "react";
import { useMapContext } from "../MapContext";
import { getParcelExtent3857, fitMapToLayerRowParcel } from "./layerRowParcelUtils";
import { resolveParcelGeoms } from "./resolveParcelGeoms";
import type { LayerRowParcelItem } from "./types";

export function useLayerParcelNavigation(wmsLayerId?: string) {
  const mapContext = useMapContext();
  const [movingParcelIdx, setMovingParcelIdx] = useState<number | null>(null);

  const navigateToParcel = useCallback(
    async (item: LayerRowParcelItem, idx: number) => {
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;

      let target = item;
      if (!getParcelExtent3857(item)) {
        const [resolved] = await resolveParcelGeoms([item]);
        if (resolved) target = resolved;
      }
      if (!getParcelExtent3857(target)) return;

      setMovingParcelIdx(idx);
      try {
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

  return { navigateToParcel, movingParcelIdx };
}
