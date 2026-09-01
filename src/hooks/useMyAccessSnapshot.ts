'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { call } from '@/lib/api';
import type { ClientAccessSnapshot } from '@/lib/accessClient';

const EMPTY_SNAPSHOT: ClientAccessSnapshot = {
  privateSerLevel: {},
  privateSysKeys: [],
};

async function fetchSnapshot(): Promise<ClientAccessSnapshot> {
  const res = (await call('', 'POST', {
    service: 'permissionService',
    action: 'getMyAccessSnapshot',
    params: {},
  })) as { success?: boolean; data?: ClientAccessSnapshot; error?: string };
  if (!res?.success || !res.data) {
    return EMPTY_SNAPSHOT;
  }
  return {
    privateSerLevel: res.data.privateSerLevel ?? {},
    privateSysKeys: Array.isArray(res.data.privateSysKeys) ? res.data.privateSysKeys : [],
  };
}

export function useMyAccessSnapshot() {
  const { status } = useSession();
  const [snapshot, setSnapshot] = useState<ClientAccessSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    if (status !== 'authenticated') {
      setSnapshot(EMPTY_SNAPSHOT);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchSnapshot()
      .then(setSnapshot)
      .catch(() => setSnapshot(EMPTY_SNAPSHOT))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => {
    if (status === 'loading') {
      setLoading(true);
      return;
    }
    reload();
  }, [status, reload]);

  return { snapshot, loading, reload };
}
