'use client';

import { useSession } from 'next-auth/react';

const SYS_MANAGER_HREF = '/sysManager';

/** Index 헤더 «시스템 관리» — 로그인 후 su만 진입, 그 외 alert */
export function SysManagerNavLink() {
  const { data: session, status } = useSession();

  const goOrDeny = () => {
    if (status === 'loading') return;
    if (!session?.user) {
      // 미로그인 → /sysManager 진입 → middleware가 next·openLogin으로 로그인 유도
      window.location.assign(SYS_MANAGER_HREF);
      return;
    }
    if (session.user.id !== 'su') {
      window.alert('권한이 없습니다');
      return;
    }
    window.location.assign(SYS_MANAGER_HREF);
  };

  return (
    <button
      type="button"
      title="시스템 관리"
      onClick={goOrDeny}
      className="flex cursor-pointer items-center gap-1 rounded-[5px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
      <span className="text-[13px]">시스템 관리</span>
    </button>
  );
}
