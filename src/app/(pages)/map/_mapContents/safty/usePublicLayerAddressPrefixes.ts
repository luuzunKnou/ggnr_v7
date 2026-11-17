'use client';

import { useEffect, useState } from 'react';
import { call } from '@/lib/api';
import type { PublicLayerAddressPrefixes } from '@/lib/publicLayerSgg';

const EMPTY: PublicLayerAddressPrefixes = { sidoName: '', sggName: '' };

/** public_layer.sgg 1행 — 주소 접두(시도·시군구) 제거용 */
export function usePublicLayerAddressPrefixes(): PublicLayerAddressPrefixes {
  const [prefixes, setPrefixes] = useState<PublicLayerAddressPrefixes>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    void call('', 'POST', {
      service: 'devTestService',
      action: 'getPublicLayerAddressPrefixes',
      params: {},
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setPrefixes({
          sidoName: String(data?.sidoName ?? '').trim(),
          sggName: String(data?.sggName ?? '').trim(),
        });
      })
      .catch(() => {
        if (!cancelled) setPrefixes(EMPTY);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return prefixes;
}
