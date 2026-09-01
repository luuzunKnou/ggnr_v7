/**
 * common.runtime.env `GNMS_URL` → 스킴 포함 base (경로 prefix 유지).
 * 예: `host:3000` → `http://host:3000`
 * 예: `http://dggs.kr/gnms` → `http://dggs.kr/gnms` (경로 유지)
 */

/** common.runtime.env 미설정·빈 값일 때 최후 fallback (`common.runtime.env` 기본과 동일) */
export const DEFAULT_GNMS_URL = 'http://dggs.kr/gnms';

export function normalizeGnmsOrigin(raw: string): string {
  const t = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      const path = u.pathname.replace(/\/+$/, '');
      return path && path !== '/' ? `${u.origin}${path}` : u.origin;
    } catch {
      return t;
    }
  }
  return `http://${t}`;
}

/** GNMS_URL → source/version API base (`…/api/source/version`) */
export function buildGnmsVersionApiBase(gnmsUrl: string): string {
  const base = normalizeGnmsOrigin(gnmsUrl);
  if (!base) return '';
  if (/\/api\/source\/version$/i.test(base)) return base;
  return `${base}/api/source/version`;
}

/** GNMS_URL → source/upload API base (`…/api/source/upload`) — 소스코드 업로드 대상 */
export function buildGnmsUploadApiBase(gnmsUrl: string): string {
  const base = normalizeGnmsOrigin(gnmsUrl);
  if (!base) return '';
  if (/\/api\/source\/upload$/i.test(base)) return base;
  return `${base}/api/source/upload`;
}

/**
 * GNMS source/version API base 기준 URL 조합.
 * base 예: http://dggs.kr/gnms/api/source/version
 */
export function resolveGnmsApiUrl(gnmsBaseUrl: string, maybeRelative: string): string {
  const rel = maybeRelative.trim();
  if (!rel) return gnmsBaseUrl.replace(/\/+$/, '');

  try {
    const abs = new URL(rel);
    if (abs.protocol === 'http:' || abs.protocol === 'https:') return abs.toString();
  } catch {
    /* site-relative */
  }

  const base = gnmsBaseUrl.replace(/\/+$/, '');
  const baseUrl = new URL(`${base}/`);
  const basePath = baseUrl.pathname.replace(/\/+$/, '');
  const path = rel.startsWith('/') ? rel : `/${rel}`;

  if (basePath && (path === basePath || path.startsWith(`${basePath}/`))) {
    return `${baseUrl.origin}${path}`;
  }

  return new URL(rel.replace(/^\//, ''), `${base}/`).toString();
}
