/**
 * VWorld Address API — 서버 역지오코딩 (필지 jibun) · 주소→좌표
 */
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';
import { getMapConfig } from '@/service/configService';

type AddressApiResponse = {
  response?: {
    status?: string;
    result?: unknown;
  };
};

type GetCoordApiResponse = {
  response?: {
    status?: string;
    result?: { point?: { x?: string | number; y?: string | number } };
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

function pickRoadFromResult(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const obj = result as Record<string, unknown>;

  if (Array.isArray(result)) {
    const roadItem = result.find((r) => {
      const t = String((r as { type?: string })?.type ?? '').toLowerCase();
      return t === 'road' || t === 'roads';
    }) as { text?: string } | undefined;
    const text = roadItem?.text;
    if (typeof text === 'string' && text.trim()) return text.trim();
    return null;
  }

  const roadStr = obj.road;
  if (typeof roadStr === 'string' && roadStr.trim()) return roadStr.trim();

  const road = obj.road as Record<string, unknown> | undefined;
  if (road?.addr && typeof road.addr === 'string' && road.addr.trim()) return road.addr.trim();
  if (road?.name && typeof road.name === 'string') {
    const num1 = road.number1 != null ? String(road.number1) : '';
    const num2 = road.number2 != null ? String(road.number2) : '';
    const joined = [road.name, num1, num2].filter(Boolean).join(' ');
    if (joined.trim()) return joined.trim();
  }

  return null;
}

async function fetchAddressPartsFromCoord(
  lon: number,
  lat: number,
  type: 'BOTH' | 'PARCEL' | 'ROAD'
): Promise<{ jibun: string | null; road: string | null }> {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return { jibun: null, road: null };
  }

  const { VWORLD_API_KEY } = getMapConfig();
  if (!VWORLD_API_KEY) return { jibun: null, road: null };

  const params = new URLSearchParams({
    service: 'address',
    version: '2.0',
    request: 'getAddress',
    point: `${lon},${lat}`,
    crs: 'epsg:4326',
    type,
    format: 'json',
    simple: 'false',
    key: VWORLD_API_KEY,
  });

  try {
    const res = await fetch(`https://api.vworld.kr/req/address?${params.toString()}`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) return { jibun: null, road: null };
    const data = (await res.json()) as AddressApiResponse;
    if (data?.response?.status !== 'OK') return { jibun: null, road: null };
    const result = data.response.result;
    return {
      jibun: pickParcelJibunFromResult(result),
      road: pickRoadFromResult(result),
    };
  } catch {
    return { jibun: null, road: null };
  }
}

/** WGS84 좌표 → VWorld 지번 주소 (실패 시 null) */
export async function fetchParcelJibunFromCoord(lon: number, lat: number): Promise<string | null> {
  const parts = await fetchAddressPartsFromCoord(lon, lat, 'PARCEL');
  return parts.jibun;
}

/** WGS84 좌표 → 정규화 주소(시·군·구 제거, 도로명 우선·없으면 지번) */
export async function fetchNormalizedAddressFromCoord(
  lon: number,
  lat: number
): Promise<string | null> {
  let parts = await fetchAddressPartsFromCoord(lon, lat, 'BOTH');
  if (!parts.road && !parts.jibun) {
    parts = await fetchAddressPartsFromCoord(lon, lat, 'PARCEL');
  }
  if (!parts.road && !parts.jibun) {
    parts = await fetchAddressPartsFromCoord(lon, lat, 'ROAD');
  }
  const raw = (parts.road || parts.jibun || '').trim();
  if (!raw) return null;
  const normalized = formatAddressStripSidoSigungu(raw);
  return normalized || raw;
}

/** 주소 문자열 → WGS84 좌표 (도로명 우선, 실패 시 지번) */
export async function fetchCoordFromAddress(
  address: string
): Promise<{ lon: number; lat: number } | null> {
  const trimmed = String(address ?? '').trim();
  if (!trimmed) return null;

  const { VWORLD_API_KEY } = getMapConfig();
  if (!VWORLD_API_KEY) return null;

  const tryType = async (type: 'ROAD' | 'PARCEL') => {
    const params = new URLSearchParams({
      service: 'address',
      version: '2.0',
      request: 'getCoord',
      crs: 'epsg:4326',
      type,
      address: trimmed,
      format: 'json',
      key: VWORLD_API_KEY,
    });
    const res = await fetch(`https://api.vworld.kr/req/address?${params.toString()}`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GetCoordApiResponse;
    if (String(data?.response?.status ?? '').toUpperCase() !== 'OK') return null;
    const lon = Number(data?.response?.result?.point?.x);
    const lat = Number(data?.response?.result?.point?.y);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return { lon, lat };
  };

  try {
    return (await tryType('ROAD')) ?? (await tryType('PARCEL'));
  } catch {
    return null;
  }
}

type VWorldSearchItemRaw = {
  address?: { parcel?: string; road?: string };
  point?: { x?: string | number; y?: string | number };
};

async function fetchVWorldSearchItems(
  query: string,
  category: 'road' | 'parcel',
  apiKey: string
): Promise<VWorldSearchItemRaw[]> {
  const params = new URLSearchParams({
    service: 'search',
    request: 'search',
    version: '2.0',
    crs: 'EPSG:4326',
    size: '5',
    page: '1',
    query,
    type: 'address',
    category,
    format: 'json',
    errorformat: 'json',
    key: apiKey,
  });

  const res = await fetch(`https://api.vworld.kr/req/search?${params.toString()}`, {
    method: 'GET',
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    response?: { status?: string; result?: { items?: VWorldSearchItemRaw[] } };
  };
  if (data?.response?.status !== 'OK') return [];
  return data?.response?.result?.items ?? [];
}

function pickParcelFromSearchItems(items: VWorldSearchItemRaw[]): string | null {
  for (const item of items) {
    const parcel = typeof item?.address?.parcel === 'string' ? item.address.parcel.trim() : '';
    if (parcel) return parcel;
  }
  return null;
}

function pickFirstSearchPoint(items: VWorldSearchItemRaw[]): { lon: number; lat: number } | null {
  for (const item of items) {
    const lon = Number(item?.point?.x);
    const lat = Number(item?.point?.y);
    if (Number.isFinite(lon) && Number.isFinite(lat)) return { lon, lat };
  }
  return null;
}

function normalizeSearchJibun(raw: string): string {
  const normalized = formatAddressStripSidoSigungu(raw);
  return normalized || raw;
}

/**
 * addr → VWorld searchAddress와 동일하게 parcel·road 검색 후 지번 주소 반환.
 * 도로명 addr는 parcel 검색만으로는 매칭되지 않을 수 있어 road 결과의 parcel 또는 좌표 역지오코딩을 사용한다.
 */
export async function fetchNormalizedJibunFromAddressSearch(address: string): Promise<string | null> {
  const trimmed = String(address ?? '').trim();
  if (!trimmed) return null;

  const { VWORLD_API_KEY } = getMapConfig();
  if (!VWORLD_API_KEY) return null;

  try {
    const parcelItems = await fetchVWorldSearchItems(trimmed, 'parcel', VWORLD_API_KEY);
    const fromParcel = pickParcelFromSearchItems(parcelItems);
    if (fromParcel) return normalizeSearchJibun(fromParcel);

    const roadItems = await fetchVWorldSearchItems(trimmed, 'road', VWORLD_API_KEY);
    const fromRoad = pickParcelFromSearchItems(roadItems);
    if (fromRoad) return normalizeSearchJibun(fromRoad);

    const pt = pickFirstSearchPoint(roadItems);
    if (pt) {
      const jibun = await fetchParcelJibunFromCoord(pt.lon, pt.lat);
      if (jibun) return normalizeSearchJibun(jibun);
    }

    return null;
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
