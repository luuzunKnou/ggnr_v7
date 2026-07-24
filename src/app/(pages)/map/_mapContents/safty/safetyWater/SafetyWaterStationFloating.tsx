'use client';

import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { SafetyWaterStationList } from './SafetyWaterStationList';
import type { SafetyWaterStation } from './safetyWaterTypes';

type Props = {
  open: boolean;
  stations: SafetyWaterStation[];
  selectedId: string | null;
  /** null = 전체 */
  onSelect: (id: string | null) => void;
  onClose: () => void;
  /** 목록 버튼·이름 행 (바깥 클릭 제외) */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** 500m 내 CCTV 있는 관측소 id */
  cctvStationIds?: Set<string>;
};

export function SafetyWaterStationFloating({
  open,
  stations,
  selectedId,
  onSelect,
  onClose,
  anchorRef,
  cctvStationIds,
}: Props) {
  const panelWrapRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelWrapRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <div
      ref={panelWrapRef}
      className="absolute left-0 right-0 top-full z-[200] max-h-[min(70vh,420px)] overflow-hidden rounded-b-[5px] border border-t-0 border-slate-200 bg-white shadow-lg"
      role="dialog"
      aria-label="관측소 목록"
    >
      <div className="flex max-h-[min(70vh,420px)] flex-col gap-2 overflow-y-auto p-3">
        <label className="flex items-center gap-2 rounded border border-slate-200 px-2 py-2">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="관측소 이름 또는 주소 검색"
            className="w-full bg-transparent text-[12px] outline-none"
          />
        </label>
        <div className="flex flex-wrap gap-2 px-1 py-1">
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
        <SafetyWaterStationList
          stations={stations}
          selectedId={selectedId}
          onSelect={onSelect}
          searchText={searchText}
          selectedKinds={selectedKinds}
          cctvOnly={cctvOnly}
          cctvStationIds={cctvStationIds}
        />
      </div>
    </div>
  );
}
