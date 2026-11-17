'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { call } from '@/lib/api';
import { refreshBizNotifs } from '../_mapContents/bizNotif/bizNotifClient';

/** 로그인·시스템 확정 후 업무 알림 갱신 (전체 조회 후 시스템·메뉴 필터) */
export function UsageDataAsNotifBootstrap() {
  const { status } = useSession();
  const searchParams = useSearchParams();
  const system = String(searchParams.get('system') ?? '').trim();
  const [systemServices, setSystemServices] = useState<
    { sys_key: string; serviceList: string[] }[]
  >([]);

  useEffect(() => {
    call('', 'POST', { service: 'configService', action: 'getSystemList', params: {} })
      .then((res) => {
        const data = res?.data ?? res;
        const systems = Array.isArray(data?.systems) ? data.systems : [];
        setSystemServices(
          systems.map((s: { sys_key?: string; serviceList?: string[] }) => ({
            sys_key: String(s?.sys_key ?? '').trim(),
            serviceList: Array.isArray(s?.serviceList) ? s.serviceList : [],
          }))
        );
      })
      .catch(() => setSystemServices([]));
  }, []);

  useEffect(() => {
    if (status === 'loading') return;
    if (status !== 'authenticated') {
      void refreshBizNotifs({ system: null, serviceList: null });
      return;
    }
    const serviceList =
      systemServices.find((s) => s.sys_key === system)?.serviceList ?? null;
    void refreshBizNotifs({
      system: system || null,
      serviceList: system ? serviceList : null,
    });
  }, [status, system, systemServices]);

  return null;
}
