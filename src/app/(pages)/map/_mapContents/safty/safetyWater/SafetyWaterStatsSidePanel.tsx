'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { SafetyWaterStatsPanel, type StatsKindBlock } from './SafetyWaterStatsPanel';
import { useSafetyWater } from './safetyWaterContext';
import {
  convertStatsRange,
  defaultStatsRange,
  isNotFuture,
  isStatsRangeValid,
  maxRangeNotice,
  parseLocalDateTime,
  toApiRangeToken,
} from './safetyWaterTimeRange';
import type { FloodTimeType, FloodUiError, SafetyWaterStatPoint, SafetyWaterStationKind } from './safetyWaterTypes';

const UI_MSG = { ours: '연계 실패' } as const;

function parseFloodError(data: unknown): FloodUiError | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  if (o.errorClass !== 'provider' && o.errorClass !== 'ours') return null;
  return {
    errorClass: o.errorClass,
    uiMessage:
      typeof o.uiMessage === 'string' && o.uiMessage
        ? o.uiMessage
        : o.errorClass === 'provider'
          ? '현재 제공처 상태가 원활하지 않습니다.'
          : UI_MSG.ours,
    code: typeof o.code === 'number' ? o.code : undefined,
  };
}

function kindLabelOf(kind: SafetyWaterStationKind) {
  return kind === 'water' ? '수위' : '강수량';
}

export function SafetyWaterStatsSidePanel({ onClose }: { onClose: () => void }) {
  const { statsKinds, getStatsTargetStations, timeType, selectedStation, isAverageMode } =
    useSafetyWater();
  const initial = defaultStatsRange(timeType);
  const [startValue, setStartValue] = useState(initial.start);
  const [endValue, setEndValue] = useState(initial.end);
  const [itemsByKind, setItemsByKind] = useState<Partial<Record<SafetyWaterStationKind, SafetyWaterStatPoint[]>>>(
    {}
  );
  const [loadingByKind, setLoadingByKind] = useState<Partial<Record<SafetyWaterStationKind, boolean>>>({});
  const prevTimeRef = useRef<FloodTimeType>(timeType);
  const rangeRef = useRef({ start: startValue, end: endValue });
  rangeRef.current = { start: startValue, end: endValue };

  useEffect(() => {
    const prev = prevTimeRef.current;
    if (prev === timeType) return;
    const next = convertStatsRange(prev, timeType, rangeRef.current);
    prevTimeRef.current = timeType;
    setStartValue(next.start);
    setEndValue(next.end);
  }, [timeType]);

  useEffect(() => {
    if (statsKinds.length === 0) return;
    if (!isNotFuture(startValue, timeType) || !isNotFuture(endValue, timeType)) return;
    if (!isStatsRangeValid(timeType, startValue, endValue)) return;

    const startDate = parseLocalDateTime(startValue);
    const endDate = parseLocalDateTime(endValue);
    if (!startDate || !endDate) return;

    const sdt = toApiRangeToken(startDate, timeType);
    const edt = toApiRangeToken(endDate, timeType);
    let cancelled = false;

    const run = async () => {
      await Promise.all(
        statsKinds.map(async (kind) => {
          setLoadingByKind((prev) => ({ ...prev, [kind]: true }));
          try {
            const stations = getStatsTargetStations(kind);
            const res = await fetch('/api/flood/observations/stats', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                kind,
                time: timeType,
                sdt,
                edt,
                stations: stations.map((item) => ({ code: item.code })),
              }),
            });
            const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
            if (cancelled) return;
            if (!res.ok) {
              console.error('[flood] loadStats failed', parseFloodError(j));
              setItemsByKind((prev) => ({ ...prev, [kind]: [] }));
              return;
            }
            setItemsByKind((prev) => ({
              ...prev,
              [kind]: Array.isArray(j.items) ? (j.items as SafetyWaterStatPoint[]) : [],
            }));
          } catch (e) {
            if (cancelled) return;
            console.error('[flood] loadStats failed', e);
            setItemsByKind((prev) => ({ ...prev, [kind]: [] }));
          } finally {
            if (!cancelled) setLoadingByKind((prev) => ({ ...prev, [kind]: false }));
          }
        })
      );
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [statsKinds, startValue, endValue, timeType, getStatsTargetStations]);

  const applyRange = useCallback((nextStart: string, nextEnd: string) => {
    setStartValue(nextStart);
    setEndValue(nextEnd);
  }, []);

  const blocks: StatsKindBlock[] = useMemo(
    () =>
      statsKinds.map((kind) => ({
        kind,
        kindLabel: kindLabelOf(kind),
        items: itemsByKind[kind] ?? [],
        loading: !!loadingByKind[kind],
      })),
    [statsKinds, itemsByKind, loadingByKind]
  );

  const waterThresholds = useMemo(() => {
    if (isAverageMode) return null;
    if (!selectedStation || selectedStation.kind !== 'water') return null;
    if (!statsKinds.includes('water')) return null;
    return {
      gdt: selectedStation.gdt ?? null,
      attwl: selectedStation.attwl ?? null,
      wrnwl: selectedStation.wrnwl ?? null,
      almwl: selectedStation.almwl ?? null,
      srswl: selectedStation.srswl ?? null,
      pfh: selectedStation.pfh ?? null,
    };
  }, [isAverageMode, selectedStation, statsKinds]);

  if (statsKinds.length === 0) return null;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden opacity-[0.98]">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-gradient-to-b from-primary/5 to-background px-4 py-3">
        <h2 className="min-w-0 text-[15px] font-semibold leading-tight text-foreground">기간별 현황</h2>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-muted hover:text-muted-foreground"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/30 p-3">
        <SafetyWaterStatsPanel
          blocks={blocks}
          timeType={timeType}
          startValue={startValue}
          endValue={endValue}
          rangeNotice={maxRangeNotice(timeType)}
          onChangeStart={(value) => applyRange(value, endValue)}
          onChangeEnd={(value) => applyRange(startValue, value)}
          onApplyRange={applyRange}
          waterThresholds={waterThresholds}
        />
      </div>
    </div>
  );
}
