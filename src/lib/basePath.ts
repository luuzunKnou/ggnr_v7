/**
 * Next.js `basePath` (next.config `env.BASE_PATH` 와 동일).
 * 없으면 빈 문자열 → `/api`, `/cesiumStatic` 등 기존 루트 경로.
 */
export function getBasePath(): string {
  const raw = (process.env.BASE_PATH ?? '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

/** `/api/...` 처럼 앱 루트 상대 경로에 basePath 접두 */
export function withBasePath(appPath: string): string {
  const base = getBasePath();
  if (!appPath.startsWith('/')) return appPath;
  if (!base) return appPath;
  if (appPath === base || appPath.startsWith(`${base}/`)) return appPath;
  return `${base}${appPath}`;
}
