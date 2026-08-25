/**
 * VWorld 검색 API 2.0 — 우선 `/api/vworld/search` 서버 프록시, 실패 시 JSONP 폴백
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
  /** 장소(PLACE) 검색에서 온 항목 */
  kind?: 'place';
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
  /** 필지고유번호(PNU) */
  pnu?: string;
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

function buildPnuFromLevel4Lc(baseCode: unknown, parcelText: unknown): string | undefined {
  const lc = typeof baseCode === 'string' ? baseCode.trim() : '';
  if (!/^\d{10}$/.test(lc)) return undefined;
  const raw = typeof parcelText === 'string' ? parcelText.trim() : '';
  if (!raw) return undefined;
  const isMountain = /(^|\s)산\s*\d|산\d/.test(raw);
  const nums = raw.match(/\d+/g) ?? [];
  if (nums.length === 0) return undefined;
  const bonbun = nums[0]?.padStart(4, '0').slice(-4) ?? '0000';
  const bubun = (nums[1] ?? '0').padStart(4, '0').slice(-4);
  // PNU 11번째 자리: 1=대지, 2=산
  const landType = isMountain ? '2' : '1';
  return `${lc}${landType}${bonbun}${bubun}`;
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

export interface SearchPlaceOptions {
  /** VWorld API 키 (미지정 시 VWORLD_API_KEY 사용) */
  apiKey?: string;
  /** 좌표계 (기본 EPSG:4326) */
  crs?: string;
  /** 최대 결과 개수 (기본 5) */
  maxResults?: number;
}

/**
 * 검색어로 VWorld 주소 검색 후 최대 N건 반환 (type=address)
 */
export async function searchAddress(
  query: string,
  options?: SearchAddressOptions
): Promise<VWorldAddressItem[]> {
  const trimmed = query?.trim();
  if (!trimmed) return [];

  const apiKey =
    options?.apiKey ??
    (typeof process !== 'undefined' ? process.env.VWORLD_API_KEY : undefined) ??
    '';

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

/**
 * 검색어로 VWorld 장소(PLACE) 검색 후 최대 N건 반환 (type=place, category 없음)
 */
export async function searchPlace(
  query: string,
  options?: SearchPlaceOptions
): Promise<VWorldAddressItem[]> {
  const trimmed = query?.trim();
  if (!trimmed) return [];

  const apiKey =
    options?.apiKey ??
    (typeof process !== 'undefined' ? process.env.VWORLD_API_KEY : undefined) ??
    '';

  return searchPlaceOne(trimmed, options ?? {}, apiKey);
}

function coordKey(item: VWorldAddressItem): string {
  return `${item.point.x.toFixed(6)},${item.point.y.toFixed(6)}`;
}

/**
 * 주소(도로명·지번)와 장소(POI)를 함께 검색한 뒤 좌표 기준으로 합친다.
 * 같은 좌표면 주소 항목을 남기고, 장소 제목만 보강한다.
 */
export async function searchAddressAndPlace(
  query: string,
  options?: SearchAddressOptions
): Promise<VWorldAddressItem[]> {
  const trimmed = query?.trim();
  if (!trimmed) return [];

  const maxResults = options?.maxResults ?? 5;
  const [addressItems, placeItems] = await Promise.all([
    searchAddress(trimmed, { ...options, type: 'address' }),
    searchPlace(trimmed, {
      apiKey: options?.apiKey,
      crs: options?.crs,
      maxResults,
    }),
  ]);

  const byCoord = new Map<string, VWorldAddressItem>();
  const merged: VWorldAddressItem[] = [];
  for (const item of addressItems) {
    byCoord.set(coordKey(item), item);
    merged.push(item);
  }
  for (const item of placeItems) {
    const key = coordKey(item);
    const existing = byCoord.get(key);
    if (existing) {
      if (!existing.title && item.title) existing.title = item.title;
      continue;
    }
    byCoord.set(key, item);
    merged.push(item);
  }
  return merged;
}

function parseSearchResponse(data: VWorldSearchResponse, maxResults: number): VWorldAddressItem[] {
  const status = data?.response?.status;
  if (status !== 'OK') return [];
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
  return result.slice(0, maxResults);
}

function buildSearchParams(
  trimmed: string,
  options: SearchAddressOptions,
  apiKey?: string
): URLSearchParams {
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
    format: 'json',
    errorformat: 'json',
  });
  if (type === 'address' && (category === 'road' || category === 'parcel')) {
    params.set('category', category);
  }
  if (apiKey) params.set('key', apiKey);
  return params;
}

