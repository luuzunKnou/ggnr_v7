'use client';

import { useEffect, useState } from 'react';
import { call } from '@/lib/api';
import type { ParcelAnalysisRegion } from './parcelAnalysisTypes';

const EMPTY_REGION: ParcelAnalysisRegion = { sido: '', sigungu: '' };
const REGION_TIMEOUT_MS = 12_000;

export function useParcelAnalysisRegion(): ParcelAnalysisRegion {
  const [region, setRegion] = useState<ParcelAnalysisRegion>(EMPTY_REGION);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REGION_TIMEOUT_MS);

    call(
      '',
      'POST',
      {
        service: 'configService',
        action: 'getParcelAnalysisRegionFromFooter',
        params: {},
      },
      { signal: controller.signal }
    )
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
      })
      .finally(() => {
        window.clearTimeout(timer);
      });

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);

  return region;
}
