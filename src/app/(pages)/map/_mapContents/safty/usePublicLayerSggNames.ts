'use client';

import { useEffect, useState } from 'react';
import { call } from '@/lib/api';

/** public_layer.sgg sgg_nm — 주소 접두 제거용 */
export function usePublicLayerSggNames(): string[] {
  const [sggNames, setSggNames] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void call('', 'POST', {
      service: 'devTestService',
      action: 'getPublicLayerSggNames',
      params: {},
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setSggNames(Array.isArray(data?.names) ? data.names.map(String) : []);
      })
      .catch(() => {
        if (!cancelled) setSggNames([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return sggNames;
}
