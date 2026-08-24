'use client';

import { SessionProvider } from 'next-auth/react';
import { getBasePath } from '@/lib/basePath';

/**
 * Next basePath(/build_yy) 일 때 Auth API 는 /build_yy/api/auth.
 * SessionProvider 기본값 /api/auth 는 게이트에서 404 → 세션·API 실패.
 */
export function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  const base = getBasePath();
  const authBasePath = base ? `${base}/api/auth` : undefined;
  return <SessionProvider basePath={authBasePath}>{children}</SessionProvider>;
}
