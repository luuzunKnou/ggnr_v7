'use client';

import { useCallback, useState } from 'react';
import {
  BUILDING_ROAD_LAYERS,
} from '../../map/_mapComponents/layerFactory/boundaryLayerFactory';
import { JIMOK_LAYERS } from '../../map/_mapComponents/layerFactory/jimokLayerFactory';
import { LANDOWN_LAYERS } from '../../map/_mapComponents/layerFactory/landownLayerFactory';

/** OpenLayersMap MULTI_SELECT_IDS 중 도형편집기 상단바에 노출할 항목 */
export const SHAPE_EDITOR_OVERLAY_CONTROLS = [
  { id: 'building-road', label: '건물도로' },
  { id: 'thematic-map', label: '주제도' },
  { id: 'land-category', label: '지목' },
  { id: 'ownership', label: '소유구분' },
  { id: 'official-land-price', label: '공시지가' },
] as const;

export type ShapeEditorOverlayControlId = (typeof SHAPE_EDITOR_OVERLAY_CONTROLS)[number]['id'];

export function useShapeEditorOverlayControls() {
  const [activeControls, setActiveControls] = useState<string[]>([]);
  const [visibleJimokLayerNames, setVisibleJimokLayerNames] = useState<Set<string> | null>(null);
  const [visibleLandownLayerNames, setVisibleLandownLayerNames] = useState<Set<string> | null>(
    null
  );
  const [visibleBuildingRoadLayerNames, setVisibleBuildingRoadLayerNames] = useState<
    Set<string> | null
  >(null);

  const toggleControl = useCallback((id: ShapeEditorOverlayControlId) => {
    setActiveControls((prev) => {
      const isActive = prev.includes(id);
      if (isActive) return prev.filter((item) => item !== id);

      if (id === 'land-category') {
        setVisibleJimokLayerNames((v) =>
          v != null && v.size > 0 ? v : new Set(JIMOK_LAYERS.map((l) => l.tableName))
        );
      } else if (id === 'ownership') {
        setVisibleLandownLayerNames((v) =>
          v != null && v.size > 0 ? v : new Set(LANDOWN_LAYERS.map((l) => l.tableName))
        );
      } else if (id === 'building-road') {
        setVisibleBuildingRoadLayerNames((v) =>
          v != null && v.size > 0 ? v : new Set(BUILDING_ROAD_LAYERS.map((l) => l.tableName))
        );
      }

      return [...prev, id];
    });
  }, []);

  const isActive = useCallback(
    (id: ShapeEditorOverlayControlId) => activeControls.includes(id),
    [activeControls]
  );

  return {
    activeControls,
    visibleJimokLayerNames,
    visibleLandownLayerNames,
    visibleBuildingRoadLayerNames,
    toggleControl,
    isActive,
  };
}

export type ShapeEditorOverlayControls = ReturnType<typeof useShapeEditorOverlayControls>;
