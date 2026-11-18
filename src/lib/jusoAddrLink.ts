/**
 * 행정안전부 도로명주소 검색 API (addrLinkApi) + 좌표 API (addrCoordApi)
 * — VWorld 주소검색 실패 시 서버 폴백용
 * @see https://business.juso.go.kr/addrlink/addrLinkApi.do
 */

import proj4 from 'proj4';

const JUSO_ADDR_LINK = 'https://business.juso.go.kr/addrlink/addrLinkApi.do';
const JUSO_ADDR_COORD = 'https://business.juso.go.kr/addrlink/addrCoordApi.do';
const VWORLD_ADDRESS = 'https://api.vworld.kr/req/address';

/** UTM-K (EPSG:5179) — juso 좌표 API entX/entY */
proj4.defs(
  'EPSG:5179',
  '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'
);

export type JusoSearchItem = {
  id?: string;
  address: string;
  roadAddress?: string;
  jibunAddress?: string;
  buildingName?: string;
  point: { x: number; y: number };
};

type JusoCommon = {
  totalCount?: string;
  errorCode?: string;
  errorMessage?: string;
};

type JusoAddrRow = {
  roadAddr?: string;
  roadAddrPart1?: string;
  roadAddrPart2?: string;
  jibunAddr?: string;
  bdNm?: string;
  admCd?: string;
  rnMgtSn?: string;
  udrtYn?: string;
  buldMnnm?: string | number;
  buldSlno?: string | number;
  bdMgtSn?: string;
};

type JusoLinkResponse = {
  results?: {
    common?: JusoCommon;
    juso?: JusoAddrRow[] | null;
  };
};

type JusoCoordRow = {
  entX?: string;
  entY?: string;
};

type JusoCoordResponse = {
  results?: {
    common?: JusoCommon;
    juso?: JusoCoordRow[] | null;
  };
};

function toStr(v: unknown): string {
  return String(v ?? '').trim();
}

function utmkToWgs84(entX: string, entY: string): { x: number; y: number } | null {
  const x = Number(entX);
  const y = Number(entY);
  if (![x, y].every((n) => Number.isFinite(n))) return null;
  try {
    const [lon, lat] = proj4('EPSG:5179', 'EPSG:4326', [x, y]) as [number, number];
    if (![lon, lat].every((n) => Number.isFinite(n))) return null;
    return { x: lon, y: lat };
  } catch {
    return null;
  }
}

async function fetchJusoJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchCoordFromJuso(
  row: JusoAddrRow,
  confmKey: string
): Promise<{ x: number; y: number } | null> {
  const admCd = toStr(row.admCd);
  const rnMgtSn = toStr(row.rnMgtSn);
  const udrtYn = toStr(row.udrtYn) || '0';
  const buldMnnm = toStr(row.buldMnnm);
  const buldSlno = toStr(row.buldSlno) || '0';
  if (!admCd || !rnMgtSn || !buldMnnm) return null;

  const params = new URLSearchParams({
    confmKey,
    admCd,
    rnMgtSn,
    udrtYn,
    buldMnnm,
    buldSlno,
    resultType: 'json',
  });
  const data = await fetchJusoJson<JusoCoordResponse>(`${JUSO_ADDR_COORD}?${params}`);
  const common = data?.results?.common;
  if (toStr(common?.errorCode) !== '0') return null;
  const first = data?.results?.juso?.[0];
  if (!first) return null;
  return utmkToWgs84(toStr(first.entX), toStr(first.entY));
}

async function fetchCoordFromVworld(
  address: string,
  vworldKey: string
): Promise<{ x: number; y: number } | null> {
  const trimmed = normalizeGeocodeQuery(address);
  if (!trimmed || !vworldKey) return null;

  for (const type of ['ROAD', 'PARCEL'] as const) {
    const params = new URLSearchParams({
      service: 'address',
      request: 'GetCoord',
      version: '2.0',
      crs: 'EPSG:4326',
      type,
      address: trimmed,
      format: 'json',
      errorformat: 'json',
      key: vworldKey,
    });
    try {
      const res = await fetch(`${VWORLD_ADDRESS}?${params}`, { method: 'GET', cache: 'no-store' });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        response?: { status?: string; result?: { point?: { x?: string; y?: string } } };
      };
      if (data?.response?.status !== 'OK') continue;
      const point = data.response.result?.point;
      const lon = point?.x != null ? Number(point.x) : NaN;
      const lat = point?.y != null ? Number(point.y) : NaN;
      if (Number.isFinite(lon) && Number.isFinite(lat)) return { x: lon, y: lat };
    } catch {
      /* try next type */
    }
  }
  return null;
}

