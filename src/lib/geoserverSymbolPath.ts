/**
 * GeoServer www/symbol 경로.
 * 스타일(SLD/CSS)에는 호스트 없는 `/www/symbol/{folder}/{file}` 만 쓴다.
 * (절대 URL·IP가 들어가면 다른 PC에서 깨짐)
 */

/** 스타일·저장용 GeoServer www 상대 경로 */
export function geoserverWwwSymbolHref(folder: string, fileName: string): string {
  const f = String(folder ?? '').trim();
  const n = String(fileName ?? '').trim();
  return `/www/symbol/${f}/${n}`;
}

/**
 * www/symbol URL.
 * baseUrl 없으면 상대 경로(`/www/symbol/…`).
 * baseUrl 있으면 미리보기용 절대 URL(`{base}/www/symbol/…`).
 */
export function geoserverWwwSymbolUrl(folder: string, fileName: string, baseUrl?: string): string {
  const href = geoserverWwwSymbolHref(folder, fileName);
  const base = String(baseUrl ?? '').trim().replace(/\/$/, '');
  if (base) return `${base}${href}`;
  return href;
}

/** 절대·상대·구 형식·file: → `/www/symbol/{folder}/{file}` */
export function normalizeGeoServerSymbolUrl(url: string, _baseUrl?: string): string {
  const raw = String(url ?? '').trim();
  if (!raw) return raw;

  const rootRel = raw.match(/^\/www\/symbol\/([^/]+)\/([^/?#]+)$/i);
  if (rootRel) return geoserverWwwSymbolHref(rootRel[1], rootRel[2]);

  const dotted = raw.match(/^(?:\.\.\/)+www\/symbol\/([^/]+)\/([^/?#]+)$/i);
  if (dotted) return geoserverWwwSymbolHref(dotted[1], dotted[2]);

  // http(s)://…/geoserver/www/symbol/… · file:/D:/…/www/symbol/… · /www/symbol/…
  const anyWww = raw.match(/[/\\](?:geoserver[/\\])?www[/\\]symbol[/\\]([^/\\]+)[/\\]([^/\\?#]+)$/i);
  if (anyWww) {
    try {
      return geoserverWwwSymbolHref(decodeURIComponent(anyWww[1]), decodeURIComponent(anyWww[2]));
    } catch {
      return geoserverWwwSymbolHref(anyWww[1], anyWww[2]);
    }
  }

  return raw;
}

/**
 * 스타일 CSS/SLD 본문의 심볼 URL을 `/www/symbol/…` 상대 경로로 통일.
 * (IP 절대 URL·file: 로컬경로·`../www/symbol` → 호스트 없는 경로)
 */
export function rewriteGeoServerSymbolUrlsInStyleText(text: string, _baseUrl?: string): string {
  const toMark = (folder: string, file: string) =>
    `mark: url("${geoserverWwwSymbolHref(folder, file)}")`;
  const toHref = (folder: string, file: string) =>
    `xlink:href="${geoserverWwwSymbolHref(folder, file)}"`;

  const pick = (...parts: Array<string | undefined>) => {
    const folder = parts.find((p, i) => i % 2 === 0 && p);
    const file = parts.find((p, i) => i % 2 === 1 && p);
    return folder && file ? { folder, file } : null;
  };

  // http(s) GeoServer · file: 디스크 · ../www · /www
  const symbolRef =
    '(?:https?:\\/\\/[^"\\s]+\\/geoserver\\/www\\/symbol\\/([^/"]+)\\/([^"]+)|file:(?://)?[^"\\s]*?[/\\\\]www[/\\\\]symbol[/\\\\]([^/"\\\\]+)[/\\\\]([^"\\\\]+)|\\.\\.\\/www\\/symbol\\/([^/"]+)\\/([^"]+)|\\/www\\/symbol\\/([^/"]+)\\/([^"]+))';

  let out = text;

  out = out.replace(new RegExp(`mark:\\s*url\\("${symbolRef}"\\)`, 'gi'), (_m, ...g) => {
    const p = pick(g[0], g[1], g[2], g[3], g[4], g[5], g[6], g[7]);
    return p ? toMark(p.folder, p.file) : _m;
  });

  out = out.replace(new RegExp(`xlink:href="${symbolRef}"`, 'gi'), (_m, ...g) => {
    const p = pick(g[0], g[1], g[2], g[3], g[4], g[5], g[6], g[7]);
    return p ? toHref(p.folder, p.file) : _m;
  });

  return out;
}
