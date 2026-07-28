'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SafetyWaterStationList } from './SafetyWaterStationList';
import { useSafetyWater } from './safetyWaterContext';
import {
  deriveStationListFilter,
  type StationListFilterChip,
} from './safetyWaterListFilter';
import type { SafetyWaterStation } from './safetyWaterTypes';

/** 목록 행 ~3~4개 분량 (전체 포함) */
const LIST_MAX_H_CLASS = 'max-h-[200px]';

export type StationListFilter = 'all' | StationListFilterChip;

type Props = {
  stations: SafetyWaterStation[];
  selectedId: string | null;
  /** null = 전체 */
  onSelect: (id: string | null) => void;
  /** 500m 내 CCTV 있는 관측소 id */
  cctvStationIds?: Set<string>;
};

const FILTER_CHIPS: { id: StationListFilter; label: string; title: string }[] = [
  { id: 'all', label: '전체', title: '전체 관측소' },
  { id: 'water', label: '수위', title: '수위 관측소' },
  { id: 'rain', label: '강수량', title: '강수량 관측소' },
  { id: 'cctv', label: 'CCTV', title: '주변 도로 현황 있는 관측소' },
];

function chipActiveClass(id: StationListFilter) {
  if (id === 'water') return 'bg-[#3B8DE0] text-white';
  if (id === 'rain') return 'bg-[#26A69A] text-white';
  if (id === 'cctv') return 'bg-sky-500 text-white';
  return 'bg-foreground text-background';
}

/** 좌측 패널 풀폭 관측소 목록 + 검색·필터 (카드 아님) */
export function SafetyWaterStationFloating({
  stations,
  selectedId,
  onSelect,
  cctvStationIds,
}: Props) {
  const { stationListFilterChips, setStationListFilterChips, waterStatusById } = useSafetyWater();
  const [searchText, setSearchText] = useState('');

  const waterCount = stations.filter((st) => st.kind === 'water').length;
  const rainCount = stations.filter((st) => st.kind === 'rain').length;

  const { isAll, selectedKinds, cctvOnly } = deriveStationListFilter(stationListFilterChips);
  const activeSet = useMemo(() => new Set(stationListFilterChips), [stationListFilterChips]);

  const toggleChip = (id: StationListFilter) => {
    if (id === 'all') {
      setStationListFilterChips([]);
      return;
    }
    const next = new Set(activeSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setStationListFilterChips([...next]);
  };

  const isChipActive = (id: StationListFilter) => {
    if (id === 'all') return isAll;
    return activeSet.has(id);
  };

  return (
    <div className="flex w-full flex-col" aria-label="관측소 목록">
      <div className="flex w-full flex-col gap-2 border-t border-border/80 px-4 py-2">
        <label className="flex shrink-0 items-center gap-2 rounded border border-border bg-background px-2 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="관측소 이름 또는 주소 검색"
            title="관측소 이름 또는 주소 검색"
            className="w-full cursor-text bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <div className="flex flex-wrap gap-2" role="group" aria-label="관측소 필터">
            {FILTER_CHIPS.map((chip) => {
              const active = isChipActive(chip.id);
              return (
                <button
                  key={chip.id}
                  type="button"
                  title={chip.title}
                  aria-pressed={active}
                  onClick={() => toggleChip(chip.id)}
                  className={cn(
                    'cursor-pointer rounded-full px-3.5 py-1.5 text-[11px] font-medium transition-colors',
                    active ? chipActiveClass(chip.id) : 'bg-muted text-muted-foreground'
                  )}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
          <span className="shrink-0 text-[10px] leading-none text-muted-foreground">
            수위 {waterCount}개 · 강수량 {rainCount}개
          </span>
        </div>
      </div>

      <div className={`w-full overflow-y-auto border-t border-border/80 ${LIST_MAX_H_CLASS}`}>
        <SafetyWaterStationList
          stations={stations}
          selectedId={selectedId}
          onSelect={onSelect}
          searchText={searchText}
          selectedKinds={selectedKinds}
          cctvOnly={cctvOnly}
          cctvStationIds={cctvStationIds}
          waterStatusById={waterStatusById}
        />
      </div>
    </div>
  );
}
