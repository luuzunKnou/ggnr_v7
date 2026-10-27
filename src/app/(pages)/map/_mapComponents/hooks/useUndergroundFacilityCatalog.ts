'use client';

import { useEffect, useMemo, useState } from 'react';
import { call } from '@/lib/api';
import { sortLayersByDefineIdx } from '@/lib/defineTableOrder';
import { buildUndergroundFacilityLayerGroups } from '../layerFactory/undergroundFacilityLayerFactory';
import type {
  ThematicMapLayerGroup,
  ThematicMapLayerOption,
} from '../layerFactory/thematicMapLayerFactory';

type DefineTableRow = {
  define_table_name?: string;
  define_table_kor_name?: string;
  define_table_group?: string;
  define_table_schema?: string;
  define_table_parents_layer?: string;
  define_table_div_query?: string;
};

export type UndergroundFacilityCatalog = {
  loading: boolean;
  groups: ThematicMapLayerGroup[];
  layers: ThematicMapLayerOption[];
  availableLayerTableNames: Set<string>;
};

/**
 * 서버에서 layer 스키마 부모 존재·분할 조건 데이터 유무 + 프로젝트 분할 merge 정의를 조회한 뒤 목록 구성.
 */
export function useUndergroundFacilityCatalog(): UndergroundFacilityCatalog {
  const [loading, setLoading] = useState(true);
  const [layersWithData, setLayersWithData] = useState<Set<string> | null>(null);
  const [defineTables, setDefineTables] = useState<DefineTableRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      call('', 'POST', {
        service: 'thematicMapService',
        action: 'listAvailableUndergroundFacilityLayerNames',
        params: {},
      }),
      call('', 'POST', {
        service: 'devTestService',
        action: 'getDefineLayerTables',
        params: {},
      }),
    ])
      .then(([availRes, tablesRes]) => {
        if (cancelled) return;
        const avail = (availRes?.data ?? availRes) as {
          success?: boolean;
          tableNames?: string[];
        };
        const names = Array.isArray(avail?.tableNames) ? avail.tableNames : [];
        setLayersWithData(new Set(names.map((n) => String(n ?? '').trim()).filter(Boolean)));

        const tablesData = (tablesRes?.data ?? tablesRes) as {
          success?: boolean;
          tables?: DefineTableRow[];
        };
        setDefineTables(
          tablesData?.success && Array.isArray(tablesData.tables) ? tablesData.tables : []
        );
      })
      .catch(() => {
        if (!cancelled) {
          setLayersWithData(new Set());
          setDefineTables([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => {
    if (layersWithData == null || defineTables == null) return [];
    return buildUndergroundFacilityLayerGroups(null, layersWithData, defineTables).map((group) => ({
      ...group,
      layers: sortLayersByDefineIdx(group.layers),
    }));
  }, [layersWithData, defineTables]);

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
