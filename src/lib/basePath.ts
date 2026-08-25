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
      const path = `${input.pathname}${input.search}${input.hash}`;
      if (shouldPrefixAppPath(path)) {
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

function shouldPrefixAppPath(pathOrUrl: string): boolean {
  if (!pathOrUrl.startsWith('/')) return false;
  const base = getBasePath();
  if (base && (pathOrUrl === base || pathOrUrl.startsWith(`${base}/`))) return false;
  // 앱이 서빙하는 루트 절대 경로만 (외부 http는 여기 안 옴)
  return (
    pathOrUrl.startsWith('/api') ||
    pathOrUrl.startsWith('/proxy') ||
    pathOrUrl.startsWith('/symbol') ||
    pathOrUrl.startsWith('/image') ||
    pathOrUrl.startsWith('/font') ||
    pathOrUrl.startsWith('/cesiumStatic') ||
    pathOrUrl.startsWith('/favicon') ||
    pathOrUrl.startsWith('/file.svg') ||
    pathOrUrl.startsWith('/globe.svg') ||
    pathOrUrl.startsWith('/window.svg') ||
    pathOrUrl.startsWith('/ggnr_ai.svg') ||
    pathOrUrl.startsWith('/pdf.worker') ||
    pathOrUrl.startsWith('/vworld')
  );
}
