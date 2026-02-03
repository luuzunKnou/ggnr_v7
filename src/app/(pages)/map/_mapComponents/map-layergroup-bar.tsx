'use client';

import React, { useState, useEffect } from 'react';
import { Settings } from 'lucide-react';
import { call } from '@/lib/api';
import { useMapContext } from './MapContext';

type SerItem = {
  ser_menu: string | null;
  ser_cat: string | null;
  ser_eng?: string | null;
  [key: string]: unknown;
};

/**
 * 지도 상단 레이어 그룹 버튼 바 (검색창 옆)
 * - serviceList.config에서 메뉴(ser_menu)가 "레이어"인 항목을 카테고리(ser_cat)로 그룹핑해 버튼으로 표시
 * - 예: 상수관망도, 하수관망도
 */
export function MapLayergroupBar() {
  const mapRef = useMapContext();
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const handleCategoryClick = (category: string) => {
    const map = mapRef?.current;
    if (!map) return;
    map.getLayers().getArray().forEach((layer: { get: (k: string) => unknown; setVisible: (v: boolean) => void }) => {
      if (!layer.get('serviceLayer')) return;
      const serCat = layer.get('ser_cat');
      console.log(serCat, category);
      if (serCat === category) {
        layer.setVisible(true);
      } else {
        layer.setVisible(false);
      }
    });
    const visibleNames = map
      .getLayers()
      .getArray()
      .filter((l: { getVisible: () => boolean; get: (k: string) => unknown }) => l.getVisible() && l.get('name') !== 'background')
      .map((l: { get: (k: string) => unknown }) => l.get('name'))
      .filter((name: unknown): name is string => typeof name === 'string');
    console.log('현재 켜져 있는 레이어 목록:', visibleNames);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
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
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return null;
  if (categories.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-nowrap">
      {categories.map((category) => (
        <button
          key={category}
          type="button"
          className="group relative flex items-center rounded-full border border-slate-200 bg-white shadow-lg h-10 pl-4 pr-3 py-1 shrink-0"
          aria-label={category}
          onClick={() => handleCategoryClick(category)}
        >
          {/* 너비는 글자 수에 맞게, 보이지 않는 텍스트로 확보 */}
          <span className="invisible font-medium text-sm whitespace-nowrap pr-8" aria-hidden>
            {category}
          </span>
          {/* 기본 가운데, hover 시 살짝만 왼쪽으로 이동 */}
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
