'use client';

import React, { useRef, useCallback, useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronUp, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { call } from '@/lib/api';
import { sidebarServicePolicy } from '@/lib/accessClient';
import { useMyAccessSnapshot } from '@/hooks/useMyAccessSnapshot';
import { ResourceAccessDeniedDialog } from '@/app/(pages)/_components/AccessRequest';
import { getOpenedKeyForSerEng } from '@/lib/mapServiceOpened';
import { openShapeEditorMapWindow } from '@/lib/shapeEditorWindow';
import {
  hasProtoUnreadNotifications,
  PROTO_NOTIF_CHANGED_EVENT,
} from '../_mapContents/bizNotif/bizNotifStore';
import { ImportantNotifSidebarBubble } from '../_mapContents/prototypes/UserAccountProtoPanel';
import { SHOOTING_REQUEST_UI_ENABLED } from '../_mapContents/shootingRequest/shootingRequestUiFlag';

type ServiceItem = {
  ser_eng: string | null;
  ser_kor: string | null;
  ser_svg: string | null;
  ser_is_private?: boolean | null;
  /** true면 사이드바에서 제외(관리자 포함) */
  ser_is_del?: boolean | null;
};

interface SidebarButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  isActive?: boolean;
  disabled?: boolean;
  /** true면 아이콘만 (하단 알림·사용자) */
  iconOnly?: boolean;
  className?: string;
}

function SidebarButton({ icon, label, onClick, isActive, disabled, iconOnly, className }: SidebarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'flex w-[65px] flex-col items-center justify-center text-white/90 transition-colors hover:bg-white/10 hover:text-white',
        iconOnly ? 'py-2.5' : 'pb-[7px] pt-[7px]',
        isActive && 'bg-white/20 text-white',
        disabled && 'pointer-events-none cursor-not-allowed opacity-35 hover:bg-transparent',
        className
      )}
    >
      {icon}
      {!iconOnly && (
        <span className="break-keep pt-[4px] text-center text-[10.5px] font-light">{label}</span>
      )}
    </button>
  );
}

/**
 * 좌측 고정 사이드바 (65px)
 * - 클릭 시 URL query param `opened`에 window key를 토글 (MapControls와 동일 패턴)
 */
