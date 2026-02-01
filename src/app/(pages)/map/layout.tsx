// src/app/(pages)/map/layout.tsx
'use client';

import React from 'react';
import { useSearchParams } from 'next/navigation';
import StandardList from './_mapComponents/StandardList';
import LandInfo from './_mapComponents/LandInfo';
import MapControls from './_mapComponents/MapControls';
import { MapSidebar } from './_mapComponents/map-sidebar';
import { MapSearchBar } from './_mapComponents/map-search-bar';

export default function MapLayout({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  
  // URL에서 ?opened=river,land 형태로 된 값을 배열로 바꿉니다.
  const openedWindows = searchParams.get('opened')?.split(',').filter(Boolean) || [];

  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-100 pl-[65px]">
      {/* 좌측 사이드바 */}
      <MapSidebar />

      {/* 상단 가운데 검색창 */}
      <MapSearchBar />

      {/* 1. 배경 지도 영역 (page.tsx가 들어감) */}
      <div className="absolute inset-0 z-0">
        {children}
      </div>

      {/* 2. 컨트롤 버튼 */}
      <MapControls />

      {/* 3. UI 레이어 (창들이 뜰 곳) */}
      <div className="relative z-10 pointer-events-none w-full h-full">
        <div className="flex justify-between p-4 h-full">
          
          {/* 왼쪽 영역: Standard List들이 쌓이는 곳 */}
          <div className="flex flex-col gap-4 pointer-events-auto">
            {openedWindows.includes('standardList') && (
              <StandardList tableName="표준목록" />
            )}
          </div>

          {/* 오른쪽 영역: Land Info들이 쌓이는 곳 */}
          <div className="flex flex-col gap-4 pointer-events-auto">
            {openedWindows.includes('landInfo') && (
              <LandInfo />
            )}
          </div>
          
        </div>
      </div>
    </div>
  );
}