async function searchAddressViaProxy(
  params: URLSearchParams,
  maxResults: number
): Promise<VWorldAddressItem[] | 'upstream_failed' | null> {
  if (typeof window === 'undefined') return null;
  try {
    const res = await fetch(`/api/vworld/search?${params.toString()}`, { cache: 'no-store' });
    if (!res.ok) return 'upstream_failed';
    const data = (await res.json()) as VWorldSearchResponse;
    return parseSearchResponse(data, maxResults);
  } catch {
    return null;
  }
}

function searchAddressOne(
  trimmed: string,
  options: SearchAddressOptions & { category: 'road' | 'parcel' },
  apiKey: string
): Promise<VWorldAddressItem[]> {
  const maxResults = options.maxResults ?? 5;
  const proxyParams = buildSearchParams(trimmed, { ...options, type: 'address' });
  return searchAddressViaProxy(proxyParams, maxResults).then((viaProxy) => {
    if (Array.isArray(viaProxy)) return viaProxy;
    if (viaProxy === 'upstream_failed') return [];
    if (!apiKey) {
      console.warn('[vworldAddressSearch] VWORLD_API_KEY not set');
      return [];
    }
    return searchOneJsonp(trimmed, { ...options, type: 'address' }, apiKey);
  });
}

/** type=place — category 없음 */
function searchPlaceOne(
  trimmed: string,
  options: SearchPlaceOptions,
  apiKey: string
): Promise<VWorldAddressItem[]> {
  const maxResults = options.maxResults ?? 5;
  const placeOpts: SearchAddressOptions = {
    crs: options.crs,
    maxResults,
    type: 'place',
  };
  const proxyParams = buildSearchParams(trimmed, placeOpts);
  return searchAddressViaProxy(proxyParams, maxResults).then((viaProxy) => {
    const finish = (items: VWorldAddressItem[]) =>
      items.map((it) => ({ ...it, kind: 'place' as const }));
    if (Array.isArray(viaProxy)) return finish(viaProxy);
    if (viaProxy === 'upstream_failed') return [];
    if (!apiKey) {
      console.warn('[vworldAddressSearch] VWORLD_API_KEY not set');
      return [];
    }
    return searchOneJsonp(trimmed, placeOpts, apiKey).then(finish);
  });
}

