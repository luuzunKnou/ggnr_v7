'use client';

import { useCallback, useEffect, useState } from 'react';
import { call } from '@/lib/api';
import type { ConsoleAreaId, ConsoleMenuLevelSnapshot, ConsoleMenuPolicy } from '@/lib/consoleMenuAccess/types';
import { getConsoleMenuPolicy } from '@/lib/consoleMenuAccess/client';

async function fetchConsoleMenuLevels(): Promise<ConsoleMenuLevelSnapshot> {
  const res = (await call('', 'POST', {
    service: 'permissionService',
    action: 'getMyAccessSnapshot',
    params: {},
  })) as {
    success?: boolean;
    data?: { consoleMenuLevel?: ConsoleMenuLevelSnapshot };
    error?: string;
  };
  if (!res?.success || !res.data) return {};
  return res.data.consoleMenuLevel ?? {};
}

export function useConsoleMenuAccess() {
  const [levels, setLevels] = useState<ConsoleMenuLevelSnapshot>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    fetchConsoleMenuLevels()
      .then(setLevels)
      .catch(() => setLevels({}))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const getPolicy = useCallback(
    (area: ConsoleAreaId, menuId: string): ConsoleMenuPolicy => {
      return getConsoleMenuPolicy(levels, area, menuId);
    },
    [levels]
  );

  return { levels, loading, reload, getPolicy };
}
