'use client';

import { useEffect, useMemo, useState } from 'react';
import { call } from '@/lib/api';
import { buildUndergroundFacilityLayerGroups } from '../layerFactory/undergroundFacilityLayerFactory';
import type {
  ThematicMapLayerGroup,
  ThematicMapLayerOption,
} from '../layerFactory/thematicMapLayerFactory';

export type UndergroundFacilityCatalog = {
  loading: boolean;
  groups: ThematicMapLayerGroup[];
  layers: ThematicMapLayerOption[];
  availableLayerTableNames: Set<string>;
};

/**
 * 서버에서 layer 스키마 부모 존재·분할 조건 데이터 유무를 조회한 뒤 지하시설물 목록을 구성.
 */
export function useUndergroundFacilityCatalog(): UndergroundFacilityCatalog {
  const [loading, setLoading] = useState(true);
  const [layersWithData, setLayersWithData] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    call('', 'POST', {
      service: 'thematicMapService',
      action: 'listAvailableUndergroundFacilityLayerNames',
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

  const groups = useMemo(() => {
    if (layersWithData == null) return [];
    return buildUndergroundFacilityLayerGroups(null, layersWithData);
  }, [layersWithData]);

  const layers = useMemo(() => groups.flatMap((g) => g.layers), [groups]);

  const availableLayerTableNames = useMemo(
    () => new Set(layers.map((l) => l.tableName)),
    [layers]
  );

  return {
    loading,
    groups,
    layers,
    availableLayerTableNames,
  };
}
