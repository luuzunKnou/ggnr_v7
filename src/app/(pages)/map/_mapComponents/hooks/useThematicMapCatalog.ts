'use client';

import { useEffect, useMemo, useState } from 'react';
import { call } from '@/lib/api';
import {
  buildThematicMapLayerGroups,
  type ThematicMapLayerGroup,
  type ThematicMapLayerOption,
} from '../layerFactory/thematicMapLayerFactory';

export type ThematicMapCatalog = {
  loading: boolean;
  /** 부모 존재 + 분할 조건에 실제 행이 있는 자식(또는 비분할)만 */
  groups: ThematicMapLayerGroup[];
  layers: ThematicMapLayerOption[];
  /** 주제도에 노출 가능한 define 테이블명 */
  availableLayerTableNames: Set<string>;
};

/**
 * 서버에서 부모 테이블 존재·분할 조건 데이터 유무를 조회한 뒤 주제도 목록을 구성.
 * 정의만 있고 피처가 없는 분할 자식은 목록에 나오지 않음.
 */
export function useThematicMapCatalog(): ThematicMapCatalog {
  const [loading, setLoading] = useState(true);
  const [layersWithData, setLayersWithData] = useState<Set<string> | null>(null);
  const [legendColors, setLegendColors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    call('', 'POST', {
      service: 'thematicMapService',
      action: 'listAvailableThematicMapLayerNames',
      params: {},
    })
      .then(
        (res: {
          data?: {
            success?: boolean;
            tableNames?: string[];
            legendColors?: Record<string, string>;
          };
          success?: boolean;
          tableNames?: string[];
          legendColors?: Record<string, string>;
        }) => {
          if (cancelled) return;
          const data = res?.data ?? res;
          const names = Array.isArray(data?.tableNames) ? data.tableNames : [];
          setLayersWithData(
            new Set(names.map((n) => String(n ?? '').trim()).filter(Boolean))
          );
          const colors = data?.legendColors;
          setLegendColors(
            colors && typeof colors === 'object' && !Array.isArray(colors) ? colors : {}
          );
        }
      )
      .catch(() => {
        if (!cancelled) {
          setLayersWithData(new Set());
          setLegendColors({});
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
    if (layersWithData == null) return [];
    return buildThematicMapLayerGroups(null, layersWithData, legendColors);
  }, [layersWithData, legendColors]);

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