function searchOneJsonp(
  trimmed: string,
  options: SearchAddressOptions,
  apiKey: string
): Promise<VWorldAddressItem[]> {
  const { maxResults = 5 } = options;
  const params = buildSearchParams(trimmed, options, apiKey);

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
        resolve(parseSearchResponse(data, maxResults));
      } catch {
        resolve([]);
      }
    };

    script.src = `${VWORLD_SEARCH_BASE}?${params.toString()}&callback=${encodeURIComponent(callbackName)}`;
    script.async = true;
    script.onerror = () => {
      cleanup();
      console.warn('[vworldAddressSearch] JSONP script load failed');
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
  const pnuFromObj = (() => {
    const direct = obj.pnu;
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
    const land = obj.land as Record<string, unknown> | undefined;
    const fromLand = land?.pnu;
    if (typeof fromLand === 'string' && fromLand.trim()) return fromLand.trim();
    return undefined;
  })();

  let jibun: string | undefined;
  let roadAddr: string | undefined;
  let pnu = pnuFromObj;
  let buildingName: string | undefined;

  // 1) 배열 형식: [{ type: 'parcel'|'road', text: '...' }, ...]
  if (Array.isArray(result)) {
    const parcelItem = result.find((r: { type?: string }) => {
      const t = String(r?.type ?? '').toLowerCase();
      return t === 'parcel' || t === 'parcels';
    }) as Record<string, unknown> | undefined;
    const roadItem = result.find((r: { type?: string }) => {
      const t = String(r?.type ?? '').toLowerCase();
      return t === 'road' || t === 'roads';
    }) as Record<string, unknown> | undefined;
    const pnuFromArrayItem = (() => {
      if (!parcelItem) return undefined;
      const direct = parcelItem.pnu;
      if (typeof direct === 'string' && direct.trim()) return direct.trim();
      const upper = parcelItem.PNU;
      if (typeof upper === 'string' && upper.trim()) return upper.trim();
      const land = parcelItem.land as Record<string, unknown> | undefined;
      const fromLand = land?.pnu ?? land?.PNU;
      if (typeof fromLand === 'string' && fromLand.trim()) return fromLand.trim();
      const structure = parcelItem.structure as Record<string, unknown> | undefined;
      const pnuFromLc = buildPnuFromLevel4Lc(
        structure?.level4LC,
        (parcelItem.text as string | undefined) ?? (structure?.level5 as string | undefined)
      );
      if (pnuFromLc) return pnuFromLc;
      return undefined;
    })();
    const parcelText = (parcelItem as { text?: string } | undefined)?.text;
    const roadText = (roadItem as { text?: string } | undefined)?.text;
    if (typeof parcelText === 'string' && parcelText.trim()) jibun = parcelText.trim();
    if (typeof roadText === 'string' && roadText.trim()) roadAddr = roadText.trim();
    if (pnuFromArrayItem) pnu = pnuFromArrayItem;
    if (jibun || roadAddr || pnu) {
      return { pnu, jibun, road: roadAddr };
    }
    return null;
  }

  // 2) result.parcel / result.road 문자열 (일부 버전)
  const parcelStr = obj.parcel as string | undefined;
  const roadStr = obj.road as string | undefined;
  if (typeof parcelStr === 'string' && parcelStr.trim()) jibun = parcelStr.trim();
  if (typeof roadStr === 'string' && roadStr.trim()) roadAddr = roadStr.trim();

  // 3) land / road / structure 하위 객체 — addr만 있어도 road는 별도 채움 (조기 return 금지)
  const land = obj.land as Record<string, unknown> | undefined;
  const road = obj.road as Record<string, unknown> | undefined;
  const structure = obj.structure as Record<string, unknown> | undefined;

  if (!jibun) {
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
  }

  if (!roadAddr) {
    if (road?.addr && typeof road.addr === 'string') {
      roadAddr = road.addr;
    } else if (road?.name && typeof road.name === 'string') {
      const num1 = road.number1 != null ? String(road.number1) : '';
      const num2 = road.number2 != null ? String(road.number2) : '';
      roadAddr = [road.name, num1, num2].filter(Boolean).join(' ');
    }
  }

  // 4) 단일 ADDR — 도로명이 없을 때만 지번 폴백 (도로명 파싱을 가리지 않음)
  if (!jibun) {
    const singleAddr = (obj.ADDR as string) ?? (obj.addr as string);
    if (typeof singleAddr === 'string' && singleAddr.trim()) {
      jibun = singleAddr.trim();
    }
  }

  // 5) result.text 단독 (ROAD/PARCEL 단건 응답)
  if (!jibun && !roadAddr) {
    const text = (obj.text as string) ?? (obj.TEXT as string);
    if (typeof text === 'string' && text.trim()) {
      jibun = text.trim();
    }
  }

  const bld =
    (road?.bldnm as string) ?? (land?.bldnm as string) ?? (obj.bldnm as string);
  if (typeof bld === 'string' && bld.trim()) buildingName = bld.trim();

  const pnuFromStructure = buildPnuFromLevel4Lc(
    structure?.level4LC,
    jibun ?? (structure?.level5 as string | undefined)
  );

  if (jibun || roadAddr || buildingName)
    return {
      pnu: pnu ?? pnuFromStructure,
      jibun,
      road: roadAddr,
      buildingName,
    };
  return null;
}

function normalizeAddrKey(value: string): string {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .replace(/번지/g, '')
    .trim()
    .toLowerCase();
}

/**
 * 역지오코딩에 도로명이 없을 때 — 지번 문자열로 검색 API를 쳐 road 필드를 보강.
 * (getAddress ROAD=NOT_FOUND 여도 search(parcel) 응답의 address.road 에 값이 있는 경우가 많음)
 */
export async function findRoadAddressByJibun(
  jibun: string,
  options?: { apiKey?: string; lon?: number; lat?: number }
): Promise<string | null> {
  const query = String(jibun ?? '').trim();
  if (!query) return null;
  const apiKey = options?.apiKey;
  const items = await searchAddress(query, {
    apiKey,
    type: 'address',
    category: 'parcel',
    maxResults: 8,
  });
  const withRoad = items.filter((it) => String(it.roadAddress ?? '').trim());
  if (!withRoad.length) return null;

  const qKey = normalizeAddrKey(query);
  const exact = withRoad.find((it) => normalizeAddrKey(it.jibunAddress ?? '') === qKey);
  if (exact?.roadAddress) return exact.roadAddress.trim();

  const lon = options?.lon;
  const lat = options?.lat;
  if (lon != null && lat != null && Number.isFinite(lon) && Number.isFinite(lat)) {
    let best = withRoad[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const it of withRoad) {
      const dx = it.point.x - lon;
      const dy = it.point.y - lat;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = it;
      }
    }
    return best.roadAddress?.trim() || null;
  }

  const partial = withRoad.find((it) => {
    const p = normalizeAddrKey(it.jibunAddress ?? '');
    return p.includes(qKey) || qKey.includes(p);
  });
  return (partial ?? withRoad[0]).roadAddress?.trim() || null;
}

