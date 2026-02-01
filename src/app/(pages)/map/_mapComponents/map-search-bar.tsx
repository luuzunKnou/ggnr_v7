'use client';

import React, { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { Input } from '@/app/shadcnComponents/ui/input';
import { cn } from '@/lib/utils';

/**
 * 상단 중앙 검색창 (지도 위 오버레이)
 * - URL query param `q`에 검색어를 동기화(간단 동작)
 * - 실제 지도 이동/검색 API 연동은 이후 단계에서 연결 가능
 */
export function MapSearchBar() {
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

  return (
    // 사이드바(65px) 영역을 제외한 곳에서 중앙 정렬
    <div className="fixed top-4 left-[65px] right-0 z-40 flex justify-center pointer-events-none">
      <div className="pointer-events-auto w-full max-w-[560px] px-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(query);
          }}
          className={cn(
            'flex items-center gap-2',
            'rounded-xl bg-white/90 backdrop-blur-md',
            'border border-slate-200 shadow-lg',
            // 높이 조금 축소
            'px-3 py-1'
          )}
        >
          {/* 좌측 돋보기: 검색 버튼(Submit) */}
          <button
            type="submit"
            className="inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-slate-100 text-slate-600 -mr-1"
            aria-label="검색"
            title="검색"
          >
            <Search className="w-4 h-4 shrink-0" />
          </button>

          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="주소/지번 검색"
            className={cn(
              // 높이 조금 축소
              'h-8',
              'border-0 bg-transparent shadow-none',
              'focus-visible:ring-0 focus-visible:border-0'
            )}
          />

          {query.trim().length > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                submit('');
              }}
              className="inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-slate-100 text-slate-500"
              aria-label="검색어 지우기"
              title="지우기"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

