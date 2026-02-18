// src/app/(pages)/map/layout.tsx
'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import LandInfo from './_mapComponents/LandInfo';
import StandardList from './_mapComponents/StandardList';
import StandardDetail from './_mapComponents/StandardDetail';
import ComplaintListPanel from './_mapComponents/ComplaintListPanel';
import ComplaintDetail from './_mapComponents/ComplaintDetail';
import { MapSidebar } from './_mapComponents/map-sidebar';
import { MapSearchBar } from './_mapComponents/map-search-bar';
import { MapContextProvider, useMapContext } from './_mapComponents/MapContext';
import { MapSideListPanel } from './_mapComponents/MapSideListPanel';

const STANDARD_LIST_DEFAULT_WIDTH = 460;
const STANDARD_LIST_MIN_WIDTH = 320;
const STANDARD_LIST_MAX_WIDTH = 900;

const COMPLAINT_PANEL_DEFAULT_WIDTH = 460;
const COMPLAINT_PANEL_MIN_WIDTH = 320;
const COMPLAINT_PANEL_MAX_WIDTH = 900;

const STANDARD_LIST_OPENED_KEY = 'standardList';
const COMPLAINT_OPENED_KEY = 'complaintManagement';

function MapLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mapContext = useMapContext();
  const rawOpened = searchParams.get('opened')?.split(',').filter(Boolean) || [];
  const openedWindows = rawOpened.map((w) => (w === 'dataQuery' ? STANDARD_LIST_OPENED_KEY : w));

  const standardListOpen = openedWindows.includes(STANDARD_LIST_OPENED_KEY) || openedWindows.includes('listView');
  const complaintManagementOpen = openedWindows.includes(COMPLAINT_OPENED_KEY);
  const [standardListPanelWidth, setStandardListPanelWidth] = useState(STANDARD_LIST_DEFAULT_WIDTH);
  const [complaintPanelWidth, setComplaintPanelWidth] = useState(COMPLAINT_PANEL_DEFAULT_WIDTH);

  /** 열린 MapSideListPanel 너비 합 → 검색창/레이어바 left 기준 (패널 추가 시 여기만 합산) */
  const totalListPanelWidth =
    (standardListOpen ? standardListPanelWidth : 0) + (complaintManagementOpen ? complaintPanelWidth : 0);

  const handleCloseStandardList = () => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    const opened = openedWindows.filter((w) => w !== STANDARD_LIST_OPENED_KEY && w !== 'listView');
    if (opened.length > 0) current.set('opened', opened.join(','));
    else current.delete('opened');
    router.push(`/map?${current.toString()}`);
  };

  const handleCloseComplaint = () => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    const opened = openedWindows.filter((w) => w !== COMPLAINT_OPENED_KEY);
    if (opened.length > 0) current.set('opened', opened.join(','));
    else current.delete('opened');
    router.push(`/map?${current.toString()}`);
    mapContext?.setComplaintDetail?.(null);
  };

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
        {standardListOpen && (
          <div className="pointer-events-auto shrink-0">
            <MapSideListPanel
              width={standardListPanelWidth}
              minWidth={STANDARD_LIST_MIN_WIDTH}
              maxWidth={STANDARD_LIST_MAX_WIDTH}
              onWidthChange={setStandardListPanelWidth}
            >
              <StandardList />
            </MapSideListPanel>
          </div>
        )}
        {complaintManagementOpen && (
          <div className="pointer-events-auto shrink-0">
            <MapSideListPanel
              width={complaintPanelWidth}
              minWidth={COMPLAINT_PANEL_MIN_WIDTH}
              maxWidth={COMPLAINT_PANEL_MAX_WIDTH}
              onWidthChange={setComplaintPanelWidth}
            >
              <ComplaintListPanel />
            </MapSideListPanel>
          </div>
        )}
        <div className="flex-1 min-w-0 relative">
          <div className="pointer-events-auto">
            <MapSearchBar listPanelWidth={totalListPanelWidth} />
          </div>
          {/* UI 레이어: Land Info(왼쪽), StandardDetail(오른쪽, 드래그 가능) */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="flex justify-between items-start p-4 h-full">
              <div className="flex flex-col gap-4 pointer-events-auto">
                {openedWindows.includes('landInfo') && <LandInfo />}
              </div>
              <div className="absolute inset-0 pointer-events-none">
                <StandardDetail />
                <ComplaintDetail />
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