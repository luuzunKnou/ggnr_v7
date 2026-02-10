'use client';

import React, { useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Crop, Download, PanelsLeftBottom, BarChart3, LayoutList, Droplets, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMapContext } from './MapContext';

interface SidebarButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  isActive?: boolean;
}

function SidebarButton({ icon, label, onClick, isActive }: SidebarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        'flex flex-col items-center justify-center w-[65px] h-[65px] text-white/80 hover:text-white hover:bg-white/10 transition-colors',
        isActive && 'bg-white/20 text-white'
      )}
    >
      {icon}
      <span className="text-[11px] mt-1 font-medium break-keep text-center leading-tight">{label}</span>
    </button>
  );
}

/**
 * 좌측 고정 사이드바 (65px)
 * - 디자인은 사용자 제공 `map-sidebar.tsx` 참고
 * - 클릭 시 URL query param `opened`에 window key를 토글 (MapControls와 동일 패턴)
 */
const CONSECUTIVE_CLICKS_TO_TOGGLE_DEBUG = 5;
const CLICK_RESET_MS = 800;

export function MapSidebar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const openedWindows = searchParams.get('opened')?.split(',').filter(Boolean) || [];
  const mapContext = useMapContext();
  const debugClickCountRef = useRef(0);
  const debugClickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDebugZoneClick = useCallback(() => {
    if (debugClickTimeoutRef.current) {
      clearTimeout(debugClickTimeoutRef.current);
      debugClickTimeoutRef.current = null;
    }
    debugClickCountRef.current += 1;
    if (debugClickCountRef.current >= CONSECUTIVE_CLICKS_TO_TOGGLE_DEBUG) {
      const next = !(mapContext?.showDebugUi ?? false);
      mapContext?.setShowDebugUi(next);
      debugClickCountRef.current = 0;
    } else {
      debugClickTimeoutRef.current = setTimeout(() => {
        debugClickCountRef.current = 0;
        debugClickTimeoutRef.current = null;
      }, CLICK_RESET_MS);
    }
  }, [mapContext]);

  // 좌측 사이드바는 4개 중 1개만 선택(배타)되도록 처리
  // - 버튼 클릭 시 opened를 해당 1개로 덮어씀
  // - 이미 활성화된 버튼을 다시 누르면 해제(열려있는 창 없음)
  const toggleWindow = (windowName: string) => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));

    const isCurrentlyActive = openedWindows.length === 1 && openedWindows[0] === windowName;
    if (isCurrentlyActive) {
      current.delete('opened');
    } else {
      current.set('opened', windowName);
    }

    router.push(`/map?${current.toString()}`);
  };

  return (
    <aside className="fixed left-0 top-0 h-screen w-[65px] bg-black/70 backdrop-blur-sm flex flex-col items-center pt-4 z-50">
      <div className="flex flex-col flex-1 min-h-0 w-full">
        <div className="flex flex-col">
        <SidebarButton
          icon={<Crop className="w-6 h-6" />}
          label="단면도"
          onClick={() => toggleWindow('sectionView')}
          isActive={openedWindows.includes('sectionView')}
        />
        <SidebarButton
          icon={<Download className="w-6 h-6" />}
          label="내려받기"
          onClick={() => toggleWindow('download')}
          isActive={openedWindows.includes('download')}
        />
        <SidebarButton
          icon={<PanelsLeftBottom className="w-6 h-6" />}
          label="필지분석"
          onClick={() => toggleWindow('landInfo')}
          isActive={openedWindows.includes('landInfo')}
        />
        <SidebarButton
          icon={<BarChart3 className="w-6 h-6" />}
          label="지도통계"
          onClick={() => toggleWindow('standardList')}
          isActive={openedWindows.includes('standardList')}
        />
        <SidebarButton
          icon={<LayoutList className="w-6 h-6" />}
          label="목록보기"
          onClick={() => toggleWindow('dataQuery')}
          isActive={openedWindows.includes('dataQuery')}
        />
        <SidebarButton
          icon={<Droplets className="w-6 h-6" />}
          label="급수공사"
          onClick={() => toggleWindow('waterSupply')}
          isActive={openedWindows.includes('waterSupply')}
        />
        <SidebarButton
          icon={<ClipboardList className="w-6 h-6" />}
          label="상수도 공사대장"
          onClick={() => toggleWindow('constructionLedger')}
          isActive={openedWindows.includes('constructionLedger')}
        />
        </div>
        <div className="flex-1 min-h-0 w-full" aria-hidden />
        {/* 사이드바 아래쪽 50px 히든 영역: 5번 연속 클릭 시 GeoServer 로그/줌레벨 표시 토글 */}
        <button
          type="button"
          onClick={handleDebugZoneClick}
          className="w-full shrink-0 h-[50px] cursor-default"
          style={{ minHeight: '50px' }}
          aria-label="디버그 패널 토글 (5회 연속 클릭)"
        />
      </div>
    </aside>
  );
}

