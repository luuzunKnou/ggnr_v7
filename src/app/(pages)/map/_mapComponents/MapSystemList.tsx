'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LayoutGrid, Check } from 'lucide-react';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';

type SystemItem = {
  sys_key: string;
  sys_kor: string;
  sys_eng?: string;
  sys_detail?: string;
  sys_idx?: number;
  sys_col?: string;
  serviceList?: string[];
};

const SYSTEM_LIST_WIDTH = 200;

/**
 * 지도 우측 시스템 목록
 * - URL query `system`으로 현재 시스템 구분
 * - 클릭 시 해당 시스템으로 이동(URL 갱신)
 */
export function MapSystemList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const systemKeyFromUrl = searchParams.get('system') ?? '';

  const [systemList, setSystemList] = useState<SystemItem[]>([]);

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
    if (systemList.length > 0 && !systemKeyFromUrl) {
      const firstKey = systemList[0]?.sys_key;
      if (firstKey) {
        const current = new URLSearchParams(Array.from(searchParams.entries()));
        current.set('system', firstKey);
        router.replace(`/map?${current.toString()}`);
      }
    }
  }, [systemList, systemKeyFromUrl, searchParams, router]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchSystemList();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [fetchSystemList]);

  const selectSystem = (sysKey: string) => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    if (sysKey) {
      current.set('system', sysKey);
    } else {
      current.delete('system');
    }
    router.push(`/map?${current.toString()}`);
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
                onClick={() => selectSystem(sys.sys_key)}
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
    </div>
  );
}
