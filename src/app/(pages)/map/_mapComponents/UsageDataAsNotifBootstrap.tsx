'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import {
  refreshUsageDataAsExpiryNotifs,
  setUsageDataAsNotifUsrId,
} from '../_mapContents/river/usageDataAs/usageDataAsExpiryNotifClient';

/** 로그인 계정 확정 후 만료 알림 prefetch (사이드바·말풍선용) */
export function UsageDataAsNotifBootstrap() {
  const { data: session, status } = useSession();
  const usrId = String(session?.user?.id ?? '').trim();

  useEffect(() => {
    if (status === 'loading') return;
    setUsageDataAsNotifUsrId(usrId);
    if (!usrId) {
      void refreshUsageDataAsExpiryNotifs();
      return;
    }
    void refreshUsageDataAsExpiryNotifs();
  }, [status, usrId]);

  return null;
}
