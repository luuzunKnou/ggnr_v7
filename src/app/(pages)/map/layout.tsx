// src/app/(pages)/map/layout.tsx
'use client';

import React, { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import LandInfo from './_mapComponents/LandInfo';
import StandardList from './_mapComponents/StandardList';
import { MapSidebar } from './_mapComponents/map-sidebar';
import { MapSearchBar } from './_mapComponents/map-search-bar';
import { MapContextProvider } from './_mapComponents/MapContext';

const DATA_QUERY_DEFAULT_WIDTH = 460;
const DATA_QUERY_MIN_WIDTH = 320;
const DATA_QUERY_MAX_WIDTH = 900;

function MapLayoutContent({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const openedWindows = searchParams.get('opened')?.split(',').filter(Boolean) || [];

  const dataQueryOpen = openedWindows.includes('dataQuery');
  const [dataQueryPanelWidth, setDataQueryPanelWidth] = useState(DATA_QUERY_DEFAULT_WIDTH);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-100">
      {/* 지도: 전체 너비 → 사이드바 아래까지 확장 */}
      <div className="absolute inset-0 z-0">
        {children}
      </div>

      {/* 좌측 사이드바 (지도 위에 겹침) */}
      <MapSidebar />

      {/* 컨텐츠 레이아웃: pl로 여백만 두고, 지도 클릭은 통과 */}
      <div className="relative z-10 pl-[65px] flex h-full pointer-events-none">
        {dataQueryOpen && (
          <div className="pointer-events-auto shrink-0">
            <StandardList
              width={dataQueryPanelWidth}
              minWidth={DATA_QUERY_MIN_WIDTH}
              maxWidth={DATA_QUERY_MAX_WIDTH}
              onWidthChange={setDataQueryPanelWidth}
            />
          </div>
        )}
        <div className="flex-1 min-w-0 relative">
          <div className="pointer-events-auto">
            <MapSearchBar dataQueryOpen={dataQueryOpen} dataQueryPanelWidth={dataQueryPanelWidth} />
          </div>
          {/* UI 레이어: Land Info 등 */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="flex justify-between p-4 h-full">
              <div className="flex flex-col gap-4 pointer-events-auto">
                {openedWindows.includes('landInfo') && <LandInfo />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return (
    <MapContextProvider>
      <Suspense fallback={<div className="relative w-full h-screen overflow-hidden bg-slate-100 pl-[65px]" />}>
        <MapLayoutContent>{children}</MapLayoutContent>
      </Suspense>
    </MapContextProvider>
  );
}