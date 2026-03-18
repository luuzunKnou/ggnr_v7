'use client';

import React, { useRef, useCallback, useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useMapContext } from './MapContext';
import { call } from '@/lib/api';

/** ser_eng → URL opened 키 매핑 (기존 패널과 호환) */
const SER_ENG_TO_OPENED: Record<string, string> = {
  dataQuery: 'standardList',
  mapState: 'standardList',
  data3d: 'map3dData',
  parcelAnalysis: 'landInfo',
  tifManager: 'highQualityVideo',
  complaint: 'complaintManagement',
  memo: 'memoManagement',
  crossSection: 'sectionView',
  waterSupplyWork: 'waterSupply',
  waterworksLedger: 'constructionLedger',
};

function getOpenedKey(serEng: string): string {
  return SER_ENG_TO_OPENED[serEng] ?? serEng;
}

type ServiceItem = {
  ser_eng: string | null;
  ser_kor: string | null;
  ser_svg: string | null;
};

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
        'flex flex-col items-center justify-center pt-1.5 pb-1 w-[65px] h-[57px] text-white/80 hover:text-white hover:bg-white/10 transition-colors',
        isActive && 'bg-white/20 text-white'
      )}
    >
      {icon}
      <span className="text-[11px] mt-1 break-keep text-center leading-tight">{label}</span>
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
  const rawOpened = searchParams.get('opened')?.split(',').filter(Boolean) || [];
  const openedWindows = rawOpened.map((w) => (w === 'dataQuery' ? 'standardList' : w));
  const mapContext = useMapContext();
  const debugClickCountRef = useRef(0);
  const debugClickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [serviceListConfig, setServiceListConfig] = useState<ServiceItem[]>([]);
  const [systemList, setSystemList] = useState<{ sys_key: string; serviceList?: string[] }[]>([]);

  const systemKeyFromUrl = searchParams.get('system') ?? '';

  const fetchServiceList = useCallback(() => {
    call('', 'POST', { service: 'configService', action: 'getServiceList', params: {} })
      .then((res) => {
        const data = res?.data ?? res;
        const ser = Array.isArray(data?.ser) ? data.ser : [];
        setServiceListConfig(
          ser.map((s: { ser_eng?: string; ser_kor?: string; ser_svg?: string | null }) => ({
            ser_eng: s.ser_eng ?? null,
            ser_kor: s.ser_kor ?? null,
            ser_svg: s.ser_svg ?? null,
          }))
        );
      })
      .catch(() => setServiceListConfig([]));
  }, []);

  const fetchSystemList = useCallback(() => {
    call('', 'POST', { service: 'configService', action: 'getSystemList', params: {} })
      .then((res) => {
        const data = res?.data ?? res;
        const systems = Array.isArray(data?.systems) ? data.systems : [];
        setSystemList(
          systems.map((s: { sys_key?: string; serviceList?: string[] }) => ({
            sys_key: s.sys_key ?? '',
            serviceList: Array.isArray(s.serviceList) ? s.serviceList : [],
          }))
        );
      })
      .catch(() => setSystemList([]));
  }, []);

  useEffect(() => {
    fetchServiceList();
    fetchSystemList();
  }, [fetchServiceList, fetchSystemList]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchServiceList();
        fetchSystemList();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [fetchServiceList, fetchSystemList]);

  // systemList.config 의 해당 시스템 serviceList 만 사용 (serviceList.config 전체가 아님)
  const currentSystem = systemList.find((s) => s.sys_key === systemKeyFromUrl);
  const serviceKeysInOrder: string[] =
    currentSystem?.serviceList?.length > 0
      ? currentSystem.serviceList
      : systemList[0]?.serviceList?.length
        ? systemList[0].serviceList!
        : [];
  const serviceMap = new Map(serviceListConfig.map((s) => [s.ser_eng ?? '', s]));
  const sidebarItems: ServiceItem[] = serviceKeysInOrder
    .map((key) => serviceMap.get(key))
    .filter((s): s is ServiceItem => s != null);

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

  const renderServiceIcon = (item: ServiceItem) => {
    const svgRaw = item.ser_svg?.trim() ?? '';
    const serEng = item.ser_eng ?? '';
    const isInlineSvg = svgRaw.startsWith('<');
    if (svgRaw && isInlineSvg) {
      return (
        <span
          className="w-6 h-6 [&_svg]:w-full [&_svg]:h-full [&_svg]:fill-none [&_svg]:stroke-current"
          dangerouslySetInnerHTML={{ __html: svgRaw }}
        />
      );
    }
    const iconSrc = `/image/serviceListIcon/${serEng}.svg`;
    return (
      <span
        className="w-6 h-6 shrink-0 inline-block bg-current"
        style={{
          WebkitMaskImage: `url(${iconSrc})`,
          maskImage: `url(${iconSrc})`,
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
        }}
        role="img"
        aria-hidden
      />
    );
  };

  return (
    <aside className="fixed left-0 top-0 h-screen w-[65px] bg-black/70 backdrop-blur-sm flex flex-col items-center pt-2 z-50">
      <div className="flex flex-col flex-1 min-h-0 w-full">
        <div className="flex flex-col flex-1 min-h-0">
          <Link
            href="/"
            className="flex items-center justify-center w-[65px] h-[45px] shrink-0 mb-2 hover:bg-white/10 transition-colors rounded"
            title="메인으로"
          >
            <Image
              src="/ggnr_ai.svg"
              alt="GGNR AI"
              width={44}
              height={40}
              className="object-contain brightness-0 invert"
            />
          </Link>
          {sidebarItems.map((item) => {
            const serEng = item.ser_eng ?? '';
            const openedKey = getOpenedKey(serEng);
            const label = item.ser_kor ?? serEng;
            return (
              <SidebarButton
                key={serEng}
                icon={renderServiceIcon(item)}
                label={label}
                onClick={() => toggleWindow(openedKey)}
                isActive={openedWindows.includes(openedKey)}
              />
            );
          })}
        </div>
        <div className="flex-1 min-h-0 w-full shrink-0" aria-hidden />
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

