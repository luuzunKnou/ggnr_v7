'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LayoutGrid, Check } from 'lucide-react';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';
import { canAccessPrivateSystem, type ClientAccessSnapshot } from '@/lib/accessClient';
import { useMyAccessSnapshot } from '@/hooks/useMyAccessSnapshot';
import { ResourceAccessDeniedDialog } from '@/app/(pages)/_components/AccessRequest';
import { scrubOccupationLedgerFromMapSearchParams } from '@/lib/occupationLedgerBinding';
import { scrubUseFeeFromMapSearchParams } from '@/lib/useFeeBinding';
import { useMapContext } from '@/app/(pages)/map/_mapComponents/MapContext';

type SystemItem = {
  sys_key: string;
  sys_kor: string;
  sys_eng?: string;
  sys_detail?: string;
  sys_idx?: number;
  sys_col?: string;
  serviceList?: string[];
  sys_is_private?: boolean | null;
};

const SYSTEM_LIST_WIDTH = 200;

/**
 * 지도 우측 시스템 목록
 * - URL query `system`으로 현재 시스템 구분
 * - 클릭 시 해당 시스템으로 이동(URL 갱신)
 */
function firstAllowedSystemKey(list: SystemItem[], snap: ClientAccessSnapshot): string {
  const row = list.find((s) => canAccessPrivateSystem(snap, s.sys_key, s.sys_is_private));
  return row?.sys_key ?? '';
}

export function MapSystemList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mapContext = useMapContext();
  const systemKeyFromUrl = searchParams.get('system') ?? '';
  const { snapshot, loading: accessLoading } = useMyAccessSnapshot();

  const [systemList, setSystemList] = useState<SystemItem[]>([]);
  const [deniedOpen, setDeniedOpen] = useState(false);
  const [deniedSysKey, setDeniedSysKey] = useState('');

  const fetchSystemList = useCallback(() => {
    call('', 'POST', { service: 'configService', action: 'getSystemList', params: {} })
      .then((res) => {
        const data = res?.data ?? res;
        const systems = Array.isArray(data?.systems) ? data.systems : [];
        const sorted = [...systems].sort(
          (a: SystemItem, b: SystemItem) => (Number(a.sys_idx) ?? 999) - (Number(b.sys_idx) ?? 999)
        );
        setSystemList(sorted);
      })
      .catch(() => setSystemList([]));
  }, []);

  useEffect(() => {
    fetchSystemList();
  }, [fetchSystemList]);

  useEffect(() => {
    if (accessLoading || systemList.length === 0) return;
    const firstAllowed = firstAllowedSystemKey(systemList, snapshot);
    const currentMeta = systemList.find((s) => s.sys_key === systemKeyFromUrl);
    const urlAllowed =
      !systemKeyFromUrl ||
      !currentMeta ||
      canAccessPrivateSystem(snapshot, systemKeyFromUrl, currentMeta.sys_is_private);

    if (!systemKeyFromUrl && firstAllowed) {
      const current = new URLSearchParams(Array.from(searchParams.entries()));
      current.set('system', firstAllowed);
      scrubOccupationLedgerFromMapSearchParams(current, firstAllowed);
      scrubUseFeeFromMapSearchParams(current, firstAllowed);
      router.replace(`/map?${current.toString()}`);
      return;
    }
    if (systemKeyFromUrl && !urlAllowed && firstAllowed) {
      const current = new URLSearchParams(Array.from(searchParams.entries()));
      current.set('system', firstAllowed);
      current.delete('opened');
      current.delete('dataTable');
      current.delete('dataKey');
      mapContext?.allLayersOffRef?.current?.();
      router.replace(`/map?${current.toString()}`);
    }
  }, [accessLoading, snapshot, systemList, systemKeyFromUrl, searchParams, router, mapContext]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchSystemList();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [fetchSystemList]);

  const selectSystem = (sysKey: string) => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    const systemChanged = sysKey !== systemKeyFromUrl;
    if (sysKey) {
      current.set('system', sysKey);
    } else {
      current.delete('system');
    }
    if (systemChanged) {
      current.delete('opened');
      current.delete('dataTable');
      current.delete('dataKey');
      mapContext?.allLayersOffRef?.current?.();
    } else {
      scrubOccupationLedgerFromMapSearchParams(current, sysKey);
      scrubUseFeeFromMapSearchParams(current, sysKey);
    }
    router.push(`/map?${current.toString()}`);
  };

  const trySelectSystem = (sys: SystemItem) => {
    if (!canAccessPrivateSystem(snapshot, sys.sys_key, sys.sys_is_private)) {
      setDeniedSysKey(sys.sys_key);
      setDeniedOpen(true);
      return;
    }
    selectSystem(sys.sys_key);
  };

  if (systemList.length === 0) return null;

  return (
    <div
      className="flex flex-col w-[var(--map-system-list-width)] shrink-0 bg-white/95 backdrop-blur-md border border-slate-200/80 rounded-lg shadow-md overflow-hidden"
      style={{ '--map-system-list-width': `${SYSTEM_LIST_WIDTH}px` } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100 bg-slate-50/80">
        <LayoutGrid className="w-4 h-4 text-slate-600 shrink-0" />
        <span className="text-sm font-semibold text-slate-800">시스템 목록</span>
      </div>
      <ul className="flex flex-col p-2 gap-1 overflow-y-auto max-h-[50vh]">
        {systemList.map((sys) => {
          const isSelected = sys.sys_key === systemKeyFromUrl;
          const accentColor = sys.sys_col || 'var(--primary)';
          return (
            <li key={sys.sys_key}>
              <button
                type="button"
                onClick={() => trySelectSystem(sys)}
                className={cn(
                  'w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all duration-200 border',
                  isSelected
                    ? 'border-transparent shadow-sm'
                    : 'border-transparent bg-slate-50/50 hover:bg-slate-100/80'
                )}
                style={
                  isSelected
                    ? { backgroundColor: `${accentColor}18`, borderColor: `${accentColor}40` }
                    : undefined
                }
              >
                <span
                  className="w-1.5 h-6 shrink-0 rounded-full"
                  style={{ backgroundColor: accentColor }}
                  aria-hidden
                />
                <span
                  className={cn(
                    'flex-1 min-w-0 truncate text-sm',
                    isSelected ? 'font-semibold text-slate-800' : 'font-medium text-slate-700'
                  )}
                >
                  {sys.sys_kor}
                </span>
                {isSelected && (
                  <Check className="w-4 h-4 shrink-0 text-primary" strokeWidth={2.5} />
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <ResourceAccessDeniedDialog
        open={deniedOpen}
        onOpenChange={setDeniedOpen}
        resource="system"
        sysKey={deniedSysKey}
      />
    </div>
  );
}
