'use client';

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Layers, Download, MapPin, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

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
      <span className="text-[11px] mt-1 font-medium">{label}</span>
    </button>
  );
}

/**
 * 좌측 고정 사이드바 (65px)
 * - 디자인은 사용자 제공 `map-sidebar.tsx` 참고
 * - 클릭 시 URL query param `opened`에 window key를 토글 (MapControls와 동일 패턴)
 */
export function MapSidebar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const openedWindows = searchParams.get('opened')?.split(',').filter(Boolean) || [];

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
      <div className="flex flex-col">
        <SidebarButton
          icon={<Layers className="w-6 h-6" />}
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
          icon={<MapPin className="w-6 h-6" />}
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
      </div>
    </aside>
  );
}

