'use client';

import { useSession } from 'next-auth/react';
import { withBasePathNav } from '@/lib/basePath';
import { isSuperUser } from '@/lib/auth/superUser';

const ODOR_INDEX_HREF = '/odor-index';

/** Index 헤더 «odor_index 보기» — 슈퍼계정만 표시 */
export function OdorIndexNavLink() {
  const { data: session, status } = useSession();

  if (status === 'loading') return null;
  if (!isSuperUser(session?.user?.id)) return null;

  return (
    <button
      type="button"
      title="odor_index 보기"
      onClick={() => window.location.assign(withBasePathNav(ODOR_INDEX_HREF))}
      className="flex cursor-pointer items-center gap-1 rounded-[5px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <svg
        className="h-4.5 w-4.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
      >
        <path d="M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0" />
        <path d="M12 7v5l3 3" />
      </svg>
      <span className="text-[13px]">odor_index 보기</span>
    </button>
  );
}
