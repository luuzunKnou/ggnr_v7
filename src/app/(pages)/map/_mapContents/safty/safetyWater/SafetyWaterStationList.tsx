'use client';

import { Cctv } from 'lucide-react';
import { cn } from '@/lib/utils';
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
};

function kindLabel(kind: SafetyWaterStation['kind']) {
  return kind === 'water' ? '수위' : '강수';
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
}: Props) {
  const allSelected = selectedId === null;
  const q = searchText.trim().toLowerCase();
  const filteredStations = stations.filter((st) => {
    if (!selectedKinds.includes(st.kind)) return false;
    if (cctvOnly && !(cctvStationIds?.has(st.id) ?? false)) return false;
    if (!q) return true;
    return `${st.name} ${st.address} ${st.code}`.toLowerCase().includes(q);
  });
  const waterCount = stations.filter((st) => st.kind === 'water').length;
  const rainCount = stations.filter((st) => st.kind === 'rain').length;
  const hasAnyCctv = (cctvStationIds?.size ?? 0) > 0;

  return (
    <ul className={cn('min-h-0 flex-1 overflow-y-auto', className)} role="listbox" aria-label="관측소 목록">
      <li role="option" aria-selected={allSelected}>
        <button
          type="button"
          title="전체"
          onClick={() => onSelect(null)}
          className={cn(
            'flex w-full cursor-pointer items-center gap-2 border-b border-slate-100 px-3 py-2.5 text-left transition-colors',
            allSelected ? 'bg-primary/10' : 'hover:bg-slate-50'
          )}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span
              className={cn(
                'min-w-0 truncate text-[12px] font-medium leading-none',
                allSelected ? 'text-primary' : 'text-slate-800'
              )}
            >
              전체
            </span>
            <span className="truncate text-[10px] text-slate-500">
              수위 관측소 {waterCount}개, 강수량 관측소 {rainCount}개
            </span>
          </div>
          {hasAnyCctv ? (
            <span
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center self-center rounded-full bg-sky-500 text-white"
              title="반경 500m 내 CCTV"
              aria-label="반경 500m 내 CCTV"
            >
              <Cctv className="block h-3 w-3" aria-hidden />
            </span>
          ) : null}
        </button>
      </li>
      {filteredStations.map((st) => {
        const selected = st.id === selectedId;
        const hasCctv = cctvStationIds?.has(st.id) ?? false;
        return (
          <li key={st.id} role="option" aria-selected={selected}>
            <button
              type="button"
              title={st.name}
              onClick={() => onSelect(st.id)}
              className={cn(
                'flex w-full cursor-pointer items-center gap-2 border-b border-slate-100 px-3 py-2.5 text-left transition-colors',
                selected ? 'bg-primary/10' : 'hover:bg-slate-50'
              )}
            >
              <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'shrink-0 rounded px-1 py-0.5 text-[9px] font-medium leading-none',
                      st.kind === 'water'
                        ? 'bg-sky-100 text-sky-700'
                        : 'bg-emerald-100 text-emerald-700'
                    )}
                  >
                    {kindLabel(st.kind)}
                  </span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-[12px] font-medium leading-none',
                      selected ? 'text-primary' : 'text-slate-800'
                    )}
                  >
                    {st.name}
                  </span>
                </div>
                <span className="truncate text-[10px] text-slate-500">
                  {st.address || st.code}
                </span>
              </div>
              {hasCctv ? (
                <span
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center self-center rounded-full bg-sky-500 text-white"
                  title="반경 500m 내 CCTV"
                  aria-label="반경 500m 내 CCTV"
                >
                  <Cctv className="block h-3 w-3" aria-hidden />
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
      {filteredStations.length === 0 ? (
        <li className="px-3 py-6 text-center text-[11px] text-slate-400">검색 결과가 없습니다.</li>
      ) : null}
    </ul>
  );
}
