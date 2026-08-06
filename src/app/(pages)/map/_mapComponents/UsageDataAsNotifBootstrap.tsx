'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { refreshBizNotifs } from '../_mapContents/bizNotif/bizNotifClient';

/** 로그인·시스템 확정 후 업무 알림 갱신 (전체 조회 후 시스템 필터) */
export function UsageDataAsNotifBootstrap() {
  const { status } = useSession();
  const searchParams = useSearchParams();
  const system = String(searchParams.get('system') ?? '').trim();

  useEffect(() => {
    if (status === 'loading') return;
    if (status !== 'authenticated') {
      void refreshBizNotifs({ system: null });
      return;
    }
    // 서버에서 전체 후보+읽음상태 수신 후, 현재 system= 만 화면에 표시
    void refreshBizNotifs({ system: system || null });
  }, [status, system]);

  return null;
}
