'use client';

import React, { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { Input } from '@/app/shadcnComponents/ui/input';
import { MapLayergroupBar } from './map-layergroup-bar';

/**
 * 상단 왼쪽 검색창 (지도 위 오버레이)
 * - 데이터 조회 열리면 주소검색/레이어바가 오른쪽으로 밀림 (dataQueryPanelWidth 반영)
 * - URL query param `q`에 검색어를 동기화(간단 동작)
 */
export function MapSearchBar({
  dataQueryOpen = false,
  dataQueryPanelWidth = 460,
}: {
  dataQueryOpen?: boolean;
  dataQueryPanelWidth?: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialQuery = useMemo(() => searchParams.get('q') ?? '', [searchParams]);
  const [query, setQuery] = useState(initialQuery);

  const submit = (nextQuery: string) => {
    const trimmed = nextQuery.trim();
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    if (trimmed) params.set('q', trimmed);
    else params.delete('q');
    router.push(`/map?${params.toString()}`);
  };

  const leftOffset = dataQueryOpen ? 65 + dataQueryPanelWidth + 20 : 85;

  return (
    <div
      className="fixed top-4 z-40 flex items-center gap-3 pointer-events-none transition-[left] duration-200"
      style={{ left: `${leftOffset}px` }}
    >
      <div className="pointer-events-auto flex items-center gap-8">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(query);
          }}
          className="flex items-center gap-2 w-full max-w-[360px] rounded-xl bg-white backdrop-blur-md border border-slate-200 shadow-lg px-3 py-1"
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

        <MapLayergroupBar />
      </div>
    </div>
  );
}

