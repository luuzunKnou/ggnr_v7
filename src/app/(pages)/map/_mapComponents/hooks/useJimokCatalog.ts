'use client';

import { useEffect, useMemo, useState } from 'react';
import { call } from '@/lib/api';
import { JIMOK_LAYERS } from '../layerFactory/jimokLayerFactory';

export type JimokCatalog = {
  loading: boolean;
  layers: typeof JIMOK_LAYERS;
  availableLayerTableNames: Set<string>;
};

/**
 * tables.json «지목» 등록 + DB에 데이터가 있는 항목만 목록에 올린다.
 */
export function useJimokCatalog(): JimokCatalog {
  const [loading, setLoading] = useState(true);
  const [layersWithData, setLayersWithData] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    call('', 'POST', {
      service: 'thematicMapService',
      action: 'listAvailableJimokLayerNames',
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
      JIMOK_LAYERS.map((l) => l.tableName).filter((t) => layersWithData.has(t))
    );
  }, [layersWithData]);

  const layers = useMemo(
    () => JIMOK_LAYERS.filter((l) => availableLayerTableNames.has(l.tableName)),
    [availableLayerTableNames]
  );

  return {
    loading,
    layers,
    availableLayerTableNames,
  };
}
