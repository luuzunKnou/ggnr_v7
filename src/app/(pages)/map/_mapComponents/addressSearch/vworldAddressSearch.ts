/**
 * VWorld 검색 API 2.0 기반 주소/지번 검색 (JSONP 방식)
 * CORS 영향을 받지 않도록 <script> 태그 + callback 파라미터로 호출.
 * @see https://www.vworld.kr/dev/v4dv_search2_s001.do
 */

const VWORLD_SEARCH_BASE = 'https://api.vworld.kr/req/search';
const VWORLD_ADDRESS_BASE = 'https://api.vworld.kr/req/address';

export interface VWorldAddressItem {
  /** VWorld 응답 id (중복 제거용) */
  id?: string;
  /** 표시용 전체 주소 (도로명 또는 지번) */
  address: string;
  /** 도로명 주소 (있을 경우) */
  roadAddress?: string;
  /** 지번 주소 (있을 경우) */
  jibunAddress?: string;
  /** 건물명 (도로명 뒤 괄호 표시용) */
  buildingName?: string;
  /** 제목/장소명 (place 검색 시) */
  title?: string;
  /** 좌표 (EPSG:4326 경도, 위도) */
  point: { x: number; y: number };
}

/** VWorld search API 원본 응답 item 구조 */
interface VWorldSearchItemRaw {
  id?: string;
  title?: string;
  address?: {
    road?: string;
    parcel?: string;
    /** 건물명 (VWorld 응답) */
    bldnm?: string;
    [key: string]: unknown;
  };
  point?: { x?: string; y?: string };
  [key: string]: unknown;
}

interface VWorldSearchResponse {
  response?: {
    status?: string;
    result?: {
      items?: VWorldSearchItemRaw[];
      [key: string]: unknown;
    };
  };
}

/** 역지오코딩(좌표→주소) API 응답 */
export interface GetAddressFromCoordResult {
  /** 지번 주소 */
  jibun?: string;
  /** 도로명 주소 */
  road?: string;
  /** 건물명 */
  buildingName?: string;
}

/** VWorld Address API 역지오코딩 응답 (다양한 형식 지원) */
interface VWorldAddressResponse {
  response?: {
    status?: string;
    result?: unknown;
  };
}

export interface SearchAddressOptions {
  /** VWorld API 키 (미지정 시 VWORLD_API_KEY 사용) */
  apiKey?: string;
  /** 좌표계 (기본 EPSG:4326) */
  crs?: string;
  /** 최대 결과 개수 (기본 5) */
  maxResults?: number;
  /** 주소 타입: place=장소, address=주소 */
  type?: 'place' | 'address';
  /** category: road=도로명, parcel=지번, both=도로명+지번 동시 검색 (type=address일 때 필수) */
  category?: 'road' | 'parcel' | 'both';
}

/**
 * 검색어로 VWorld 주소/장소 검색 후 최대 N건 반환
 */
