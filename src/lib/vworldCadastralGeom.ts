/**
 * VWorld 연속지적(LP_PA_CBND_BUBUN) GetFeature — PNU로 필지 폴리곤 조회
 * 로컬 public_layer.jijuk 에 없을 때 폴백용.
 *
 * domain 파라미터는 등록 URL과 다르면 INCORRECT_KEY 가 나므로,
 * runtime.env 의 VWORLD_DOMAIN 이 있을 때만 붙인다.
 */
import { getMapConfig } from '@/service/configService';

type VworldDataResponse = {
  response?: {
    status?: string;
    result?: {
      featureCollection?: {
        features?: Array<{
          geometry?: Record<string, unknown> | null;
          properties?: { pnu?: string };
        }>;
      };
    };
    error?: { text?: string; level?: string; code?: string };
  };
};

/** PNU(19) → GeoJSON geometry (EPSG:4326). 없으면 null */
export async function fetchVworldCadastralGeomByPnu(
  pnu: string
): Promise<{ geometry4326: Record<string, unknown>; pnu: string } | null> {
  const digits = String(pnu ?? '').replace(/\D/g, '');
  if (digits.length < 19) return null;

  const { VWORLD_API_KEY, VWORLD_DOMAIN } = getMapConfig();
  if (!VWORLD_API_KEY) return null;

  const pnu19 = digits.slice(0, 19);
  const params = new URLSearchParams({
    service: 'data',
    version: '2.0',
    request: 'GetFeature',
    format: 'json',
    data: 'LP_PA_CBND_BUBUN',
    key: VWORLD_API_KEY,
    attrFilter: `pnu:=:${pnu19}`,
    geometry: 'true',
    attribute: 'true',
    crs: 'EPSG:4326',
    size: '1',
    page: '1',
  });
  // 등록 URL과 다른 domain 을 넣으면 INCORRECT_KEY — 설정된 경우만 전달
  if (VWORLD_DOMAIN) params.set('domain', VWORLD_DOMAIN);

  try {
    const res = await fetch(`https://api.vworld.kr/req/data?${params.toString()}`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as VworldDataResponse;
    if (String(data?.response?.status ?? '').toUpperCase() !== 'OK') return null;
    const feature = data.response?.result?.featureCollection?.features?.[0];
    const geometry = feature?.geometry;
    if (!geometry || typeof geometry !== 'object') return null;
    const type = String((geometry as { type?: string }).type ?? '');
    if (!type || !('coordinates' in geometry)) return null;
    const propPnu = String(feature?.properties?.pnu ?? pnu19).replace(/\D/g, '');
    return {
      geometry4326: geometry as Record<string, unknown>,
      pnu: propPnu.length >= 19 ? propPnu.slice(0, 19) : pnu19,
    };
  } catch {
    return null;
  }
}
