'use client';

import React, { useRef, useCallback, useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useMapContext } from './MapContext';
import { call } from '@/lib/api';
import { sidebarServicePolicy } from '@/lib/accessClient';
import { useMyAccessSnapshot } from '@/hooks/useMyAccessSnapshot';
import { ResourceAccessDeniedDialog } from '@/app/(pages)/_components/AccessRequest';
import { getOpenedKeyForSerEng } from '@/lib/mapServiceOpened';
import { openShapeEditorMapWindow } from '@/lib/shapeEditorWindow';

type ServiceItem = {
  ser_eng: string | null;
  ser_kor: string | null;
  ser_svg: string | null;
  ser_is_private?: boolean | null;
};

interface SidebarButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  isActive?: boolean;
  disabled?: boolean;
}

function SidebarButton({ icon, label, onClick, isActive, disabled }: SidebarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        'flex flex-col items-center justify-center pt-[7px] pb-[7px] w-[65px] text-white/90 hover:text-white hover:bg-white/10 transition-colors',
        isActive && 'bg-white/20 text-white',
        disabled && 'opacity-35 pointer-events-none cursor-not-allowed hover:bg-transparent'
      )}
    >
      {icon}
      <span className="text-[10.5px] pt-[4px] break-keep text-center font-light">{label}</span>
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

export function MapSidebar({ indexLogoSrc }: { indexLogoSrc: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawOpened = searchParams.get('opened')?.split(',').filter(Boolean) || [];
  const openedWindows = rawOpened.map((w) => (w === 'dataQuery' ? 'standardList' : w));
  const mapContext = useMapContext();
  const debugClickCountRef = useRef(0);
  const debugClickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [serviceListConfig, setServiceListConfig] = useState<ServiceItem[]>([]);
  const [systemList, setSystemList] = useState<{ sys_key: string; serviceList?: string[] }[]>([]);
  const [deniedSerOpen, setDeniedSerOpen] = useState(false);
  const [deniedSerEng, setDeniedSerEng] = useState('');
  const { snapshot, loading: accessLoading } = useMyAccessSnapshot();

  const systemKeyFromUrl = searchParams.get('system') ?? '';

  const fetchServiceList = useCallback(() => {
    call('', 'POST', { service: 'configService', action: 'getServiceList', params: {} })
      .then((res) => {
        const data = res?.data ?? res;
        const ser = Array.isArray(data?.ser) ? data.ser : [];
        setServiceListConfig(
          ser.map((s: { ser_eng?: string; ser_kor?: string; ser_svg?: string | null; ser_is_private?: boolean | null }) => ({
            ser_eng: s.ser_eng ?? null,
            ser_kor: s.ser_kor ?? null,
            ser_svg: s.ser_svg ?? null,
            ser_is_private: s.ser_is_private === true ? true : s.ser_is_private === false ? false : null,
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
  const firstSystem = systemList[0];
  const fromCurrent =
    currentSystem?.serviceList != null && currentSystem.serviceList.length > 0
      ? currentSystem.serviceList
      : null;
  const fromFirst =
    firstSystem?.serviceList != null && firstSystem.serviceList.length > 0 ? firstSystem.serviceList : null;
  const serviceKeysInOrder: string[] = fromCurrent ?? fromFirst ?? [];
  const serviceMap = new Map(serviceListConfig.map((s) => [s.ser_eng ?? '', s]));
  const sidebarItemsRaw: ServiceItem[] = serviceKeysInOrder
    .map((key) => serviceMap.get(key))
    .filter((s): s is ServiceItem => s != null);

  const sidebarItems = sidebarItemsRaw.filter((item) => {
    if (item.ser_is_private !== true) return true;
    if (accessLoading) return false;
    return sidebarServicePolicy(snapshot, item.ser_eng ?? '', true) !== 'hidden';
  });

  const roadDataFlowSidebarLock = openedWindows.includes('roadDataFlow');

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

  const handleShapeEditorClick = useCallback(() => {
    openShapeEditorMapWindow(systemKeyFromUrl || null);
  }, [systemKeyFromUrl]);

  const renderServiceIcon = (item: ServiceItem) => {
    const svgRaw = item.ser_svg?.trim() ?? '';
    const serEng = item.ser_eng ?? '';
    const isInlineSvg = svgRaw.startsWith('<');
    if (svgRaw && isInlineSvg) {
      return (
        <span
          className="w-5 h-5 shrink-0 [&_svg]:w-full [&_svg]:h-full [&_svg]:fill-none [&_svg]:stroke-current"
          dangerouslySetInnerHTML={{ __html: svgRaw }}
        />
      );
    }
    const iconSrc = `/image/serviceListIcon/${serEng}.svg`;
    return (
      <span
        className="w-5 h-5 shrink-0 inline-block bg-current"
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
    <aside className="fixed left-0 top-0 flex h-screen w-[65px] flex-col items-center overflow-hidden bg-black/40 pt-2 backdrop-blur-sm z-50">
      <Link
        href="/"
        className="mb-1.5 flex h-[38px] w-[65px] shrink-0 items-center justify-center rounded transition-colors hover:bg-white/10"
        title="메인으로"
      >
        <Image
          src={indexLogoSrc}
          alt="메인으로"
          width={40}
          height={40}
          className="max-h-10 max-w-[35px] h-auto w-auto object-contain"
        />
      </Link>
      <nav className="flex min-h-0 w-full flex-1 flex-col overflow-x-hidden overflow-y-auto" aria-label="서비스 메뉴">
        {sidebarItems.map((item) => {
          const serEng = item.ser_eng ?? '';
          const openedKey = getOpenedKeyForSerEng(serEng);
          const label = item.ser_kor ?? serEng;
          const isPriv = item.ser_is_private === true;
          const policy = isPriv ? sidebarServicePolicy(snapshot, serEng, true) : 'open';
          const onSvcClick =
            policy === 'block'
              ? () => {
                  setDeniedSerEng(serEng);
                  setDeniedSerOpen(true);
                }
              : serEng === 'shapeEditor'
                ? handleShapeEditorClick
                : serEng === 'parcelAnalysis'
                  ? () => {
                      /* 필지분석: UI만 유지, 패널/URL 토글 없음 */
                    }
                  : () => toggleWindow(openedKey);
          const svcDisabled =
            policy !== 'block' && roadDataFlowSidebarLock && openedKey !== 'roadDataFlow';
          return (
            <SidebarButton
              key={serEng}
              icon={renderServiceIcon(item)}
              label={label}
              onClick={onSvcClick}
              isActive={
                policy !== 'block' &&
                serEng !== 'parcelAnalysis' &&
                serEng !== 'shapeEditor' &&
                openedWindows.includes(openedKey)
              }
              disabled={policy === 'block' ? false : svcDisabled}
            />
          );
        })}
      </nav>
      <button
        type="button"
        onClick={handleDebugZoneClick}
        className="h-[50px] w-full shrink-0 cursor-default"
        style={{ minHeight: '50px' }}
        aria-label="디버그 패널 토글 (5회 연속 클릭)"
      />
      <ResourceAccessDeniedDialog
        open={deniedSerOpen}
        onOpenChange={setDeniedSerOpen}
        resource="service"
        serEng={deniedSerEng}
      />
    </aside>
  );
}

