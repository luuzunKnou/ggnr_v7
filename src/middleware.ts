import { auth } from '@/auth';
import { getBasePath } from '@/lib/basePath';
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

/** 게이트 프록시가 보는 공개 origin (x-forwarded-* 우선) */
function publicOrigin(req: NextRequest): string {
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || req.headers.get('host')?.trim() || req.nextUrl.host;
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const proto =
    forwardedProto ||
    (req.nextUrl.protocol ? req.nextUrl.protocol.replace(/:$/, '') : '') ||
    'http';
  return `${proto}://${host}`;
}

/**
 * 앱 홈으로 리다이렉트 (Location은 반드시 절대 URL — 상대면 Next edge가 Invalid URL → 500).
 * 공개 origin + getBasePath()로 내어, 백엔드 Host Location이 ProxyPassReverse에
 * 걸려 build_yy_v6build_yy 처럼 이어 붙는 경우를 줄인다.
 *
 * pathname은 basePath 있을 때 `${base}` (끝 / 없음) — 게이트 ProxyPass·Reverse도 /build_yy 형태.
 * BASE_PATH env 값과 동일하게 유지.
 */
function redirectToAppHome(req: NextRequest, query?: Record<string, string>): NextResponse {
  const base = getBasePath();
  const home = new URL(base || '/', publicOrigin(req));
  home.search = '';
  home.hash = '';
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      home.searchParams.set(k, v);
    }
  }
  return NextResponse.redirect(home);
}

export default auth((req) => {
  const path = req.nextUrl.pathname;

  // basePath 사용 시 matcher만으로는 _next 제외가 깨질 수 있음 → 핸들러에서도 방어
  if (isStaticAssetPath(path)) return NextResponse.next();

  // GeoServer 동일출처 프록시 (WMS img 등) — 로그인 리다이렉트 금지
  if (
    path === '/geoserver' ||
    path.startsWith('/geoserver/') ||
    path.includes('/geoserver/')
  ) {
    return NextResponse.next();
  }

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
    const dest = path + req.nextUrl.search;
    return redirectToAppHome(req, { next: dest, openLogin: '1' });
  }

  if (loggedIn && path === '/login') {
    return redirectToAppHome(req);
  }

  return NextResponse.next();
});

export const config = {
  /**
   * 게이트: dggskorea/[프로젝트명] → Next basePath.
   * 요청 path가 `/uav_ulsan/_next/static/...` 형태여도 _next·확장자 정적파일은 미들웨어 제외.
   *
   * `'/'` 필수: basePath 홈(`/build_yy`)은 앱 경로 `/` 인데,
   * 아래 캡처 패턴만으로는 루트가 미매칭되어 빈 200이 된다 (Next 16).
   */
  matcher: [
    '/',
    '/((?!api/auth|_next/|(?:[^/]+/)+_next/|favicon.ico|.*\\.(?:css|js|map|mjs|cjs|svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|mp4|webm|ogg|mov)$).*)',
  ],
};
