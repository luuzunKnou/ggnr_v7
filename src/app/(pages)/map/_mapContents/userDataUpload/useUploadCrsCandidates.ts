'use client';

import { useEffect, useMemo, useState } from 'react';
import { call } from '@/lib/api';
import { UPLOAD_CRS_OPTIONS, type UploadCrsCode } from './userDataUploadConfig';
import type { RawExtent } from './userDataUploadParse';

export type UploadCrsCandidate = { code: UploadCrsCode; overlapRatio: number };

export type UploadCrsCandidateState = {
  /** null 이면 판정하지 않음(경위도 범위·범위 없음) 또는 조회 실패 */
  candidates: UploadCrsCandidate[] | null;
  loading: boolean;
  error: string | null;
};

type Result = { key: string; candidates: UploadCrsCandidate[] | null; error: string | null };

const OPTION_CODES = new Set<string>(UPLOAD_CRS_OPTIONS.map((o) => o.code));

/** 경위도처럼 보이는 범위는 평면좌표 후보 판정 대상이 아니다 */
function isGeographic([minX, minY, maxX, maxY]: RawExtent): boolean {
  return Math.abs(minX) <= 180 && Math.abs(maxX) <= 180 && Math.abs(minY) <= 90 && Math.abs(maxY) <= 90;
}

/**
 * 원시 범위를 서버에 보내 우리 지역(읍면동 경계)과 겹치는 평면좌표계를 일치율 순으로 받는다.
 * 엑셀 컬럼을 바꿀 때마다 범위가 바뀌므로 짧게 늦춰 요청한다.
 */
export function useUploadCrsCandidates(extent: RawExtent | null): UploadCrsCandidateState {
  const key = useMemo(
    () => (extent && extent.every(Number.isFinite) && !isGeographic(extent) ? extent.join(',') : ''),
    [extent]
  );
  const [result, setResult] = useState<Result>({ key: '', candidates: null, error: null });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const [minX, minY, maxX, maxY] = key.split(',').map(Number);
    const timer = window.setTimeout(() => {
      call('', 'POST', {
        service: 'userDataUploadService',
        action: 'detectCrsCandidates',
        params: { minX, minY, maxX, maxY },
      })
        .then((res) => {
          if (cancelled) return;
          if (!res?.success) {
            setResult({ key, candidates: null, error: String(res?.error ?? '좌표계 후보를 확인하지 못했습니다.') });
            return;
          }
          const data = (res.data ?? res) as { candidates?: Array<{ epsg: number; overlapRatio: number }> };
          const candidates = (data.candidates ?? [])
            .filter((c) => OPTION_CODES.has(String(c.epsg)))
            .map((c) => ({ code: String(c.epsg) as UploadCrsCode, overlapRatio: Number(c.overlapRatio) || 0 }));
          setResult({ key, candidates, error: null });
        })
        .catch((e) => {
          if (!cancelled) {
            setResult({ key, candidates: null, error: e instanceof Error ? e.message : '좌표계 후보를 확인하지 못했습니다.' });
          }
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key]);

  if (!key) return { candidates: null, loading: false, error: null };
  if (result.key !== key) return { candidates: null, loading: true, error: null };
  return { candidates: result.candidates, loading: false, error: result.error };
}
