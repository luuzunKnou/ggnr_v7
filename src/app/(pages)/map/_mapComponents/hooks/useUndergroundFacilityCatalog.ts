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
  define_table_idx?: string | number;
};

type SysRow = { sys_key?: string; layerGroupList?: string[] };

export type UndergroundFacilityCatalog = {
  loading: boolean;
  groups: ThematicMapLayerGroup[];
  layers: ThematicMapLayerOption[];
  availableLayerTableNames: Set<string>;
};

/**
 * 서버에서 layer 스키마 부모 존재·분할 조건 데이터 유무 + 프로젝트 분할 merge 정의를 조회한 뒤 목록 구성.
 * 현재 시스템 layerGroupList에 맞춰 그룹을 필터(데이터 조회와 동일: 미소속은 공통, 할당 그룹은 현재 시스템만).
 */
export function useUndergroundFacilityCatalog(systemKey = ''): UndergroundFacilityCatalog {
  const [loading, setLoading] = useState(true);
  const [layersWithData, setLayersWithData] = useState<Set<string> | null>(null);
  const [defineTables, setDefineTables] = useState<DefineTableRow[] | null>(null);
  const [allSystems, setAllSystems] = useState<SysRow[] | null>(null);
  const [enabledSystems, setEnabledSystems] = useState<SysRow[] | null>(null);

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
      call('', 'POST', {
        service: 'configService',
        action: 'getSystemListAll',
        params: {},
      }),
      call('', 'POST', {
        service: 'configService',
        action: 'getSystemList',
        params: {},
      }),
    ])
      .then(([availRes, tablesRes, sysAllRes, sysEnabledRes]) => {
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
        const rows = Array.isArray(tablesData?.tables)
          ? tablesData.tables
          : Array.isArray(tablesData)
            ? (tablesData as DefineTableRow[])
            : [];
        setDefineTables(rows);

        const allSys: SysRow[] = Array.isArray((sysAllRes?.data ?? sysAllRes)?.systems)
          ? ((sysAllRes?.data ?? sysAllRes).systems as SysRow[])
          : [];
        const enabledSys: SysRow[] = Array.isArray((sysEnabledRes?.data ?? sysEnabledRes)?.systems)
          ? ((sysEnabledRes?.data ?? sysEnabledRes).systems as SysRow[])
          : [];
        setAllSystems(allSys);
        setEnabledSystems(enabledSys);
      })
      .catch(() => {
        if (!cancelled) {
          setLayersWithData(new Set());
          setDefineTables([]);
          setAllSystems([]);
          setEnabledSystems([]);
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
    if (layersWithData == null || defineTables == null || allSystems == null || enabledSystems == null) {
      return [];
    }

    const assignedGroups = new Set<string>();
    for (const s of [...allSystems, ...enabledSystems]) {
      for (const g of Array.isArray(s.layerGroupList) ? s.layerGroupList : []) {
        const name = String(g ?? '').trim();
        if (name) assignedGroups.add(name);
      }
    }

    const currentKey = systemKey.trim().toLowerCase();
    const currentSys =
      enabledSystems.find((s) => String(s.sys_key ?? '').trim().toLowerCase() === currentKey) ??
      allSystems.find((s) => String(s.sys_key ?? '').trim().toLowerCase() === currentKey);
    const currentSystemGroups = new Set(
      (Array.isArray(currentSys?.layerGroupList) ? currentSys!.layerGroupList! : [])
        .map((g) => String(g ?? '').trim())
        .filter(Boolean)
    );

    const isGroupVisible = (groupName: string) => {
      if (!currentKey) return true;
      if (!assignedGroups.has(groupName)) return true;
      return currentSystemGroups.has(groupName);
    };

    return buildUndergroundFacilityLayerGroups(null, layersWithData, defineTables)
      .filter((group) => isGroupVisible(String(group.title ?? '').trim()))
      .map((group) => ({
        ...group,
        layers: sortLayersByDefineIdx(group.layers),
      }));
  }, [layersWithData, defineTables, allSystems, enabledSystems, systemKey]);

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
