import { getBasePath } from '@/lib/basePath';
import { getGeoServerInternalBase } from '@/lib/geoserverUrl';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

type HeaderSource = { headers: Headers; nextUrl: { protocol: string; host: string } };

/** 게이트가 보는 공개 origin. x-forwarded-* 가 있으면 그 값을 쓴다. */
export function publicOriginFromRequest(req: HeaderSource): string {
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || req.headers.get('host')?.trim() || req.nextUrl.host;
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const proto = forwardedProto || req.nextUrl.protocol.replace(/:$/, '') || 'http';
  return `${proto}://${host}`;
}

/** 브라우저가 `{basePath}/geoserver/...` 요청에 실어 보내는 쿠키 경로 */
export function geoserverPublicCookiePath(): string {
  return `${getBasePath()}/geoserver`;
}

export function isSecurePublicRequest(req: HeaderSource): boolean {
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const proto = forwardedProto || req.nextUrl.protocol.replace(/:$/, '') || 'http';
  return proto === 'https';
}

/**
 * GeoServer가 심는 Path=/geoserver 를 공개 경로로 바꾼다.
 * 게이트(`/build_yy/geoserver`)에서는 Path=/geoserver 쿠키가 다시 전송되지 않는다.
 */
export function rewriteGeoserverSetCookie(raw: string): string {
  const base = getBasePath();
  if (!base) return raw;
  return raw.replace(/Path=\/geoserver\b/g, `Path=${base}/geoserver`);
}

export function geoserverSessionCookie(sessionId: string, secure: boolean): string {
  const parts = [
    `JSESSIONID=${sessionId}`,
    `Path=${geoserverPublicCookiePath()}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function isInternalGeoserverUrl(url: URL): boolean {
  let internal: URL;
  try {
    internal = new URL(getGeoServerInternalBase());
  } catch {
    return false;
  }
  const prefix = internal.pathname.replace(/\/$/, '') || '/geoserver';
  const onGeoserver = url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
  if (!onGeoserver) return false;
  const local = new Set(['127.0.0.1', 'localhost', '::1', internal.hostname]);
  return local.has(url.hostname);
}

/** 내부 호스트로 돌아가는 Location 을 공개 GeoServer 경로로 되돌린다. */
export function rewriteGeoserverLocation(location: string, upstreamUrl: string, req: HeaderSource): string {
  let absolute: URL;
  try {
    absolute = new URL(location, upstreamUrl);
  } catch {
    return location;
  }
  if (!isInternalGeoserverUrl(absolute)) return location;
  const internalPath = new URL(getGeoServerInternalBase()).pathname.replace(/\/$/, '');
  const rest = absolute.pathname.slice(internalPath.length);
  return `${publicOriginFromRequest(req)}${getBasePath()}/geoserver${rest}${absolute.search}${absolute.hash}`;
}

export function buildGeoserverWebUpstream(path: string[] | undefined, search: string): string | null {
  const segments = path ?? [];
  if (segments.some((seg) => seg === '' || seg === '.' || seg === '..' || seg.includes('\\') || seg.includes('/'))) {
    return null;
  }
  const suffix = segments.map((seg) => encodeURIComponent(seg)).join('/');
  const base = getGeoServerInternalBase();
  return `${base}/web${suffix ? `/${suffix}` : ''}${search}`;
}

export async function proxyGeoserverWeb(req: Request & HeaderSource, upstreamUrl: string): Promise<Response> {
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    if (key.toLowerCase() === 'accept-encoding') return;
    if (key.toLowerCase() === 'accept-language') return;
    headers.append(key, value);
  });
  headers.set('accept-encoding', 'identity');
  headers.set('accept-language', 'ko-KR,ko;q=0.9');

  const method = req.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const upstream = await fetch(upstreamUrl, {
    method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(60000),
  });

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === 'set-cookie' || lower === 'location' || HOP_BY_HOP.has(lower)) return;
    out.append(key, value);
  });
  const location = upstream.headers.get('location');
  if (location) out.set('location', rewriteGeoserverLocation(location, upstreamUrl, req));

  const body = method === 'HEAD' ? null : upstream.body;
  const res = new Response(body, { status: upstream.status, headers: out });
  const setCookies =
    typeof upstream.headers.getSetCookie === 'function' ? upstream.headers.getSetCookie() : [];
  for (const raw of setCookies) {
    res.headers.append('set-cookie', rewriteGeoserverSetCookie(raw));
  }
  return res;
}
