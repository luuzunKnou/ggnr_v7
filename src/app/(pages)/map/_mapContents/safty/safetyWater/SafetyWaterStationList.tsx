'use client';

import { Cctv } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  WATER_STATUS_HEX,
  WATER_STATUS_ICON,
  type WaterStatusLevel,
} from './safetyWaterStatus';
import type { SafetyWaterStation } from './safetyWaterTypes';

type Props = {
  stations: SafetyWaterStation[];
  selectedId: string | null;
  /** null = 전체 */
  onSelect: (id: string | null) => void;
  searchText?: string;
  selectedKinds?: SafetyWaterStation['kind'][];
  className?: string;
  /** true면 500m 내 CCTV 있는 관측소만 */
  cctvOnly?: boolean;
  /** 500m 내 CCTV 있는 관측소 id */
  cctvStationIds?: Set<string>;
  /** 수위 관측소 id → 기준수위 대비 현재 상태 */
  waterStatusById?: Record<string, WaterStatusLevel>;
};

function kindLabel(kind: SafetyWaterStation['kind']) {
  return kind === 'water' ? '수위' : '강수량';
}

function kindBadgeClass(kind: SafetyWaterStation['kind']) {
  return kind === 'water'
    ? 'bg-[#3B8DE0] text-white'
    : 'bg-[#26A69A] text-white';
}

export function SafetyWaterStationList({
  stations,
  selectedId,
  onSelect,
  searchText = '',
  selectedKinds = ['water', 'rain'],
  className,
  cctvOnly = false,
  cctvStationIds,
  waterStatusById = {},
}: Props) {
  const allSelected = selectedId === null;
  const q = searchText.trim().toLowerCase();
  const filteredStations = stations.filter((st) => {
    if (!selectedKinds.includes(st.kind)) return false;
    if (cctvOnly && !(cctvStationIds?.has(st.id) ?? false)) return false;
    if (!q) return true;
    return `${st.name} ${st.address} ${st.code}`.toLowerCase().includes(q);
  });
  const hasAnyCctv = (cctvStationIds?.size ?? 0) > 0;

  return (
    <ul className={cn('min-h-0', className)} role="listbox" aria-label="관측소 목록">
      <li role="option" aria-selected={allSelected}>
        <button
          type="button"
          title="전체"
          onClick={() => onSelect(null)}
          className={cn(
            'flex w-full cursor-pointer items-center gap-2 border-b border-border/60 px-3 py-2.5 text-left transition-colors',
            allSelected ? 'bg-primary/10' : 'hover:bg-muted/50'
          )}
        >
          <div className="flex min-w-0 flex-1 items-center">
            <span
              className={cn(
                'min-w-0 truncate text-[12px] font-medium leading-none',
                allSelected ? 'text-primary' : 'text-foreground'
              )}
            >
              전체
            </span>
          </div>
          <span className="inline-flex h-5 w-5 shrink-0 self-center" aria-hidden />
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center self-center">
            {hasAnyCctv ? (
              <span
                className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sky-500 text-white"
                title="주변 도로 현황 있음"
                aria-label="주변 도로 현황 있음"
              >
                <Cctv className="block h-3 w-3" aria-hidden />
              </span>
            ) : null}
          </span>
        </button>
      </li>
      {filteredStations.map((st) => {
        const selected = st.id === selectedId;
        const hasCctv = cctvStationIds?.has(st.id) ?? false;
        const statusLevel = st.kind === 'water' ? (waterStatusById[st.id] ?? null) : null;
        const StatusIcon = statusLevel ? WATER_STATUS_ICON[statusLevel] : null;
        const statusColor = statusLevel ? WATER_STATUS_HEX[statusLevel] : null;
        return (
          <li key={st.id} role="option" aria-selected={selected}>
            <button
              type="button"
              title={st.name}
              onClick={() => onSelect(st.id)}
              className={cn(
                'flex w-full cursor-pointer items-center gap-2 border-b border-border/60 px-3 py-2.5 text-left transition-colors',
                selected ? 'bg-primary/10' : 'hover:bg-muted/50'
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={cn(
                      'shrink-0 rounded px-1 py-0.5 text-[9px] font-medium leading-none',
                      kindBadgeClass(st.kind)
                    )}
                  >
                    {kindLabel(st.kind)}
                  </span>
                  <span
                    className={cn(
                      'min-w-0 truncate text-[12px] font-medium leading-none',
                      selected ? 'text-primary' : 'text-foreground'
                    )}
                  >
                    {st.name}
                  </span>
                </div>
                <span className="truncate text-[10px] text-muted-foreground">{st.address || '—'}</span>
              </div>
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center self-center">
                {StatusIcon && statusColor ? (
                  <span
                    className="inline-flex"
                    title={statusLevel ?? undefined}
                    aria-label={statusLevel ? `수위 상태 ${statusLevel}` : undefined}
                  >
                    <StatusIcon
                      className="h-5 w-5"
                      style={{ color: statusColor }}
                      strokeWidth={2}
                      aria-hidden
                    />
                  </span>
                ) : null}
              </span>
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center self-center">
                {hasCctv ? (
                  <span
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sky-500 text-white"
                    title="주변 도로 현황 있음"
                    aria-label="주변 도로 현황 있음"
                  >
                    <Cctv className="block h-3 w-3" aria-hidden />
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
      {filteredStations.length === 0 ? (
        <li className="px-3 py-6 text-center text-[11px] text-muted-foreground">검색 결과가 없습니다.</li>
      ) : null}
    </ul>
  );
}
