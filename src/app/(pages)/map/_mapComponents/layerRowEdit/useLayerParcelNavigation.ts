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
      options?: {
        onHighlight?: (resolved: LayerRowParcelItem | null) => void;
        /** false면 필지/물건지 WMS 전체를 켜지 않음 (선택 도형 하이라이트만) */
        enableWmsLayer?: boolean;
        /** true면 주소/키로 geom 재조회하지 않고 item 도형을 그대로 씀 */
        useItemGeometry?: boolean;
      }
    ) => {
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;

      setSelectedParcelIdx(idx);
      setMovingParcelIdx(idx);
      try {
        const target = options?.useItemGeometry
          ? item
          : await resolveParcelItemForHighlight(item, wmsLayerId);
        if (!getParcelExtent3857(target) && !target.geometry3857) {
          options?.onHighlight?.(null);
          return;
        }
        options?.onHighlight?.(target);
        fitMapToLayerRowParcel(map, target, {
          wmsLayerId,
          setVisibleLayerNames: mapContext?.setVisibleLayerNames,
          applyMapViewPadding: mapContext?.applyMapViewPaddingRef?.current,
          enableWmsLayer: options?.enableWmsLayer,
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
