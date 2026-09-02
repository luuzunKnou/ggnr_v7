'use client';

import { useEffect, useState } from 'react';
import {
  selectDefineLayerListFields,
  type DefineFieldLike,
} from '../../_mapComponents/standard/defineLayerRowUtils';

type ApiFieldsResponse = {
  success?: boolean;
  data?: DefineFieldLike[];
};

export function useSafetyLayerListColumns(tableName: string) {
  const [columns, setColumns] = useState<DefineFieldLike[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetch(`/api/config/defineLayer/fields/${encodeURIComponent(tableName)}`)
      .then((r) => r.json() as Promise<ApiFieldsResponse | DefineFieldLike[]>)
      .then((body) => {
        if (cancelled) return;
        const raw = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
        setColumns(selectDefineLayerListFields(raw));
      })
      .catch(() => {
        if (!cancelled) setColumns([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tableName]);

  return { columns, columnsLoading: loading };
}
