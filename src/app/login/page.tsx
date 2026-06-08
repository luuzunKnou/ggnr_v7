import { redirect } from 'next/navigation';

/** 로그인은 루트 레이아웃 모달에서 처리 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const sp = await searchParams;
  const cb = sp.callbackUrl;
  if (cb && typeof cb === 'string' && cb.startsWith('/')) {
    redirect(`/?next=${encodeURIComponent(cb)}`);
  }
  redirect('/');
}
