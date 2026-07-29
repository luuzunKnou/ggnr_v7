/**
 * 고도 조회 — 경사도(거리 고도) 측정용
 * Open-Meteo Elevation API (서버 프록시)
 */

export type GetElevationParams = {
  /** WGS84 경도 */
  lon?: number;
  /** WGS84 위도 */
  lat?: number;
};

export type GetElevationResult = {
  elevation: number | null;
  error?: string;
};

/** 경위도 1점 고도(m). 실패 시 elevation null */
export async function getElevation(params: GetElevationParams): Promise<GetElevationResult> {
  const lon = Number(params?.lon);
  const lat = Number(params?.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return { elevation: null, error: '좌표가 올바르지 않습니다.' };
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { elevation: null, error: '좌표 범위를 벗어났습니다.' };
  }

  const url = `https://api.open-meteo.com/v1/elevation?latitude=${encodeURIComponent(String(lat))}&longitude=${encodeURIComponent(String(lon))}`;

  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (!res.ok) {
      return { elevation: null, error: `고도 조회 실패 (${res.status})` };
    }
    const json = (await res.json()) as { elevation?: number[] };
    const raw = Array.isArray(json?.elevation) ? json.elevation[0] : null;
    const elevation = raw == null || !Number.isFinite(Number(raw)) ? null : Number(raw);
    return { elevation };
  } catch (e: unknown) {
    return {
      elevation: null,
      error: e instanceof Error ? e.message : '고도 조회에 실패했습니다.',
    };
  }
}
