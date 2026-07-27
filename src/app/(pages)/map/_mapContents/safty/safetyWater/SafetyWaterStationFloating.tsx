'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { SafetyWaterStationList } from './SafetyWaterStationList';
import { buildDummyWaterStatusById } from './safetyWaterStatus';
import type { SafetyWaterStation } from './safetyWaterTypes';

/** 목록 행 ~3개 분량 (전체 포함) */
const LIST_MAX_H_CLASS = 'max-h-[200px]';

type Props = {
  stations: SafetyWaterStation[];
  selectedId: string | null;
  /** null = 전체 */
  onSelect: (id: string | null) => void;
  /** 500m 내 CCTV 있는 관측소 id */
  cctvStationIds?: Set<string>;
};

/** 좌측 패널 풀폭 관측소 목록 + 검색·필터 (카드 아님) */
export function SafetyWaterStationFloating({
  stations,
  selectedId,
  onSelect,
  cctvStationIds,
}: Props) {
  const [searchText, setSearchText] = useState('');
  const [selectedKinds, setSelectedKinds] = useState<SafetyWaterStation['kind'][]>(['water', 'rain']);
  const [cctvOnly, setCctvOnly] = useState(false);

  const toggleKind = (kind: SafetyWaterStation['kind']) => {
    setSelectedKinds((prev) => {
      if (prev.includes(kind)) {
        const next = prev.filter((item) => item !== kind);
        return next.length === 0 ? prev : next;
      }
      return [...prev, kind];
    });
  };

  const waterCount = stations.filter((st) => st.kind === 'water').length;
  const rainCount = stations.filter((st) => st.kind === 'rain').length;
  const waterStatusById = buildDummyWaterStatusById(stations);

  return (
    <div className="flex w-full flex-col" aria-label="관측소 목록">
      <div className="flex w-full flex-col gap-2 border-t border-slate-200/80 px-4 py-2">
        <label className="flex shrink-0 items-center gap-2 rounded border border-slate-200 bg-white px-2 py-2">
          <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="관측소 이름 또는 주소 검색"
            title="관측소 이름 또는 주소 검색"
            className="w-full cursor-text bg-transparent text-[12px] outline-none"
          />
        </label>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              title="수위 관측소"
              onClick={() => toggleKind('water')}
              className={`cursor-pointer rounded-full px-3 py-1 text-[11px] font-medium ${
                selectedKinds.includes('water')
                  ? 'bg-sky-100 text-sky-700'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              수위
            </button>
            <button
              type="button"
              title="강수량 관측소"
              onClick={() => toggleKind('rain')}
              className={`cursor-pointer rounded-full px-3 py-1 text-[11px] font-medium ${
                selectedKinds.includes('rain')
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              강수량
            </button>
            <button
              type="button"
              title="CCTV 인근 관측소"
              onClick={() => setCctvOnly((prev) => !prev)}
              className={`cursor-pointer rounded-full px-3 py-1 text-[11px] font-medium ${
                cctvOnly ? 'bg-sky-500 text-white' : 'bg-slate-100 text-slate-500'
              }`}
            >
              CCTV
            </button>
          </div>
          <span className="shrink-0 text-[10px] leading-none text-slate-500">
            수위 {waterCount}개 · 강수량 {rainCount}개
          </span>
        </div>
      </div>

      <div className={`w-full overflow-y-auto border-t border-slate-200/80 ${LIST_MAX_H_CLASS}`}>
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
