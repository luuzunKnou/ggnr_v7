'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** 직접 URL 접근 시 홈에서 가입신청 모달을 연다. */
export default function SignUpPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/?openSignUp=1');
  }, [router]);

  return (
    <div className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">가입신청 화면으로 이동 중…</div>
  );
}
