import { getGeoServerInternalBase } from '@/lib/geoserverUrl';

/** GeoServer www/symbol 절대 URL (start.ini·GEOSERVER_URL 포트 반영) */
export function geoserverWwwSymbolUrl(folder: string, fileName: string, baseUrl?: string): string {
  const base = (baseUrl ?? getGeoServerInternalBase()).replace(/\/$/, '');
  const f = String(folder ?? '').trim();
  const n = String(fileName ?? '').trim();
  return `${base}/www/symbol/${f}/${n}`;
}

/** 상대·구 포트 절대 URL → 현재 GeoServer 베이스의 www/symbol 절대 URL */
export function normalizeGeoServerSymbolUrl(url: string, baseUrl?: string): string {
  const raw = String(url ?? '').trim();
  if (!raw) return raw;

  const rel = raw.match(/^\.\.\/www\/symbol\/([^/]+)\/([^/?#]+)$/i);
  if (rel) return geoserverWwwSymbolUrl(rel[1], rel[2], baseUrl);

  const abs = raw.match(/\/geoserver\/www\/symbol\/([^/]+)\/([^/?#]+)$/i);
  if (abs) {
    try {
      return geoserverWwwSymbolUrl(decodeURIComponent(abs[1]), decodeURIComponent(abs[2]), baseUrl);
    } catch {
      return geoserverWwwSymbolUrl(abs[1], abs[2], baseUrl);
    }
  }

  return raw;
}

/** 스타일 CSS/SLD 본문의 심볼 URL을 현재 GeoServer 베이스로 통일 */
export function rewriteGeoServerSymbolUrlsInStyleText(text: string, baseUrl?: string): string {
  const toMark = (folder: string, file: string) =>
    `mark: url("${geoserverWwwSymbolUrl(folder, file, baseUrl)}")`;
  const toHref = (folder: string, file: string) =>
    `xlink:href="${geoserverWwwSymbolUrl(folder, file, baseUrl)}"`;

  const symbolRef =
    '(?:https?:\\/\\/[^"\\s]+\\/geoserver\\/www\\/symbol\\/([^/"]+)\\/([^"]+)|\\.\\.\\/www\\/symbol\\/([^/"]+)\\/([^"]+))';

  let out = text;

  out = out.replace(new RegExp(`mark:\\s*url\\("${symbolRef}"\\)`, 'gi'), (_m, af, afile, rf, rfile) =>
    toMark(af || rf, afile || rfile)
  );

  out = out.replace(new RegExp(`xlink:href="${symbolRef}"`, 'gi'), (_m, af, afile, rf, rfile) =>
    toHref(af || rf, afile || rfile)
  );

  return out;
}
