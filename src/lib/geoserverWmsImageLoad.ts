import type ImageWrapper from 'ol/Image';

/** fetch 실패 시 empty src 대신 — OL decode EncodingError 방지 */
const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** 이 길이 초과 시 POST (읍면동 INTERSECTS WKT 등 414 방지) */
const WMS_GET_URL_MAX_LEN = 1800;

function isRasterImageBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  if (bytes[i] === 0x3c) return false;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return true;
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return true;
  return false;
}

async function readWmsImageBytes(res: Response): Promise<{ buffer: ArrayBuffer; mime: string }> {
  const ct = (res.headers.get('content-type') ?? '').toLowerCase();
  if (!res.ok || ct.includes('xml') || ct.includes('text/')) {
    throw new Error(res.statusText || `HTTP ${res.status}`);
  }
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (!isRasterImageBytes(bytes)) {
    throw new Error('WMS response is not a decodable image');
  }
  const mime = ct.startsWith('image/') ? ct.split(';')[0]!.trim() : 'image/png';
  return { buffer, mime };
}

/**
 * GeoServer ImageWMS 로드 — 짧은 URL은 GET, CQL 등으로 길면 POST.
 * 안전데이터(방사선 대피소·물놀이 표지판 등) 경계 INTERSECTS용.
 */
export function geoserverWmsImageLoadFunction(image: ImageWrapper, src: string): void {
  const img = image.getImage() as HTMLImageElement;
  const fail = () => {
    img.src = TRANSPARENT_PIXEL;
  };

  if (!src) {
    fail();
    return;
  }

  try {
    let request: Promise<Response>;

    if (src.length <= WMS_GET_URL_MAX_LEN) {
      request = fetch(src, { method: 'GET' });
    } else {
      const url = new URL(src);
      const body = url.search.startsWith('?') ? url.search.slice(1) : url.search;
      if (!body) {
        request = fetch(src, { method: 'GET' });
      } else {
        const params = new URLSearchParams(body);
        const service = params.get('SERVICE') ?? params.get('service') ?? 'WMS';
        const requestName = params.get('REQUEST') ?? params.get('request') ?? 'GetMap';
        const baseUrl =
          `${url.origin}${url.pathname}` +
          `?SERVICE=${encodeURIComponent(service)}&REQUEST=${encodeURIComponent(requestName)}`;
        request = fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
      }
    }

    request
      .then(readWmsImageBytes)
      .then(({ buffer, mime }) => {
        const blobUrl = URL.createObjectURL(new Blob([buffer], { type: mime }));
        img.onload = () => URL.revokeObjectURL(blobUrl);
        img.onerror = () => {
          URL.revokeObjectURL(blobUrl);
          fail();
        };
        img.src = blobUrl;
      })
      .catch(() => fail());
  } catch {
    fail();
  }
}