/**
 * 좌표(WGS84 경도·위도)로 주소 조회 (역지오코딩)
 * VWorld Address API 2.0 getAddress 사용. CORS 회피를 위해 JSONP로 호출.
 */
export function getAddressFromCoord(
  lon: number,
  lat: number,
  options?: { apiKey?: string; type?: 'BOTH' | 'ROAD' | 'PARCEL' }
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
    type: options?.type ?? 'BOTH',
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

export type VWorldGetCoordAddressType = 'ROAD' | 'PARCEL';

export type GetCoordFromAddressResult =
  | { ok: true; lon: number; lat: number; raw: unknown }
  | { ok: false; message: string; status?: string; raw?: unknown };

interface VWorldGetCoordResponse {
  response?: {
    status?: string;
    result?: unknown;
    [key: string]: unknown;
  };
}

function parseGetCoordResult(result: unknown): { lon: number; lat: number } | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const point = r.point as Record<string, unknown> | undefined;
  if (point && point.x != null && point.y != null) {
    const lon = Number(point.x);
    const lat = Number(point.y);
    if (!Number.isNaN(lon) && !Number.isNaN(lat)) return { lon, lat };
  }
  return null;
}

/**
 * 도로명/지번 주소 문자열 → 좌표 (VWorld Address API 2.0 `GetCoord`).
 * 공식 예제와 동일 파라미터. CORS 회피를 위해 JSONP.
 * @see https://www.vworld.kr/dev/v4dv_address2_s001.do
 */
export function getCoordFromAddress(
  address: string,
  options: { apiKey: string; type?: VWorldGetCoordAddressType }
): Promise<GetCoordFromAddressResult> {
  const trimmed = address?.trim() ?? '';
  const apiKey = options.apiKey?.trim() ?? '';
  if (!trimmed) {
    return Promise.resolve({ ok: false, message: '주소가 비어 있습니다.' });
  }
  if (!apiKey) {
    return Promise.resolve({ ok: false, message: 'VWorld 인증키가 없습니다.' });
  }

  return new Promise((resolve) => {
    if (typeof document === 'undefined' || !document.head) {
      resolve({ ok: false, message: '브라우저 환경에서만 호출할 수 있습니다.' });
      return;
    }

    const addrType = options.type ?? 'ROAD';
    const params = new URLSearchParams({
      service: 'address',
      request: 'GetCoord',
      version: '2.0',
      crs: 'EPSG:4326',
      type: addrType,
      address: trimmed,
      format: 'json',
      errorformat: 'json',
      key: apiKey,
    });

    const callbackName = `__vworldGetCoord_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');

    const cleanup = () => {
      delete (window as unknown as Record<string, unknown>)[callbackName];
      if (script.parentNode) script.remove();
    };

    (window as unknown as Record<string, (data: VWorldGetCoordResponse) => void>)[callbackName] = (data: VWorldGetCoordResponse) => {
      cleanup();
      try {
        const status = data?.response?.status;
        const raw = data?.response ?? data;
        if (status !== 'OK') {
          const msg =
            status === 'NOT_FOUND'
              ? '검색 결과가 없습니다 (NOT_FOUND).'
              : `VWorld 응답 상태: ${status ?? '(없음)'}`;
          resolve({ ok: false, message: msg, status, raw });
          return;
        }
        const parsed = parseGetCoordResult(data?.response?.result);
        if (!parsed) {
          resolve({
            ok: false,
            message: '응답에 좌표(point)를 찾지 못했습니다.',
            status,
            raw: data?.response?.result,
          });
          return;
        }
        resolve({ ok: true, lon: parsed.lon, lat: parsed.lat, raw: data });
      } catch (err) {
        console.warn('[vworldAddressSearch] getCoordFromAddress parse error', err);
        resolve({ ok: false, message: err instanceof Error ? err.message : '파싱 오류' });
      }
    };

    script.src = `${VWORLD_ADDRESS_BASE}?${params.toString()}&callback=${encodeURIComponent(callbackName)}`;
    script.async = true;
    script.onerror = () => {
      cleanup();
      console.warn('[vworldAddressSearch] getCoordFromAddress JSONP failed');
      resolve({ ok: false, message: 'JSONP 스크립트 로드에 실패했습니다.' });
    };
    document.head.appendChild(script);
  });
}
