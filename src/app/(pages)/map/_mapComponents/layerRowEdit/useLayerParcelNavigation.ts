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

      let ext = getParcelExtent3857(item);
      if (!ext) {
        const [resolved] = await resolveParcelGeoms([item]);
        ext = getParcelExtent3857(resolved ?? item);
      }
      if (!ext) return;

      setMovingParcelIdx(idx);
      try {
        fitMapToLayerRowParcel(map, item, {
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
