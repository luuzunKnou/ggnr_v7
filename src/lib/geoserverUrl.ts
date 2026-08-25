import { getBasePath } from '@/lib/basePath';

/** Next 프로세스 → 로컬 GeoServer (헬스·REST·프록시 destination) */
export const GEOSERVER_INTERNAL_DEFAULT = 'http://127.0.0.1:8080/geoserver';

export function getGeoServerInternalBase(): string {
  return (process.env.GEOSERVER_URL?.trim() || GEOSERVER_INTERNAL_DEFAULT).replace(/\/$/, '');
}

/**
 * 브라우저·동일 출처 WMS/WFS 베이스.
 * `next.config` rewrite: `/geoserver` → 127.0.0.1:8080/geoserver
 * BASE_PATH·게이트(dggskorea/build_yy)에서도 hostname:8080 을 쓰지 않음.
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
    if (isGeoserverPath && u.port === '8080') return internal;
  } catch {
    if (/geoserver$/i.test(raw) && !/localhost|127\.0\.0\.1/i.test(raw)) return internal;
  }
  return raw;
}
