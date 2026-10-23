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

/** 브라우저가 여는 GeoServer 기준 주소. 게이트 경로가 있으면 그 앞에 붙는다. */
export function geoserverPublicBase(req: HeaderSource): string {
  return `${publicOriginFromRequest(req)}${getBasePath()}/geoserver`;
}

/**
 * GeoServer가 페이지에 심는 내부 절대주소.
 * 요청 Host가 127.0.0.1 이어도 응답에는 localhost 가 섞인다.
 */
function internalGeoserverBases(): string[] {
  const raw = getGeoServerInternalBase().replace(/\/$/, '');
  const bases = new Set<string>([raw]);
  try {
    const internal = new URL(raw);
    const path = internal.pathname.replace(/\/$/, '');
    const port = internal.port ? `:${internal.port}` : '';
    for (const host of ['127.0.0.1', 'localhost', '::1', internal.hostname]) {
      const hostPort = host.includes(':') ? `[${host}]${port}` : `${host}${port}`;
      bases.add(`${internal.protocol}//${hostPort}${path}`);
    }
  } catch {
    /* 설정된 주소만 사용 */
  }
  return [...bases];
}

/** HTML·Ajax XML 안의 내부 주소를 공개 주소로 바꾼다. 스크립트·폼·범례 주소가 페이지와 같은 출처가 되게 한다. */
export function rewriteGeoserverPublicUrls(text: string, req: HeaderSource): string {
  const published = geoserverPublicBase(req);
  let next = text;
  for (const needle of internalGeoserverBases()) {
    if (!needle || needle === published) continue;
    next = next.split(needle).join(published);
  }
  return next;
}

function shouldRewriteGeoserverBody(contentType: string): boolean {
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return (
    mime.startsWith('text/') ||
    mime === 'application/xml' ||
    mime === 'application/xhtml+xml' ||
    mime === 'application/json' ||
    mime === 'application/javascript' ||
    mime === 'application/x-javascript'
  );
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

/**
 * Wicket 버튼 동작은 값이 없는 쿼리 이름이다. `1-2.0-validate`
 * Next 가 이걸 `1-2.0-validate=` 로 바꾸면 동작 번호를 못 찾아 버튼이 멈춘다.
 */
function isWicketListenerKey(key: string): boolean {
  return /^\d+(?:-\d+(?:\.\d+)*(?:-[A-Za-z0-9_.:~-]+)?)?$/.test(key);
}

export function restoreWicketListenerQuery(search: string): string {
  if (!search || search === '?') return search;
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const parts = raw.split('&').map((part) => {
    const eq = part.indexOf('=');
    if (eq <= 0) return part;
    const key = part.slice(0, eq);
    if (part.slice(eq + 1) !== '') return part;
    let decoded = key;
    try {
      decoded = decodeURIComponent(key);
    } catch {
      return part;
    }
    return isWicketListenerKey(decoded) ? key : part;
  });
  return `?${parts.join('&')}`;
}

export function buildGeoserverWebUpstream(path: string[] | undefined, search: string): string | null {
  const segments = path ?? [];
  if (segments.some((seg) => seg === '' || seg === '.' || seg === '..' || seg.includes('\\') || seg.includes('/'))) {
    return null;
  }
  const suffix = segments.map((seg) => encodeURIComponent(seg)).join('/');
  const base = getGeoServerInternalBase();
  return `${base}/web${suffix ? `/${suffix}` : ''}${restoreWicketListenerQuery(search)}`;
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * 버튼 요청의 Origin 은 공개 주소다. GeoServer 는 내부 주소로 받아 둘이 다르면 400 으로 거절한다.
 * 이 화면에서 온 요청만 내부 주소로 맞춘다. 다른 사이트 Origin 은 그대로 두어 거절되게 한다.
 */
function alignGeoserverSourceHeaders(headers: Headers, req: HeaderSource, upstreamUrl: string) {
  let internalOrigin: string;
  try {
    internalOrigin = new URL(upstreamUrl).origin;
  } catch {
    return;
  }
  const allowed = publicOriginFromRequest(req);
  const origin = headers.get('origin');
  if (origin && origin !== 'null' && sameOrigin(origin, allowed)) {
    headers.set('origin', internalOrigin);
  }
  const referer = headers.get('referer');
  if (!referer || !sameOrigin(referer, allowed)) return;
  const publicBase = `${allowed}${getBasePath()}/geoserver`;
  const internalBase = getGeoServerInternalBase().replace(/\/$/, '');
  if (referer.startsWith(publicBase)) {
    headers.set('referer', internalBase + referer.slice(publicBase.length));
  } else {
    headers.set('referer', `${internalOrigin}/`);
  }
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
  alignGeoserverSourceHeaders(headers, req, upstreamUrl);

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
    if (
      lower === 'set-cookie' ||
      lower === 'location' ||
      lower === 'ajax-location' ||
      HOP_BY_HOP.has(lower)
    ) {
      return;
    }
    out.append(key, value);
  });
  const location = upstream.headers.get('location');
  if (location) out.set('location', rewriteGeoserverLocation(location, upstreamUrl, req));
  const ajaxLocation = upstream.headers.get('ajax-location');
  if (ajaxLocation) out.set('ajax-location', rewriteGeoserverLocation(ajaxLocation, upstreamUrl, req));

  const contentType = upstream.headers.get('content-type') ?? '';
  const rewriteText = method !== 'HEAD' && shouldRewriteGeoserverBody(contentType);
  const body = method === 'HEAD' ? null : rewriteText
    ? rewriteGeoserverPublicUrls(await upstream.text(), req)
    : upstream.body;
  const res = new Response(body, { status: upstream.status, headers: out });
  const setCookies =
    typeof upstream.headers.getSetCookie === 'function' ? upstream.headers.getSetCookie() : [];
  for (const raw of setCookies) {
    res.headers.append('set-cookie', rewriteGeoserverSetCookie(raw));
  }
  return res;
}
