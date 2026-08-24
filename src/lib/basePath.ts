/**
 * Next.js `basePath` (next.config `env.BASE_PATH` 와 동일).
 * 게이트: dggskorea/[프로젝트명] → `/[프로젝트명]`.
 * 없으면 빈 문자열 → `/api`, `/cesiumStatic` 등 기존 루트 경로.
 */
export function getBasePath(): string {
  let raw = (process.env.BASE_PATH ?? '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) {
    try {
      raw = new URL(raw).pathname;
    } catch {
      /* keep */
    }
  }
  raw = raw.replace(/\/+$/, '');
  if (!raw || raw === '/') return '';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

/** `/api/...` · `/symbol/...` 처럼 앱 루트 상대 경로에 basePath 접두 */
export function withBasePath(appPath: string): string {
  const base = getBasePath();
  if (!appPath.startsWith('/')) return appPath;
  if (!base) return appPath;
  if (appPath === base || appPath.startsWith(`${base}/`)) return appPath;
  return `${base}${appPath}`;
}

/**
 * public·API 등 `/` 절대경로 fetch 에 basePath 적용.
 * (call() 외 raw fetch('/api/...') 누락 방지)
 */
export function appFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(resolveFetchInput(input), init);
}

export function resolveFetchInput(input: RequestInfo | URL): RequestInfo | URL {
  const base = getBasePath();
  if (!base) return input;

  if (typeof input === 'string') {
    return shouldPrefixAppPath(input) ? withBasePath(input) : input;
  }
  if (input instanceof URL) {
    if (typeof window !== 'undefined' && input.origin === window.location.origin) {
      if (shouldPrefixAppPath(input.pathname)) {
        return new URL(withBasePath(input.pathname) + input.search + input.hash, input.origin);
      }
    }
    return input;
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try {
      const u = new URL(input.url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
      if (typeof window !== 'undefined' && u.origin === window.location.origin && shouldPrefixAppPath(u.pathname)) {
        const nextUrl = withBasePath(u.pathname) + u.search + u.hash;
        return new Request(nextUrl, input);
      }
    } catch {
      /* keep */
    }
  }
  return input;
}

/**
 * fetch·img·video·EventSource 등 앱이 서빙하는 루트 절대 경로인지.
 * (이미 basePath가 있으면 false)
 */
export function shouldPrefixAppPath(pathOrUrl: string): boolean {
  const pathname = pathOnly(pathOrUrl);
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return false;
  const base = getBasePath();
  if (base && (pathname === base || pathname.startsWith(`${base}/`))) return false;
  return (
    pathname.startsWith('/api') ||
    pathname.startsWith('/proxy') ||
    pathname.startsWith('/symbol') ||
    pathname.startsWith('/image') ||
    pathname.startsWith('/font') ||
    pathname.startsWith('/cesiumStatic') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/file.svg') ||
    pathname.startsWith('/globe.svg') ||
    pathname.startsWith('/window.svg') ||
    pathname.startsWith('/ggnr_ai.svg') ||
    pathname.startsWith('/pdf.worker') ||
    pathname.startsWith('/vworld')
  );
}

/**
 * location.assign / window.open 용 — `_next` 제외한 앱 절대경로 전반.
 */
export function shouldPrefixNavPath(pathOrUrl: string): boolean {
  const pathname = pathOnly(pathOrUrl);
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return false;
  if (pathname.startsWith('/_next')) return false;
  const base = getBasePath();
  if (base && (pathname === base || pathname.startsWith(`${base}/`))) return false;
  return true;
}

/** pathname(+query 가능)에 basePath 접두. 네비게이션·open 공용 */
export function withBasePathNav(pathOrUrl: string): string {
  if (!shouldPrefixNavPath(pathOrUrl)) return pathOrUrl;
  const q = pathOrUrl.search(/[?#]/);
  if (q < 0) return withBasePath(pathOrUrl);
  return withBasePath(pathOrUrl.slice(0, q)) + pathOrUrl.slice(q);
}

function pathOnly(pathOrUrl: string): string {
  if (!pathOrUrl.startsWith('/')) return pathOrUrl;
  const q = pathOrUrl.search(/[?#]/);
  return q < 0 ? pathOrUrl : pathOrUrl.slice(0, q);
}
