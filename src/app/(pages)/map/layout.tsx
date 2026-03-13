// src/app/(pages)/map/layout.tsx
'use client';

import React, { createContext, useContext, useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import LandInfo from './_mapComponents/LandInfo';
import Map3DDataPanel from './_mapComponents/Map3DDataPanel';
import StandardList from './_mapComponents/standard/StandardList';
import { LayerDataPanel } from './_mapComponents/standard/LayerDataPanel';
import StandardDetail from './_mapComponents/standard/StandardDetail';
import ComplaintListPanel from './_mapComponents/complaint/ComplaintListPanel';
import ComplaintDetail from './_mapComponents/complaint/ComplaintDetail';
import AddressInfoDetail from './_mapComponents/AddressInfoDetail';
import { MapSidebar } from './_mapComponents/map-sidebar';
import { MapSearchBar } from './_mapComponents/map-search-bar';
import { MapContextProvider, useMapContext } from './_mapComponents/MapContext';
import { MapSideListPanel } from './_mapComponents/MapSideListPanel';

const SIDEBAR_WIDTH = 65;
const SEARCH_BAR_MARGIN = 20;
/** 주소/지번 검색창과 같은 위치(px)에 맞출 때 사용. left = SIDEBAR_WIDTH + listPanelWidth + SEARCH_BAR_MARGIN, top = 16 */
export const SearchBarOffsetContext = createContext<{ leftPx: number; topPx: number }>({
  leftPx: SIDEBAR_WIDTH + SEARCH_BAR_MARGIN,
  topPx: 16,
});
export const useSearchBarOffset = () => useContext(SearchBarOffsetContext);

const STANDARD_LIST_MIN_WIDTH = 280;
const STANDARD_LIST_DEFAULT_WIDTH = STANDARD_LIST_MIN_WIDTH;
const STANDARD_LIST_MAX_WIDTH = 900;

const COMPLAINT_PANEL_DEFAULT_WIDTH = 460;
const COMPLAINT_PANEL_MIN_WIDTH = 320;
const COMPLAINT_PANEL_MAX_WIDTH = 900;

const MAP_3D_DATA_PANEL_DEFAULT_WIDTH = 360;
const MAP_3D_DATA_PANEL_MIN_WIDTH = 280;
const MAP_3D_DATA_PANEL_MAX_WIDTH = 600;

const LAYER_DATA_PANEL_DEFAULT_WIDTH = 400;
const LAYER_DATA_PANEL_MIN_WIDTH = 360;
const LAYER_DATA_PANEL_MAX_WIDTH = 900;

const STANDARD_LIST_OPENED_KEY = 'standardList';
const LIST_VIEW_OPENED_KEY = 'listView';
const COMPLAINT_OPENED_KEY = 'complaintManagement';
const MAP_3D_DATA_OPENED_KEY = 'map3dData';

function MapLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mapContext = useMapContext();
  const rawOpened = searchParams.get('opened')?.split(',').filter(Boolean) || [];
  const openedWindows = rawOpened.map((w) => (w === 'dataQuery' ? STANDARD_LIST_OPENED_KEY : w));

  const dataTableFromUrl = searchParams.get('dataTable') ?? '';
  const dataKeyFromUrl = searchParams.get('dataKey') ?? '';

  const layerListVisible = openedWindows.includes(STANDARD_LIST_OPENED_KEY);
  const dataPanelOpened = openedWindows.includes(LIST_VIEW_OPENED_KEY);
  const layerDataPanelOpen = dataPanelOpened && dataTableFromUrl !== '';

  const complaintManagementOpen = openedWindows.includes(COMPLAINT_OPENED_KEY);
  const map3dDataOpen = openedWindows.includes(MAP_3D_DATA_OPENED_KEY);
  const [standardListPanelWidth, setStandardListPanelWidth] = useState(STANDARD_LIST_DEFAULT_WIDTH);
  const [complaintPanelWidth, setComplaintPanelWidth] = useState(COMPLAINT_PANEL_DEFAULT_WIDTH);
  const [map3dDataPanelWidth, setMap3dDataPanelWidth] = useState(MAP_3D_DATA_PANEL_DEFAULT_WIDTH);
  const [layerDataPanelWidth, setLayerDataPanelWidth] = useState(LAYER_DATA_PANEL_DEFAULT_WIDTH);

  /** 열린 MapSideListPanel 너비 합 → 검색창/레이어바 left 기준 (패널 추가 시 여기만 합산) */
  const totalListPanelWidth =
    (layerListVisible ? standardListPanelWidth : 0) +
    (layerDataPanelOpen ? layerDataPanelWidth : 0) +
    (complaintManagementOpen ? complaintPanelWidth : 0) +
    (map3dDataOpen ? map3dDataPanelWidth : 0);
  const searchBarOffset = { leftPx: SIDEBAR_WIDTH + totalListPanelWidth + SEARCH_BAR_MARGIN, topPx: 16 };

  /** 패널별 왼쪽 경계(px). 드래그 시 해당 패널 너비 = clientX - leftOffset */
  const standardListLeftPx = SIDEBAR_WIDTH;
  const layerDataPanelLeftPx = SIDEBAR_WIDTH + (layerListVisible ? standardListPanelWidth : 0);
  const complaintPanelLeftPx = layerDataPanelLeftPx + (layerDataPanelOpen ? layerDataPanelWidth : 0);
  const map3dPanelLeftPx = complaintPanelLeftPx + (complaintManagementOpen ? complaintPanelWidth : 0);

  const mapPaddingLeft = SIDEBAR_WIDTH + totalListPanelWidth;
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;
    map.getView().padding = [0, 0, 0, mapPaddingLeft];
    mapContext?.setMapPaddingLeft?.(mapPaddingLeft);
  }, [mapPaddingLeft, mapContext]);

  const handleCloseMap3dData = () => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    const opened = openedWindows.filter((w) => w !== MAP_3D_DATA_OPENED_KEY);
    if (opened.length > 0) current.set('opened', opened.join(','));
    else current.delete('opened');
    router.push(`/map?${current.toString()}`);
  };

  type MapUrlUpdates = {
    opened?: string[];
    dataTable?: string | null;
    dataKey?: string | number | null;
  };

  const updateMapUrl = (updates: MapUrlUpdates) => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    if (updates.opened !== undefined) {
      if (updates.opened.length > 0) current.set('opened', updates.opened.join(','));
      else current.delete('opened');
    }
    if (updates.dataTable !== undefined) {
      if (updates.dataTable != null && updates.dataTable !== '') current.set('dataTable', updates.dataTable);
      else current.delete('dataTable');
    }
    if (updates.dataKey !== undefined) {
      if (updates.dataKey != null && updates.dataKey !== '') current.set('dataKey', String(updates.dataKey));
      else current.delete('dataKey');
    }
    router.push(`/map?${current.toString()}`);
  };

  const setOpened = (keys: string[]) => {
    updateMapUrl({ opened: keys });
  };

  const handleHideLayerList = () => {
    const next = openedWindows.filter((w) => w !== STANDARD_LIST_OPENED_KEY);
    setOpened(next);
  };

  const handleOpenDataPanel = (tableName: string) => {
    const nextOpened = openedWindows.includes(LIST_VIEW_OPENED_KEY) ? openedWindows : [...openedWindows, LIST_VIEW_OPENED_KEY];
    updateMapUrl({ opened: nextOpened, dataTable: tableName, dataKey: null });
  };

  const handleClearDataSelection = () => {
    const next = openedWindows.filter((w) => w !== LIST_VIEW_OPENED_KEY);
    updateMapUrl({ opened: next, dataTable: null, dataKey: null });
  };

  const handleDataKeyChange = (keyValue: string | number | null) => {
    updateMapUrl({ dataKey: keyValue });
  };

  const handleCloseDataPanel = () => {
    const next = openedWindows.filter((w) => w !== LIST_VIEW_OPENED_KEY);
    updateMapUrl({ opened: next, dataTable: null, dataKey: null });
    mapContext?.setIdentifyResultList?.(null);
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
    <SearchBarOffsetContext.Provider value={searchBarOffset}>
    <div className="relative w-full h-screen overflow-hidden bg-slate-100">
      {/* 지도: 전체 너비 → 사이드바 아래까지 확장 */}
      <div className="absolute inset-0 z-0">
        {children}
      </div>

      {/* 좌측 사이드바 (지도 위에 겹침) */}
      <MapSidebar />

      {/* 컨텐츠 레이아웃: pl로 여백만 두고, 지도 클릭은 통과 */}
      <div className="relative z-10 pl-[65px] flex h-full pointer-events-none">
        {layerListVisible && (
          <div className="pointer-events-auto shrink-0">
            <MapSideListPanel
              width={standardListPanelWidth}
              minWidth={STANDARD_LIST_MIN_WIDTH}
              maxWidth={STANDARD_LIST_MAX_WIDTH}
              leftOffsetPx={standardListLeftPx}
              onWidthChange={setStandardListPanelWidth}
            >
              <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 shrink-0 bg-white">
                  <span className="text-sm font-semibold text-slate-800">레이어 목록</span>
                  <button
                    type="button"
                    onClick={handleHideLayerList}
                    className="shrink-0 rounded p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                    title="닫기"
                    aria-label="닫기"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                  <StandardList
                    activeTableName={dataTableFromUrl}
                    onOpenDataPanel={handleOpenDataPanel}
                    onClearDataSelection={handleClearDataSelection}
                  />
                </div>
              </div>
            </MapSideListPanel>
          </div>
        )}
        {layerDataPanelOpen && (
          <div className="pointer-events-auto shrink-0">
            <MapSideListPanel
              width={layerDataPanelWidth}
              minWidth={LAYER_DATA_PANEL_MIN_WIDTH}
              maxWidth={LAYER_DATA_PANEL_MAX_WIDTH}
              leftOffsetPx={layerDataPanelLeftPx}
              onWidthChange={setLayerDataPanelWidth}
            >
              <LayerDataPanel
                dataTable={dataTableFromUrl}
                onClose={handleCloseDataPanel}
                onDataKeyChange={handleDataKeyChange}
                initialDataKey={dataKeyFromUrl || undefined}
              />
            </MapSideListPanel>
          </div>
        )}
        {complaintManagementOpen && (
          <div className="pointer-events-auto shrink-0">
            <MapSideListPanel
              width={complaintPanelWidth}
              minWidth={COMPLAINT_PANEL_MIN_WIDTH}
              maxWidth={COMPLAINT_PANEL_MAX_WIDTH}
              leftOffsetPx={complaintPanelLeftPx}
              onWidthChange={setComplaintPanelWidth}
            >
              <ComplaintListPanel />
            </MapSideListPanel>
          </div>
        )}
        {map3dDataOpen && (
          <div className="pointer-events-auto shrink-0">
            <MapSideListPanel
              width={map3dDataPanelWidth}
              minWidth={MAP_3D_DATA_PANEL_MIN_WIDTH}
              maxWidth={MAP_3D_DATA_PANEL_MAX_WIDTH}
              leftOffsetPx={map3dPanelLeftPx}
              onWidthChange={setMap3dDataPanelWidth}
            >
              <Map3DDataPanel onClose={handleCloseMap3dData} />
            </MapSideListPanel>
          </div>
        )}
        <div className="flex-1 min-w-0 relative">
          <div className="pointer-events-auto">
            <MapSearchBar listPanelWidth={totalListPanelWidth} />
          </div>
          {/* UI 레이어: Land Info(왼쪽), StandardDetail 등 */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="flex justify-between items-start p-4 h-full">
              <div className="flex flex-col gap-4 pointer-events-auto z-10">
                {openedWindows.includes('landInfo') && <LandInfo />}
              </div>
              <div className="absolute inset-0 pointer-events-none">
                <StandardDetail />
                <ComplaintDetail />
                <AddressInfoDetail />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </SearchBarOffsetContext.Provider>
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