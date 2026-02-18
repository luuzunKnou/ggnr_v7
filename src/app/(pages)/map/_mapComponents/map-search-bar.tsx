'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X, ChevronDown, LayoutGrid, Check } from 'lucide-react';
import { Input } from '@/app/shadcnComponents/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { MapLayergroupBar } from './map-layergroup-bar';

type SystemOption = {
  sys_key: string;
  sys_kor: string;
  sys_eng?: string;
  sys_detail?: string;
  sys_idx?: number;
  sys_col?: string;
};

const SIDEBAR_WIDTH = 65;
const SEARCH_BAR_MARGIN = 20;

/**
 * 상단 왼쪽 검색창 (지도 위 오버레이)
 * - listPanelWidth: 열린 MapSideListPanel 너비 합 → 겹치지 않게 left 계산 (Layout에서 계산해 전달)
 * - URL query param `q`에 검색어를 동기화(간단 동작)
 */
export function MapSearchBar({
  listPanelWidth = 0,
}: {
  listPanelWidth?: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialQuery = useMemo(() => searchParams.get('q') ?? '', [searchParams]);
  const [query, setQuery] = useState(initialQuery);
  const [systemList, setSystemList] = useState<SystemOption[]>([]);
  const [selectedSystemKey, setSelectedSystemKey] = useState<string>('');
  const [systemModalOpen, setSystemModalOpen] = useState(false);

  useEffect(() => {
    call('', 'POST', { service: 'configService', action: 'getSystemList', params: {} })
      .then((res) => {
        const data = res?.data ?? res;
        const systems = Array.isArray(data?.systems) ? data.systems : [];
        const sorted = [...systems].sort(
          (a, b) => (Number(a.sys_idx) || 999) - (Number(b.sys_idx) || 999)
        );
        setSystemList(sorted);
        if (sorted.length > 0) {
          setSelectedSystemKey((prev) => prev || String(sorted[0].sys_key ?? ''));
        }
      })
      .catch(() => setSystemList([]));
  }, []);

  const submit = (nextQuery: string) => {
    const trimmed = nextQuery.trim();
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    if (trimmed) params.set('q', trimmed);
    else params.delete('q');
    router.push(`/map?${params.toString()}`);
  };

  const leftOffset = SIDEBAR_WIDTH + listPanelWidth + SEARCH_BAR_MARGIN;

  return (
    <div
      className="fixed top-4 right-4 left-0 z-40 flex items-center pointer-events-none transition-[left] duration-200"
      style={{ left: `${leftOffset}px` }}
    >
      <div className="pointer-events-auto flex items-start gap-6 w-full min-w-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(query);
          }}
          className="flex items-center gap-2 w-[350px] shrink-0 rounded-[10px] bg-white backdrop-blur-md border border-slate-200 shadow-lg px-3 py-1 opacity-90"
        >
          {/* 좌측 돋보기: 검색 버튼(Submit) */}
          <button
            type="submit"
            className="inline-flex items-center justify-center w-[30px] h-[30px] rounded-md hover:bg-slate-100 text-slate-600 -mr-1"
            aria-label="검색"
            title="검색"
          >
            <Search className="w-4 h-4 shrink-0" />
          </button>

          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="주소/지번 검색"
            className="h-[30px] border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:border-0"
          />

          {query.trim().length > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                submit('');
              }}
              className="inline-flex items-center justify-center w-[30px] h-[30px] rounded-md hover:bg-slate-100 text-slate-500"
              aria-label="검색어 지우기"
              title="지우기"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </form>

        {/* 레이어 그룹: 남는 공간만 사용, 좁아지면 버튼만 잘림 */}
        <div className="min-w-0 flex-1 flex overflow-hidden">
          <MapLayergroupBar />
        </div>

        {/* 시스템 선택: 우측 끝 고정 (배경지도 버튼 열과 right-4 맞춤) */}
        {systemList.length > 0 && (() => {
              const selectedSystem = systemList.find((s) => s.sys_key === selectedSystemKey);
              const systemColor = selectedSystem?.sys_col || 'var(--primary)';
              return (
          <>
            <button
              type="button"
              onClick={() => setSystemModalOpen(true)}
              className="shrink-0 flex items-center gap-2.5 h-10 rounded-[10px] bg-white/95 backdrop-blur-md border border-slate-200/80 shadow-md pl-3 pr-3 text-left hover:shadow-lg hover:border-slate-300 hover:bg-white transition-all duration-200 w-[230px]"
              aria-label="시스템 선택"
            >
              <div
                className="flex items-center justify-center w-7 h-7 rounded-md"
                style={{ backgroundColor: `${systemColor}18`, color: systemColor }}
              >
                <LayoutGrid className="w-4 h-4 shrink-0" aria-hidden />
              </div>
              <span className="flex-1 min-w-0 truncate text-[12px] font-medium text-slate-700">
                {selectedSystem?.sys_kor ?? selectedSystemKey ?? '시스템 선택'}
              </span>
              <ChevronDown className="w-4 h-4 shrink-0 text-slate-400" aria-hidden />
            </button>

            <Dialog open={systemModalOpen} onOpenChange={setSystemModalOpen}>
              <DialogContent className="sm:max-w-[380px] p-0 gap-0 overflow-hidden rounded-[10px] border-slate-200/80 shadow-xl" showCloseButton={false}>
                <DialogHeader className="px-3 py-2 border-b border-slate-100 bg-gradient-to-b from-slate-50/80 to-white">
                  <DialogTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <div className="flex items-center justify-center w-6 h-6 rounded-[5px] bg-primary/10 text-primary">
                      <LayoutGrid className="w-3.5 h-3.5" />
                    </div>
                    시스템 선택
                  </DialogTitle>
                </DialogHeader>
                <ul className="grid gap-2 p-4">
                  {systemList.map((sys) => {
                    const isSelected = sys.sys_key === selectedSystemKey;
                    const accentColor = sys.sys_col || 'var(--primary)';
                    return (
                      <li key={sys.sys_key}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSystemKey(sys.sys_key);
                            setSystemModalOpen(false);
                          }}
                          className={cn(
                            'w-full flex items-center gap-4 rounded-xl px-4 py-3 text-left transition-all duration-200 border',
                            isSelected
                              ? 'border-transparent shadow-md ring-1 ring-primary/20'
                              : 'border-slate-100 bg-slate-50/50 hover:bg-slate-100/80 hover:border-slate-200'
                          )}
                          style={isSelected ? { backgroundColor: `${accentColor}12`, borderColor: `${accentColor}30` } : undefined}
                        >
                          <span
                            className="w-1.5 h-8 shrink-0 rounded-full"
                            style={{ backgroundColor: accentColor }}
                            aria-hidden
                          />
                          <div className="flex-1 min-w-0 text-left">
                            <span className={cn('block truncate text-sm', isSelected ? 'font-semibold text-slate-800' : 'font-medium text-slate-700')}>
                              {sys.sys_kor}
                            </span>
                            {sys.sys_detail && (
                              <span className="block text-xs text-slate-500 mt-1 leading-relaxed">{sys.sys_detail}</span>
                            )}
                          </div>
                          {isSelected && (
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/15 text-primary shrink-0">
                              <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <footer className="px-4 py-3 border-t border-slate-100 bg-slate-50/50 text-xs text-slate-500">
                </footer>
              </DialogContent>
            </Dialog>
          </>
              );
            })()}
      </div>
    </div>
  );
}

