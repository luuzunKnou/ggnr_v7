'use client';

import React, { useState, useEffect } from 'react';
import { Settings } from 'lucide-react';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useLayerCategory } from './LayerCategoryContext';

type SerItem = {
  ser_menu: string | null;
  ser_cat: string | null;
  ser_eng?: string | null;
  [key: string]: unknown;
};

/**
 * 지도 상단 레이어 그룹 버튼 바 (검색창 옆)
 * - 각 카테고리 버튼: 자기 레이어만 토글 (상수/하수 동시 ON 가능)
 */
export function MapLayergroupBar() {
  const { activeCategories, toggleCategory } = useLayerCategory() ?? {
    activeCategories: [] as string[],
    toggleCategory: () => {},
  };
  const [categories, setCategories] = useState<string[]>([]);

  const handleCategoryClick = (category: string) => {
    toggleCategory(category);
  };

  useEffect(() => {
    let cancelled = false;
    call('', 'POST', { service: 'configService', action: 'getServiceList', params: {} })
      .then((res: { data?: { ser?: SerItem[] }; success?: boolean }) => {
        if (cancelled) return;
        const list = res?.data?.ser ?? [];
        const layerItems = list.filter((s: SerItem) => s.ser_menu === '레이어');
        const seen = new Set<string>();
        const ordered: string[] = [];
        for (const s of layerItems) {
          const cat = s.ser_cat?.trim?.() ?? '';
          if (cat && !seen.has(cat)) {
            seen.add(cat);
            ordered.push(cat);
          }
        }
        setCategories(ordered);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (categories.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-nowrap">
      {categories.map((category) => (
        <button
          key={category}
          type="button"
          className={cn(
            'group relative flex items-center rounded-full border shadow-lg h-10 pl-4 pr-3 py-1 shrink-0',
            activeCategories.includes(category)
              ? 'border-blue-500 bg-blue-50 text-blue-700'
              : 'border-slate-200 bg-white'
          )}
          aria-label={category}
          aria-pressed={activeCategories.includes(category)}
          onClick={() => handleCategoryClick(category)}
        >
          <span className="invisible font-medium text-sm whitespace-nowrap pr-8" aria-hidden>
            {category}
          </span>
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-slate-700 font-medium text-sm whitespace-nowrap transition-transform duration-200 ease-out group-hover:-translate-x-[calc(50%+0.5rem)] group-hover:-translate-y-1/2">
            {category}
          </span>
          <span className="absolute right-[6px] top-1/2 -translate-y-1/2 flex items-center justify-center w-[29px] h-[29px] rounded-full opacity-0 translate-x-2 transition-all duration-200 ease-out group-hover:opacity-100 group-hover:translate-x-0 cursor-pointer hover:bg-primary/10 text-primary hover:text-primary/80">
            <Settings className="w-4 h-4 shrink-0" />
          </span>
        </button>
      ))}
    </div>
  );
}
