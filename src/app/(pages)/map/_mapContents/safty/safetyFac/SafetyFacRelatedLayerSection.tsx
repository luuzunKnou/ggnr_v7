'use client';

import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useMapContext } from '../../../_mapComponents/MapContext';
import type { SafetyFacRelatedBuildingResult } from '@/service/standardService';
import {
  SAFETY_FAC_RELATED_LAYER_DEFS,
  buildSafetyFacRelatedLayerCqlMap,
} from './safetyFacRelatedBuildingConfig';

type Props = {
  lon: number | undefined;
  lat: number | undefined;
};

/** 도로대장 상세 RoadLedgerDocActionGrid 와 동일 토글칩 */
export function SafetyFacRelatedLayerSection({ lon, lat }: Props) {
  const mapContext = useMapContext();
  const setLayerState = mapContext?.setSafetyFacBuildingRoadLayerState;

  const [result, setResult] = useState<SafetyFacRelatedBuildingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTables, setActiveTables] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (lon == null || lat == null) return;
    let cancelled = false;
    setLoading(true);
    setResult(null);
    setActiveTables(new Set());
    void fetch(`/api/safety-fac/related-buildings?lon=${lon}&lat=${lat}`)
      .then((r) => r.json())
      .then((json: { data?: SafetyFacRelatedBuildingResult }) => {
        if (!cancelled) setResult(json.data ?? null);
      })
      .catch(() => {
        if (!cancelled) setResult(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lon, lat]);

  /** 조회 완료 시 건수 > 0 레이어 기본 ON */
  useEffect(() => {
    if (!result) {
      setActiveTables(new Set());
      return;
    }
    const next = new Set<string>();
    for (const def of SAFETY_FAC_RELATED_LAYER_DEFS) {
      if ((result[def.key] ?? 0) > 0) next.add(def.tableName);
    }
    setActiveTables(next);
  }, [result]);

  useEffect(() => {
    if (!setLayerState) return;
    if (!result || activeTables.size === 0) {
      setLayerState(null);
      return;
    }
    setLayerState({
      visibleTableNames: new Set(activeTables),
      cqlByTable: buildSafetyFacRelatedLayerCqlMap(result, activeTables),
    });
  }, [result, activeTables, setLayerState]);

  useEffect(() => {
    return () => {
      setLayerState?.(null);
    };
  }, [setLayerState, lon, lat]);

  const toggleTable = useCallback((tableName: string, count: number) => {
    if (count <= 0 || !setLayerState) return;
    setActiveTables((prev) => {
      const next = new Set(prev);
      if (next.has(tableName)) next.delete(tableName);
      else next.add(tableName);
      return next;
    });
  }, [setLayerState]);

  if (lon == null || lat == null) return null;

  return (
    <div className="grid grid-cols-4 gap-1.5">
      {SAFETY_FAC_RELATED_LAYER_DEFS.map(({ key, tableName, label }) => {
        const count = result?.[key] ?? 0;
        const hasData = count > 0;
        const active = hasData && activeTables.has(tableName);
        const displayLabel = `${label} (${loading ? '…' : count})`;

        return (
          <button
            key={tableName}
            type="button"
            title={
              hasData
                ? '클릭: 해당 공간정보 레이어 켜기 / 다시 클릭: 끄기'
                : '해당 없음'
            }
            onClick={() => toggleTable(tableName, count)}
            disabled={!hasData || !setLayerState}
            className={cn(
              'inline-flex h-auto min-h-[24px] min-w-0 items-center justify-center rounded border px-0.5 py-1 text-[9px] leading-tight',
              !hasData || !setLayerState
                ? 'pointer-events-none border-slate-200 bg-slate-50/80 text-slate-500 opacity-60'
                : active
                  ? 'border-primary/45 bg-primary/[0.08] text-slate-800 ring-1 ring-inset ring-primary/15 hover:bg-primary/[0.11]'
                  : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'
            )}
          >
            <span className="whitespace-nowrap text-center">
              {displayLabel}
            </span>
          </button>
        );
      })}
    </div>
  );
}
