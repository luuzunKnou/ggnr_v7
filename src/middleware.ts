import { auth } from '@/auth';
import { NextResponse, type NextRequest } from 'next/server';

/** CSS/JS·이미지 등 — basePath(/프로젝트명) 뒤에서도 인증 리다이렉트 금지 */
function isStaticAssetPath(pathname: string): boolean {
  if (pathname.startsWith('/_next/')) return true;
  if (pathname.includes('/_next/')) return true;
  if (pathname.startsWith('/cesiumStatic/') || pathname === '/cesiumStatic') return true;
  if (pathname.includes('/cesiumStatic/')) return true;
  return /\.(?:css|js|map|mjs|cjs|json|svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|mp4|webm|ogg|mov)$/i.test(
    pathname
  );
}

/** basePath 유지한 앱 루트 URL (게이트에서 `/`로 떨어지지 않게) */
function appHomeUrl(req: NextRequest): URL {
  const home = req.nextUrl.clone();
  home.pathname = '/';
  home.search = '';
  home.hash = '';
  return home;
}

export default auth((req) => {
  const path = req.nextUrl.pathname;

  // basePath 사용 시 matcher만으로는 _next 제외가 깨질 수 있음 → 핸들러에서도 방어
  if (isStaticAssetPath(path)) return NextResponse.next();

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
    const home = appHomeUrl(req);
    const dest = path + req.nextUrl.search;
    home.searchParams.set('next', dest);
    home.searchParams.set('openLogin', '1');
    return NextResponse.redirect(home);
  }

  if (loggedIn && path === '/login') {
    return NextResponse.redirect(appHomeUrl(req));
  }

  return NextResponse.next();
});

export const config = {
  /**
   * 게이트: dggskorea/[프로젝트명] → Next basePath.
   * 요청 path가 `/uav_ulsan/_next/static/...` 형태여도 _next·확장자 정적파일은 미들웨어 제외.
   */
  matcher: [
    '/((?!api/auth|_next/|(?:[^/]+/)+_next/|favicon.ico|.*\\.(?:css|js|map|mjs|cjs|svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|mp4|webm|ogg|mov)$).*)',
  ],
};