export async function searchAddress(
  query: string,
  options?: SearchAddressOptions
): Promise<VWorldAddressItem[]> {
  const trimmed = query?.trim();
  if (!trimmed) return [];

  const apiKey = options?.apiKey ?? (typeof process !== 'undefined' ? process.env.VWORLD_API_KEY : undefined);
  if (!apiKey) {
    console.warn('[vworldAddressSearch] VWORLD_API_KEY not set');
    return [];
  }

  const crs = options?.crs ?? 'EPSG:4326';
  const maxResults = options?.maxResults ?? 5;
  const type = options?.type ?? 'address';
  const category = options?.category ?? 'both';

  if (type === 'address' && category === 'both') {
    const perCategory = Math.min(Math.ceil(maxResults / 2), 10);
    const opts: SearchAddressOptions = { ...options, maxResults: perCategory };
    return Promise.all([
      searchAddressOne(trimmed, { ...opts, category: 'road' }, apiKey),
      searchAddressOne(trimmed, { ...opts, category: 'parcel' }, apiKey),
    ]).then(([roadItems, parcelItems]) => {
      const seen = new Set<string>();
      const merged: VWorldAddressItem[] = [];
      for (const item of [...roadItems, ...parcelItems]) {
        const key = item.id ?? `${item.point.x.toFixed(6)},${item.point.y.toFixed(6)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
        if (merged.length >= maxResults) break;
      }
      return merged;
    });
  }

  const singleCategory = category === 'both' ? 'road' : category;
  return searchAddressOne(trimmed, { ...options, category: singleCategory }, apiKey);
}

function searchAddressOne(
  trimmed: string,
  options: SearchAddressOptions & { category: 'road' | 'parcel' },
  apiKey: string
): Promise<VWorldAddressItem[]> {
  const { crs = 'EPSG:4326', maxResults = 5, type = 'address', category } = options;

  const params = new URLSearchParams({
    service: 'search',
    request: 'search',
    version: '2.0',
    crs,
    size: String(Math.min(maxResults, 20)),
    page: '1',
    query: trimmed,
    type,
    category,
    format: 'json',
    errorformat: 'json',
    key: apiKey,
  });

  return new Promise<VWorldAddressItem[]>((resolve) => {
    const callbackName = `__vworldSearch_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const script = document.createElement('script');

    const cleanup = () => {
      delete (window as unknown as Record<string, unknown>)[callbackName];
      if (script.parentNode) script.remove();
    };

    (window as unknown as Record<string, (data: VWorldSearchResponse) => void>)[callbackName] = (data: VWorldSearchResponse) => {
      cleanup();
      try {
        const status = data?.response?.status;
        if (status !== 'OK') {
          resolve([]);
          return;
        }
        const items = data?.response?.result?.items ?? [];
        const result: VWorldAddressItem[] = [];
        const seen = new Set<string>();
        for (const item of items) {
          const point = item?.point;
          const x = point?.x != null ? Number(point.x) : NaN;
          const y = point?.y != null ? Number(point.y) : NaN;
          if (Number.isNaN(x) || Number.isNaN(y)) continue;
          const id = item?.id != null ? String(item.id) : undefined;
          const key = id ?? `${x.toFixed(6)},${y.toFixed(6)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const road = item?.address?.road ?? '';
          const parcel = item?.address?.parcel ?? '';
          const bldnm = item?.address?.bldnm ?? '';
          const title = item?.title ?? '';
          const address = road || parcel || title || `${x}, ${y}`;
          result.push({
            id,
            address,
            roadAddress: road || undefined,
            jibunAddress: parcel || undefined,
            buildingName: bldnm || undefined,
            title: title || undefined,
            point: { x, y },
          });
        }
        resolve(result.slice(0, maxResults));
      } catch {
        resolve([]);
      }
    };

    script.src = `${VWORLD_SEARCH_BASE}?${params.toString()}&callback=${encodeURIComponent(callbackName)}`;
    script.async = true;
    script.onerror = () => {
      cleanup();
      console.error('[vworldAddressSearch] JSONP script load failed');
      resolve([]);
    };
    document.head.appendChild(script);
  });
}

/**
 * result 객체에서 지번/도로명 추출 (다양한 VWorld 응답 형식 대응)
 */
function parseAddressResult(result: unknown): GetAddressFromCoordResult | null {
  if (!result || typeof result !== 'object') return null;

  const obj = result as Record<string, unknown>;

  // 1) 배열 형식: [{ type: 'parcel'|'road', text: '...' }, ...]
  if (Array.isArray(result)) {
    const parcelItem = result.find((r: { type?: string }) => r?.type === 'parcel');
    const roadItem = result.find((r: { type?: string }) => r?.type === 'road');
    const jibun = (parcelItem as { text?: string })?.text;
    const road = (roadItem as { text?: string })?.text;
    if (jibun || road) return { jibun, road };
    return null;
  }

  // 2) 단일 주소 필드 (문서상 result.ADDR 또는 result.addr)
  const singleAddr = (obj.ADDR as string) ?? (obj.addr as string);
  if (typeof singleAddr === 'string' && singleAddr.trim()) {
    return { jibun: singleAddr.trim() };
  }

  // 3) result.parcel / result.road 문자열 (일부 버전)
  const parcelStr = obj.parcel as string | undefined;
  const roadStr = obj.road as string | undefined;
  if (typeof parcelStr === 'string' || typeof roadStr === 'string') {
    return {
      jibun: typeof parcelStr === 'string' ? parcelStr.trim() || undefined : undefined,
      road: typeof roadStr === 'string' ? roadStr.trim() || undefined : undefined,
    };
  }

  // 4) land / road / structure 하위 객체
  const land = obj.land as Record<string, unknown> | undefined;
  const road = obj.road as Record<string, unknown> | undefined;
  const structure = obj.structure as Record<string, unknown> | undefined;

  let jibun: string | undefined;
  if (land?.parcel && typeof land.parcel === 'string') {
    jibun = land.parcel;
  } else if (land?.addr && typeof land.addr === 'string') {
    jibun = land.addr;
  } else if (structure?.addr && typeof structure.addr === 'string') {
    jibun = structure.addr;
  } else if (structure?.level2 || structure?.level4) {
    const parts = [structure?.level2, structure?.level4, structure?.level5].filter(Boolean) as string[];
    if (parts.length) jibun = parts.join(' ');
  }

  let roadAddr: string | undefined;
  if (road?.addr && typeof road.addr === 'string') {
    roadAddr = road.addr;
  } else if (road?.name && typeof road.name === 'string') {
    const num1 = road.number1 != null ? String(road.number1) : '';
    const num2 = road.number2 != null ? String(road.number2) : '';
    roadAddr = [road.name, num1, num2].filter(Boolean).join(' ');
  }

  const buildingName =
    (road?.bldnm as string) ?? (land?.bldnm as string) ?? (obj.bldnm as string);
  const hasBuilding = typeof buildingName === 'string' && buildingName.trim();

  if (jibun || roadAddr || hasBuilding)
    return {
      jibun,
      road: roadAddr,
      buildingName: hasBuilding ? buildingName.trim() : undefined,
    };
  return null;
}

/**
 * 좌표(WGS84 경도·위도)로 주소 조회 (역지오코딩)
 * VWorld Address API 2.0 getAddress 사용. CORS 회피를 위해 JSONP로 호출.
 */
export function getAddressFromCoord(
  lon: number,
  lat: number,
  options?: { apiKey?: string }
): Promise<GetAddressFromCoordResult | null> {
  const apiKey =
    options?.apiKey ??
    (typeof process !== 'undefined' ? process.env.VWORLD_API_KEY : undefined);
  if (!apiKey) {
    console.warn('[vworldAddressSearch] VWORLD_API_KEY not set');
    return Promise.resolve(null);
  }

  const point = `${lon},${lat}`;
  const params = new URLSearchParams({
    service: 'address',
    version: '2.0',
    request: 'getAddress',
    point,
    crs: 'epsg:4326',
    type: 'BOTH',
    format: 'json',
    simple: 'false',
    key: apiKey,
  });

  return new Promise<GetAddressFromCoordResult | null>((resolve) => {
    if (typeof document === 'undefined' || !document.head) {
      resolve(null);
      return;
    }
    const callbackName = `__vworldAddress_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');

    const cleanup = () => {
      delete (window as unknown as Record<string, unknown>)[callbackName];
      if (script.parentNode) script.remove();
    };

    (window as unknown as Record<string, (data: VWorldAddressResponse) => void>)[callbackName] = (data: VWorldAddressResponse) => {
      cleanup();
      try {
        const status = data?.response?.status;
        if (status !== 'OK') {
          resolve(null);
          return;
        }
        const parsed = parseAddressResult(data?.response?.result);
        resolve(parsed ?? null);
      } catch (err) {
        console.warn('[vworldAddressSearch] getAddressFromCoord parse error', err);
        resolve(null);
      }
    };

    script.src = `${VWORLD_ADDRESS_BASE}?${params.toString()}&callback=${encodeURIComponent(callbackName)}`;
    script.async = true;
    script.onerror = () => {
      cleanup();
      console.warn('[vworldAddressSearch] getAddressFromCoord JSONP failed');
      resolve(null);
    };
    document.head.appendChild(script);
  });
}
