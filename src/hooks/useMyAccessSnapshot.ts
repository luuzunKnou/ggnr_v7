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

  const reload = useCallback(
    async (opts?: { silent?: boolean }): Promise<ClientAccessSnapshot> => {
      if (status !== 'authenticated') {
        setSnapshot(EMPTY_SNAPSHOT);
        setLoading(false);
        return EMPTY_SNAPSHOT;
      }
      if (!opts?.silent) setLoading(true);
      try {
        const next = await fetchSnapshot();
        setSnapshot(next);
        return next;
      } catch {
        setSnapshot(EMPTY_SNAPSHOT);
        return EMPTY_SNAPSHOT;
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [status]
  );

  useEffect(() => {
    if (status === 'loading') {
      setLoading(true);
      return;
    }
    void reload();
  }, [status, reload]);

  /** 탭 복귀 시 승인 반영 (전체 새로고침 없이) */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && status === 'authenticated') {
        void reload({ silent: true });
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [status, reload]);

  return { snapshot, loading, reload };
}
