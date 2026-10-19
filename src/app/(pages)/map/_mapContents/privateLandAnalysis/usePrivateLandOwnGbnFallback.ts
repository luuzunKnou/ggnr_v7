'use client';

import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { ownGbnLabel } from '@/lib/privateLandAnalysisLayers';
import { fetchLandInfoConfig, fetchVworldOwnGbnBatch } from '@/lib/vworldParcelLandClient';
import type { PrivateLandParcel } from './PrivateLandAnalysisContext';

const UNKNOWN = '미상';

function applyFound(rows: PrivateLandParcel[], found: Map<string, string>): PrivateLandParcel[] {
  let changed = false;
  const next = rows.map((p) => {
    const hit = p.kind === 'parcel' && p.ownGbn === UNKNOWN ? found.get(p.pnu) : undefined;
    if (!hit) return p;
    changed = true;
    return { ...p, ownGbn: hit };
  });
  return changed ? next : rows;
}

/** 지적에 소유구분이 없어 미상인 필지 — 토지소유내역과 같은 브이월드 조회로 채운다 */
export function usePrivateLandOwnGbnFallback(
  parcels: PrivateLandParcel[],
  setParcels: Dispatch<SetStateAction<PrivateLandParcel[]>>
) {
  /** pnu → 소유구분 이름 (조회했으나 없으면 빈 문자열) */
  const cacheRef = useRef(new Map<string, string>());

  useEffect(() => {
    const cache = cacheRef.current;
    const unknown = parcels.filter((p) => p.kind === 'parcel' && p.ownGbn === UNKNOWN && p.pnu).map((p) => p.pnu);
    if (!unknown.length) return;
    if (unknown.some((pnu) => cache.get(pnu))) {
      setParcels((prev) => applyFound(prev, cache));
    }
    const pending = unknown.filter((pnu) => !cache.has(pnu));
    if (!pending.length) return;

    let alive = true;
    void (async () => {
      try {
        const cfg = await fetchLandInfoConfig();
        if (!alive || !cfg.vworldKey) return;
        const found = await fetchVworldOwnGbnBatch(pending, cfg.vworldKey);
        for (const pnu of pending) cache.set(pnu, found[pnu] ? ownGbnLabel(found[pnu]) : '');
        if (alive) setParcels((prev) => applyFound(prev, cache));
      } catch {
        /* 조회 실패 시 미상 유지 — 다음 분석에서 다시 시도 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [parcels, setParcels]);
}
