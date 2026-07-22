/**
 * GNMS source/version API base 기준 URL 조합.
 * base 예: http://192.168.126.1:3000/api/source/version
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
