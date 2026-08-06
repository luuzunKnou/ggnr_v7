'use client';

import { useEffect, useMemo, useState } from 'react';
import { call } from '@/lib/api';
import {
  BUILDING_ROAD_LAYERS,
  BUILDING_ROAD_DEFINED_TABLE_NAMES,
} from '../layerFactory/boundaryLayerFactory';

export type BuildingRoadCatalog = {
  loading: boolean;
  layers: typeof BUILDING_ROAD_LAYERS;
  availableLayerTableNames: Set<string>;
};

/**
 * tables.json 등록 + DB public_layer에 데이터가 있는 건물·도로만 목록에 올린다.
 */
export function useBuildingRoadCatalog(): BuildingRoadCatalog {
  const [loading, setLoading] = useState(true);
  const [layersWithData, setLayersWithData] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    call('', 'POST', {
      service: 'thematicMapService',
      action: 'listAvailableBuildingRoadLayerNames',
      params: {},
    })
      .then(
        (res: {
          data?: { success?: boolean; tableNames?: string[] };
          success?: boolean;
          tableNames?: string[];
        }) => {
          if (cancelled) return;
          const data = res?.data ?? res;
          const names = Array.isArray(data?.tableNames) ? data.tableNames : [];
          setLayersWithData(
            new Set(names.map((n) => String(n ?? '').trim()).filter(Boolean))
          );
        }
      )
      .catch(() => {
        if (!cancelled) setLayersWithData(new Set());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const availableLayerTableNames = useMemo(() => {
    if (layersWithData == null) return new Set<string>();
    return new Set(
      [...BUILDING_ROAD_DEFINED_TABLE_NAMES].filter((t) => layersWithData.has(t))
    );
  }, [layersWithData]);

  const layers = useMemo(
    () => BUILDING_ROAD_LAYERS.filter((l) => availableLayerTableNames.has(l.tableName)),
    [availableLayerTableNames]
  );

  return {
    loading,
    layers,
    availableLayerTableNames,
  };
}
