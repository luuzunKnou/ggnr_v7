'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { refreshBizNotifs } from '@/app/(pages)/map/_mapContents/bizNotif/bizNotifClient';

/** 로그인 후 시스템 선택 화면에서 알림 후보를 미리 받아 둠 */
export function BizNotifPrefetch() {
  const { status } = useSession();

  useEffect(() => {
    if (status !== 'authenticated') return;
    void refreshBizNotifs({ system: null });
  }, [status]);

  return null;
}
