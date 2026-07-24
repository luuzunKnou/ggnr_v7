'use client';

import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Cctv,
  ChevronLeft,
  ChevronRight,
  List,
  Loader2,
  X,
} from 'lucide-react';
import { MapFloatingPanel } from '@/app/(pages)/map/_mapComponents/MapFloatingPanel';
import {
  FLOAT_PANEL_BELOW_SEARCH_TOP_EXTRA,
  useSearchBarOffset,
} from '@/app/(pages)/map/searchBarOffsetContext';
import { cn } from '@/lib/utils';
import { RoadCctvHlsPlayer } from '../../road/roadCCTV/RoadCctvHlsPlayer';
import { useSafetyWater } from './safetyWaterContext';

export function SafetyWaterNearbyCctv() {
  const {
    cctvOpen,
    setCctvOpen,
    cctvListItems,
    cctvLoading,
    cctvError,
    selectedCctvKey,
    setSelectedCctvKey,
  } = useSafetyWater();
  const { leftPx, topPx } = useSearchBarOffset();
  const [listOpen, setListOpen] = useState(false);
  const listPanelRef = useRef<HTMLDivElement>(null);

  const anchorPosition = useMemo(
    () => ({ top: topPx + FLOAT_PANEL_BELOW_SEARCH_TOP_EXTRA + 48, left: leftPx }),
    [leftPx, topPx]
  );

  const listItems = cctvListItems;
  const selected = useMemo(
    () => listItems.find((x) => x.key === selectedCctvKey) ?? null,
    [listItems, selectedCctvKey]
  );
  const selectedIndex = useMemo(() => {
    if (!selectedCctvKey) return -1;
    return listItems.findIndex((x) => x.key === selectedCctvKey);
  }, [listItems, selectedCctvKey]);

  useEffect(() => {
    if (!listOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (listPanelRef.current?.contains(e.target as Node)) return;
      setListOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [listOpen]);

  const goPrev = useCallback(() => {
    if (listItems.length === 0) return;
    const i = selectedIndex < 0 ? 0 : (selectedIndex - 1 + listItems.length) % listItems.length;
    setSelectedCctvKey(listItems[i].key);
  }, [listItems, selectedIndex, setSelectedCctvKey]);

  const goNext = useCallback(() => {
    if (listItems.length === 0) return;
    const i = selectedIndex < 0 ? 0 : (selectedIndex + 1) % listItems.length;
    setSelectedCctvKey(listItems[i].key);
  }, [listItems, selectedIndex, setSelectedCctvKey]);

  if (!cctvOpen || typeof document === 'undefined') return null;

  return createPortal(
    <MapFloatingPanel
      className="rounded-[5px]"
      width="360px"
      maxHeight="75vh"
      defaultPosition={anchorPosition}
      style={{ position: 'fixed', zIndex: 210 }}
      header={
        <>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <Cctv className="h-4 w-4 shrink-0 text-sky-600" aria-hidden />
              <span className="truncate text-[13px] font-medium text-slate-800">주변 도로 영상</span>
            </div>
            <span className="pl-5 text-[10px] leading-none text-slate-500">반경 500m 내</span>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {listItems.length >= 2 ? (
              <>
                <button
                  type="button"
                  title="이전 영상"
                  aria-label="이전 영상"
                  onClick={goPrev}
                  className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title="다음 영상"
                  aria-label="다음 영상"
                  onClick={goNext}
                  className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            ) : null}
            <button
              type="button"
              title="영상 목록"
              aria-label="영상 목록"
              aria-expanded={listOpen}
              onClick={() => setListOpen((v) => !v)}
              className={cn(
                'inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded transition-colors',
                listOpen ? 'bg-slate-100 text-slate-800' : 'text-slate-500 hover:bg-slate-100'
              )}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="닫기"
              aria-label="닫기"
              onClick={() => setCctvOpen(false)}
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </>
      }
    >
      <div className="relative flex flex-col gap-2 p-3">
        {cctvError ? (
          <p className="text-[11px] text-amber-800" role="alert">
            {cctvError}
          </p>
        ) : null}
        <div className="overflow-hidden rounded-md border border-slate-200 bg-black">
          {selected ? (
            <RoadCctvHlsPlayer
              key={selected.cctvurl}
              url={selected.cctvurl}
              className="aspect-video max-h-[200px] w-full object-contain"
            />
          ) : (
            <div className="flex aspect-video max-h-[140px] items-center justify-center bg-slate-900/90 px-2 text-center text-[11px] text-slate-300">
              {cctvLoading ? '불러오는 중…' : '반경 500m 내 영상이 없습니다.'}
            </div>
          )}
        </div>
        {selected ? (
          <p className="line-clamp-2 text-[11px] font-medium text-slate-700">{selected.cctvname}</p>
        ) : null}
        {cctvLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" aria-hidden />
        ) : (
          <p className="text-[10px] text-slate-500">반경 500m 내 · {listItems.length}건</p>
        )}

        {listOpen ? (
          <div
            ref={listPanelRef}
            className="absolute left-3 right-3 top-3 z-20 max-h-48 overflow-y-auto rounded border border-slate-200 bg-white shadow-md"
          >
            {listItems.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-slate-500">목록이 없습니다.</p>
            ) : (
              <ul>
                {listItems.map((it) => {
                  const active = it.key === selectedCctvKey;
                  return (
                    <li key={it.key} className="border-b border-slate-100 last:border-0">
                      <button
                        type="button"
                        title={it.cctvname}
                        onClick={() => {
                          setSelectedCctvKey(it.key);
                          setListOpen(false);
                        }}
                        className={cn(
                          'flex w-full cursor-pointer flex-col gap-0.5 px-3 py-2 text-left text-[12px] transition-colors hover:bg-slate-50',
                          active && 'bg-primary/5 text-primary'
                        )}
                      >
                        <span className="line-clamp-2 font-medium">{it.cctvname}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </MapFloatingPanel>,
    document.body
  );
}
