'use client';

import { useEffect, useState } from 'react';
import { call } from '@/lib/api';
import type { ParcelAnalysisRegion } from './parcelAnalysisTypes';

const EMPTY_REGION: ParcelAnalysisRegion = { sido: '', sigungu: '' };

export function useParcelAnalysisRegion(): ParcelAnalysisRegion {
  const [region, setRegion] = useState<ParcelAnalysisRegion>(EMPTY_REGION);

  useEffect(() => {
    let cancelled = false;
    call('', 'POST', {
      service: 'configService',
      action: 'getParcelAnalysisRegionFromFooter',
      params: {},
    })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setRegion({
          sido: String(data?.sido ?? '').trim(),
          sigungu: String(data?.sigungu ?? '').trim(),
        });
      })
      .catch(() => {
        if (!cancelled) setRegion(EMPTY_REGION);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return region;
}