/** 괄호·부가설명 제거 — Nominatim 등 외부 지오코더 매칭용 */
function normalizeGeocodeQuery(address: string): string {
  return String(address ?? '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 좌표제공API·브이월드 모두 실패할 때 — OSM Nominatim (폴백 전용)
 * 검색API 키만 있고 좌표API 키가 없는 경우·브이월드 502 대응
 */
async function fetchCoordFromNominatim(
  ...candidates: Array<string | undefined>
): Promise<{ x: number; y: number } | null> {
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const raw of candidates) {
    const q = normalizeGeocodeQuery(raw ?? '');
    if (!q || seen.has(q)) continue;
    seen.add(q);
    queries.push(q);
  }
  for (const q of queries) {
    const params = new URLSearchParams({
      q,
      format: 'json',
      limit: '1',
      countrycodes: 'kr',
    });
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ggnr_v7-address-fallback/1.0',
        },
      });
      if (!res.ok) continue;
      const rows = (await res.json()) as Array<{ lon?: string; lat?: string }>;
      const first = Array.isArray(rows) ? rows[0] : null;
      if (!first) continue;
      const lon = first.lon != null ? Number(first.lon) : NaN;
      const lat = first.lat != null ? Number(first.lat) : NaN;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      return { x: lon, y: lat };
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

export type SearchJusoAddressArgs = {
  keyword: string;
  confmKey: string;
  /** 좌표 API 승인키 (없으면 confmKey 재사용) */
  coordConfmKey?: string;
  /** VWorld GetCoord 폴백용 (좌표 API 실패 시) */
  vworldKey?: string;
  maxResults?: number;
};

/**
 * 도로명주소 검색 API → (가능하면) 좌표 보강 후 VWorld 검색 결과와 동일 형태로 반환
 */
export async function searchJusoAddress(args: SearchJusoAddressArgs): Promise<JusoSearchItem[]> {
  const keyword = args.keyword.trim();
  const confmKey = args.confmKey.trim();
  if (!keyword || !confmKey) return [];

  const maxResults = Math.min(Math.max(args.maxResults ?? 5, 1), 20);
  const params = new URLSearchParams({
    confmKey,
    currentPage: '1',
    countPerPage: String(maxResults),
    keyword,
    resultType: 'json',
  });

  const data = await fetchJusoJson<JusoLinkResponse>(`${JUSO_ADDR_LINK}?${params}`);
  const common = data?.results?.common;
  if (!data || toStr(common?.errorCode) !== '0') return [];

  const rows = Array.isArray(data.results?.juso) ? data.results!.juso! : [];
  if (!rows.length) return [];

  const coordKey = (args.coordConfmKey ?? confmKey).trim();
  const vworldKey = args.vworldKey?.trim() ?? '';
  const out: JusoSearchItem[] = [];

  for (const row of rows.slice(0, maxResults)) {
    const roadPart1 = toStr(row.roadAddrPart1);
    const road = toStr(row.roadAddr) || roadPart1;
    const jibun = toStr(row.jibunAddr);
    const buildingName = toStr(row.bdNm) || undefined;
    const address = road || jibun;
    if (!address) continue;

    let point =
      (await fetchCoordFromJuso(row, coordKey)) ??
      (await fetchCoordFromVworld(roadPart1 || road || jibun, vworldKey)) ??
      (await fetchCoordFromNominatim(roadPart1, road, jibun));

    if (!point) {
      point = { x: NaN, y: NaN };
    }

    out.push({
      id: toStr(row.bdMgtSn) || undefined,
      address,
      roadAddress: road || undefined,
      jibunAddress: jibun || undefined,
      buildingName,
      point,
    });
  }

  return out.filter((it) => Number.isFinite(it.point.x) && Number.isFinite(it.point.y));
}