export function MapSidebar({ indexLogoSrc }: { indexLogoSrc: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawOpened = searchParams.get('opened')?.split(',').filter(Boolean) || [];
  const openedWindows = rawOpened.map((w) => (w === 'dataQuery' ? 'standardList' : w));
  const navScrollRef = useRef<HTMLDivElement>(null);
  const myInfoAnchorRef = useRef<HTMLDivElement>(null);
  const navScrollHoldRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [navHover, setNavHover] = useState(false);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [protoNotifUnread, setProtoNotifUnread] = useState(false);

  useEffect(() => {
    const sync = () => setProtoNotifUnread(hasProtoUnreadNotifications());
    sync();
    window.addEventListener(PROTO_NOTIF_CHANGED_EVENT, sync);
    return () => window.removeEventListener(PROTO_NOTIF_CHANGED_EVENT, sync);
  }, []);

  const updateNavScrollState = useCallback(() => {
    const el = navScrollRef.current;
    if (!el) {
      setCanScrollUp(false);
      setCanScrollDown(false);
      return;
    }
    setCanScrollUp(el.scrollTop > 2);
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
  }, []);

  const stopNavScrollHold = useCallback(() => {
    if (navScrollHoldRef.current) {
      clearInterval(navScrollHoldRef.current);
      navScrollHoldRef.current = null;
    }
  }, []);

  const startNavScrollHold = useCallback(
    (dir: -1 | 1) => {
      stopNavScrollHold();
      const step = () => {
        const el = navScrollRef.current;
        if (!el) return;
        el.scrollBy({ top: dir * 28, behavior: 'auto' });
        updateNavScrollState();
      };
      step();
      navScrollHoldRef.current = setInterval(step, 50);
    },
    [stopNavScrollHold, updateNavScrollState]
  );

  const [serviceListConfig, setServiceListConfig] = useState<ServiceItem[]>([]);
  const [systemList, setSystemList] = useState<{ sys_key: string; serviceList?: string[] }[]>([]);
  const [deniedSerOpen, setDeniedSerOpen] = useState(false);
  const [deniedSerEng, setDeniedSerEng] = useState('');
  const [bootProject, setBootProject] = useState('');
  const { snapshot, loading: accessLoading } = useMyAccessSnapshot();

  const systemKeyFromUrl = searchParams.get('system') ?? '';

  const fetchServiceList = useCallback(() => {
    call('', 'POST', { service: 'configService', action: 'getServiceList', params: {} })
      .then((res) => {
        const data = res?.data ?? res;
        const ser = Array.isArray(data?.ser) ? data.ser : [];
        setServiceListConfig(
          ser.map(
            (s: {
              ser_eng?: string;
              ser_kor?: string;
              ser_svg?: string | null;
              ser_is_private?: boolean | null;
              ser_is_del?: boolean | null;
            }) => ({
              ser_eng: s.ser_eng ?? null,
              ser_kor: s.ser_kor ?? null,
              ser_svg: s.ser_svg ?? null,
              ser_is_private: s.ser_is_private === true ? true : s.ser_is_private === false ? false : null,
              ser_is_del: s.ser_is_del === true ? true : s.ser_is_del === false ? false : null,
            })
          )
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
    call('', 'POST', { service: 'configService', action: 'getBootProject', params: {} })
      .then((res) => {
        const data = res?.data ?? res;
        setBootProject(String(data?.project ?? '').trim());
      })
      .catch(() => setBootProject(''));
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
    .filter((s): s is ServiceItem => s != null)
    .filter((item) => {
      // 삭제여부 Y → 관리자 포함 사이드바에서 숨김
      if (item.ser_is_del === true) return false;
      if (bootProject === 'build_uj' && item.ser_eng === 'riverUseLedger') return false;
      return true;
    });

  const sidebarItems = sidebarItemsRaw.filter((item) => {
    // 비공개: 권한 없는 사용자만 숨김 (관리자·권한 있으면 보임)
    if (item.ser_is_private !== true) return true;
    if (accessLoading) return false;
    return sidebarServicePolicy(snapshot, item.ser_eng ?? '', true) !== 'hidden';
  });

  // master(jdong): roadDataFlow 열림 시 다른 메뉴 잠금 제거

  useEffect(() => {
    updateNavScrollState();
    const el = navScrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => updateNavScrollState());
    ro.observe(el);
    return () => {
      ro.disconnect();
      stopNavScrollHold();
    };
  }, [updateNavScrollState, stopNavScrollHold, sidebarItems.length]);

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
          className="h-auto max-h-10 w-auto max-w-[35px] object-contain"
        />
      </Link>
      <div className="flex min-h-0 w-full flex-1 flex-col">
        <nav
          className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden"
          aria-label="서비스 메뉴"
          onMouseEnter={() => setNavHover(true)}
          onMouseLeave={() => {
            setNavHover(false);
            stopNavScrollHold();
          }}
        >
          {navHover && canScrollUp && (
            <button
              type="button"
              className="absolute left-0 right-0 top-0 z-[2] flex h-6 items-center justify-center bg-gradient-to-b from-black/55 to-transparent text-white/90"
              aria-label="메뉴 위로 스크롤"
              onMouseEnter={() => startNavScrollHold(-1)}
              onMouseLeave={stopNavScrollHold}
            >
              <ChevronUp className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
          <div
            ref={navScrollRef}
            className="flex min-h-0 w-full flex-1 flex-col overflow-x-hidden overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onScroll={updateNavScrollState}
          >
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
                      ? () => toggleWindow(getOpenedKeyForSerEng(serEng))
                      : () => toggleWindow(openedKey);
              return (
                <SidebarButton
                  key={serEng}
                  icon={renderServiceIcon(item)}
                  label={label}
                  onClick={onSvcClick}
                  isActive={
                    policy !== 'block' &&
                    serEng !== 'shapeEditor' &&
                    openedWindows.includes(openedKey)
                  }
                  disabled={false}
                />
              );
            })}
          </div>
          {navHover && canScrollDown && (
            <button
              type="button"
              className="absolute bottom-0 left-0 right-0 z-[2] flex h-6 items-center justify-center bg-gradient-to-t from-black/55 to-transparent text-white/90"
              aria-label="메뉴 아래로 스크롤"
              onMouseEnter={() => startNavScrollHold(1)}
              onMouseLeave={stopNavScrollHold}
            >
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </nav>
        {/* 계정 구역 */}
        <div className="relative mt-1 flex w-full shrink-0 flex-col border-t border-white/15 pb-[5px] pt-1">
          <div ref={myInfoAnchorRef} className="w-full">
            <SidebarButton
              icon={
                <span
                  className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white"
                  style={{ backgroundColor: 'var(--color-blue-600)' }}
                >
                  <UserRound className="h-4 w-4" strokeWidth={2} aria-hidden />
                  {protoNotifUnread ? (
                    <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-red-500" />
                  ) : null}
                </span>
              }
              label="내 정보"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('ggnr-proto-user-account-toggle'));
              }}
            />
          </div>
          <ImportantNotifSidebarBubble anchorRef={myInfoAnchorRef} />
        </div>
      </div>
      <ResourceAccessDeniedDialog
        open={deniedSerOpen}
        onOpenChange={setDeniedSerOpen}
        resource="service"
        serEng={deniedSerEng}
      />
    </aside>
  );
}