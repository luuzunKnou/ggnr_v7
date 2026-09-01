'use client';

import { call } from '@/lib/api';

export type InstallPlacePreview = {
  installLocation: string;
  landCategory: string;
  lon: number | null;
  lat: number | null;
  pnu: string | null;
};

/**
 * 설치위치·좌표 → 지목 미리보기 (주소 PNU + 좌표 근처 필지).
 */
export async function fetchInstallPlacePreview(params: {
  installLocation?: string | null;
  landCategory?: string | null;
  lon?: number | null;
  lat?: number | null;
}): Promise<InstallPlacePreview> {
  const empty: InstallPlacePreview = {
    installLocation: String(params.installLocation ?? '').trim(),
    landCategory: String(params.landCategory ?? '').trim(),
    lon: params.lon ?? null,
    lat: params.lat ?? null,
    pnu: null,
  };
  try {
    const res = await call('', 'POST', {
      service: 'roadFrontageMarkerService',
      action: 'previewInstallPlace',
      params: {
        installLocation: params.installLocation ?? '',
        landCategory: params.landCategory ?? '',
        lon: params.lon ?? null,
        lat: params.lat ?? null,
      },
    });
    const data = (res?.data ?? res) as {
      installLocation?: string | null;
      landCategory?: string | null;
      lon?: number | null;
      lat?: number | null;
      pnu?: string | null;
    };
    return {
      installLocation: String(data.installLocation ?? empty.installLocation).trim(),
      landCategory: String(data.landCategory ?? '').trim(),
      lon:
        data.lon != null && Number.isFinite(Number(data.lon)) ? Number(data.lon) : empty.lon,
      lat:
        data.lat != null && Number.isFinite(Number(data.lat)) ? Number(data.lat) : empty.lat,
      pnu: data.pnu != null ? String(data.pnu).trim() || null : null,
    };
  } catch {
    return empty;
  }
}
