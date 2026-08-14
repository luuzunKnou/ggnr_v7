'use client';

import { useEffect, useMemo, useState } from 'react';
import { call } from '@/lib/api';
import { CADASTRAL_LAYERS } from '../layerFactory/boundaryLayerFactory';

export type CadastralCatalog = {
  loading: boolean;
  layers: typeof CADASTRAL_LAYERS;
  availableLayerTableNames: Set<string>;
};

/**
 * DB에 행이 있는 지적도(jijuk·ri·emd)만 목록에 올린다.
 */
export function useCadastralCatalog(): CadastralCatalog {
  const [loading, setLoading] = useState(true);
  const [layersWithData, setLayersWithData] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    call('', 'POST', {
      service: 'thematicMapService',
      action: 'listAvailableCadastralLayerNames',
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
    const defined = new Set(CADASTRAL_LAYERS.map((l) => l.tableName));
    return new Set([...defined].filter((t) => layersWithData.has(t)));
  }, [layersWithData]);

  const layers = useMemo(
    () => CADASTRAL_LAYERS.filter((l) => availableLayerTableNames.has(l.tableName)),
    [availableLayerTableNames]
  );

  return {
    loading,
    layers,
    availableLayerTableNames,
  };
}
