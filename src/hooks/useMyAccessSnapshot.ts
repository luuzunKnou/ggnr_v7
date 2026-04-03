'use client';

import { useCallback, useEffect, useState } from 'react';
import { call } from '@/lib/api';
import type { ClientAccessSnapshot } from '@/lib/accessClient';

async function fetchSnapshot(): Promise<ClientAccessSnapshot> {
  const res = (await call('', 'POST', {
    service: 'permissionService',
    action: 'getMyAccessSnapshot',
    params: {},
  })) as { success?: boolean; data?: ClientAccessSnapshot; error?: string };
  if (!res?.success || !res.data) {
    return { privateSerLevel: {}, privateSysKeys: [] };
  }
  return {
    privateSerLevel: res.data.privateSerLevel ?? {},
    privateSysKeys: Array.isArray(res.data.privateSysKeys) ? res.data.privateSysKeys : [],
  };
}

export function useMyAccessSnapshot() {
  const [snapshot, setSnapshot] = useState<ClientAccessSnapshot>({
    privateSerLevel: {},
    privateSysKeys: [],
  });
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    fetchSnapshot()
      .then(setSnapshot)
      .catch(() => setSnapshot({ privateSerLevel: {}, privateSysKeys: [] }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { snapshot, loading, reload };
}
