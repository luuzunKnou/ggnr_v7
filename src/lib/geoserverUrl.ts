import { getBasePath } from '@/lib/basePath';

/** Next 프로세스 → 로컬 GeoServer (헬스·REST·프록시 destination) */
export const GEOSERVER_INTERNAL_DEFAULT = 'http://127.0.0.1:8080/geoserver';

/** run.ts·next.config 가 start.ini 포트를 GEOSERVER_URL 로 주입. 클라이언트 번들에서는 env만 사용 */
export function getGeoServerInternalBase(): string {
  return (process.env.GEOSERVER_URL?.trim() || GEOSERVER_INTERNAL_DEFAULT).replace(/\/$/, '');
}
/**
 * 브라우저 HTML(img src 등)용 동일출처 경로.
 * rewrite: `{basePath}/geoserver` → start.ini·GEOSERVER_URL
 * 서버에서 내부 포트(127.0.0.1:8080)를 붙이지 않는다.
 */
export function getGeoServerPublicBase(): string {
  return `${getBasePath()}/geoserver`;
}

/**
 * 브라우저·동일 출처 WMS/WFS 베이스.
 * `next.config` rewrite: `/geoserver` → start.ini·GEOSERVER_URL
 * BASE_PATH·게이트(dggskorea/build_yy)에서도 hostname 직접 포트를 쓰지 않음.
 * 범례 이미지(SSR HTML)는 getGeoServerPublicBase 를 쓴다.
 */
export function getGeoServerBase(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${getBasePath()}/geoserver`;
  }
  return getGeoServerInternalBase();
}

/**
 * 서버에서 클라이언트/UI가 넘긴 GeoServer URL을 실제 fetch 대상으로 정규화.
 * 게이트 공개 URL·`:8080/geoserver` 는 설치 서버의 로컬 GeoServer로 돌린다.
 */
export function resolveGeoServerFetchBase(url?: string | null): string {
  const internal = getGeoServerInternalBase();
  const raw = (url ?? '').trim().replace(/\/$/, '');
  if (!raw) return internal;
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\/+$/, '') || '';
    const isGeoserverPath = path === '/geoserver' || path.endsWith('/geoserver');
    const isLocalHost =
      u.hostname === '127.0.0.1' ||
      u.hostname === 'localhost' ||
      u.hostname === '::1';
    if (isGeoserverPath && !isLocalHost) return internal;
    // localhost:{Next}/…/geoserver → 내부 start.ini 포트(8090 등)로 직접 조회
    if (isGeoserverPath && isLocalHost) return internal;
  } catch {
    if (/geoserver$/i.test(raw) && !/localhost|127\.0\.0\.1/i.test(raw)) return internal;
  }
  return raw;
}
