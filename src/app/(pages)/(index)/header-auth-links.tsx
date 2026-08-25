'use client';

import { useSession, signOut } from 'next-auth/react';
import { useLoginModal } from '@/app/login-modal-context';
import { withBasePathNav } from '@/lib/basePath';

export function HeaderAuthLinks() {
  const { data: session, status } = useSession();
  const { openLogin, openSignUp } = useLoginModal();

  if (status === 'loading') {
    return <span className="text-[13px] text-muted-foreground">…</span>;
  }

  if (!session?.user) {
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => openSignUp()}
          title="가입신청"
        >
          <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <line x1="19" x2="19" y1="8" y2="14" />
            <line x1="22" x2="16" y1="11" y2="11" />
          </svg>
          <span className="text-[13px]">가입신청</span>
        </button>
        <button
          type="button"
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => openLogin()}
        >
          <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" x2="9" y1="12" y2="12" />
          </svg>
          <span className="text-[13px]">로그인</span>
        </button>
      </div>
    );
  }

  const roleLabel =
    session.user.id === 'su' ? '[슈퍼관리자]' : `[${session.user.name ?? session.user.id}]`;

  return (
    <div className="flex items-center gap-3">
      <span
        className="text-[13px] text-muted-foreground max-w-[180px] truncate"
        title={session.user.id === 'su' ? '슈퍼관리자' : `${session.user.name ?? session.user.id}`}
      >
        {roleLabel}
      </span>
      <button
        type="button"
        className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
        onClick={async () => {
          await signOut({ redirect: false });
          window.location.assign(withBasePathNav('/'));
        }}
      >
        로그아웃
      </button>
    </div>
  );
}
