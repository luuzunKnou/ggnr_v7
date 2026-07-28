/**
 * VWorld Address API — 서버 역지오코딩 (필지 jibun)
 * 도형 그리기 필지목록 주소를 주소검색(VWorld)과 동일 형식으로 보강할 때 사용.
 */
import { getMapConfig } from '@/service/configService';

type AddressApiResponse = {
  response?: {
    status?: string;
    result?: unknown;
  };
};

function pickParcelJibunFromResult(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const obj = result as Record<string, unknown>;

  if (Array.isArray(result)) {
    const parcelItem = result.find((r) => {
      const t = String((r as { type?: string })?.type ?? '').toLowerCase();
      return t === 'parcel' || t === 'parcels';
    }) as { text?: string } | undefined;
    const text = parcelItem?.text;
    if (typeof text === 'string' && text.trim()) return text.trim();
    return null;
  }

  const parcelStr = obj.parcel;
  if (typeof parcelStr === 'string' && parcelStr.trim()) return parcelStr.trim();

  const land = obj.land as Record<string, unknown> | undefined;
  if (typeof land?.parcel === 'string' && land.parcel.trim()) return land.parcel.trim();
  if (typeof land?.addr === 'string' && land.addr.trim()) return land.addr.trim();

  const structure = obj.structure as Record<string, unknown> | undefined;
  if (structure?.level2 || structure?.level4) {
    const parts = [structure.level2, structure.level4, structure.level5].filter(Boolean) as string[];
    if (parts.length) return parts.join(' ');
  }

  const text = obj.text ?? obj.TEXT ?? obj.addr ?? obj.ADDR;
  if (typeof text === 'string' && text.trim()) return text.trim();

  return null;
}

/** WGS84 좌표 → VWorld 지번 주소 (실패 시 null) */
export async function fetchParcelJibunFromCoord(lon: number, lat: number): Promise<string | null> {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const { VWORLD_API_KEY } = getMapConfig();
  if (!VWORLD_API_KEY) return null;

  const params = new URLSearchParams({
    service: 'address',
    version: '2.0',
    request: 'getAddress',
    point: `${lon},${lat}`,
    crs: 'epsg:4326',
    type: 'PARCEL',
    format: 'json',
    simple: 'false',
    key: VWORLD_API_KEY,
  });

  try {
    const res = await fetch(`https://api.vworld.kr/req/address?${params.toString()}`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as AddressApiResponse;
    if (data?.response?.status !== 'OK') return null;
    return pickParcelJibunFromResult(data.response.result);
  } catch {
    return null;
  }
}

/** EPSG:3857 extent 중심 → WGS84 */
export function extent3857CenterTo4326(
  ext: [number, number, number, number] | null | undefined
): { lon: number; lat: number } | null {
  if (!ext || ext.length !== 4 || !ext.every((v) => Number.isFinite(v))) return null;
  const [xmin, ymin, xmax, ymax] = ext;
  const x = (xmin + xmax) / 2;
  const y = (ymin + ymax) / 2;
  const lon = (x / 20037508.34) * 180;
  const lat = (Math.atan(Math.sinh((Math.PI * y) / 20037508.34)) * 180) / Math.PI;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat };
}
