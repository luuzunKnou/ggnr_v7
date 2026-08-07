import { auth } from '@/auth';
import { NextResponse } from 'next/server';

export default auth((req) => {
  const path = req.nextUrl.pathname;
  const isApiAuth = path.startsWith('/api/auth');
  const isApi = path.startsWith('/api');
  if (isApiAuth) return NextResponse.next();
  if (isApi) return NextResponse.next();

  const loggedIn = !!req.auth;

  if (!loggedIn) {
    if (path === '/') return NextResponse.next();
    if (path === '/signup' || path.startsWith('/signup/')) return NextResponse.next();
    if (path === '/notice' || path.startsWith('/notice/')) return NextResponse.next();
    if (path === '/library' || path.startsWith('/library/')) return NextResponse.next();
    const home = new URL('/', req.nextUrl);
    const dest = path + req.nextUrl.search;
    home.searchParams.set('next', dest);
    home.searchParams.set('openLogin', '1');
    return NextResponse.redirect(home);
  }

  if (loggedIn && path === '/login') {
    return NextResponse.redirect(new URL('/', req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  /** public 정적 자산(이미지·동영상)은 인증 없이 서빙 — mp4 제외 시 영상 요청이 미들웨어에 걸려 로드 실패 */
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|webm|ogg|mov)$).*)',
  ],
};
