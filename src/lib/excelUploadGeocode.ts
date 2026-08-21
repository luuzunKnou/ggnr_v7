/**
 * 엑셀 업로드 전용 지오코딩.
 * 같은 주소 좌표 재사용 + JSONP/게이트웨이 일시 실패 재시도.
 */

import {
  getCoordFromAddress,
  type GetCoordFromAddressResult,
  type VWorldGetCoordAddressType,
} from '@/app/(pages)/map/_mapComponents/addressSearch/vworldAddressSearch';
import { hangjeongRiAddressAlt } from '@/lib/excelUploadAddressNormalize';

const TRANSIENT_RETRY_DELAYS_MS = [0, 500, 1200] as const;

export type ExcelGeocodeResult = {
  ok: boolean;
  lon?: number;
  lat?: number;
  message?: string;
  hangjeongFix: string | null;
};

function isTransientVworldFailure(result: Pick<GetCoordFromAddressResult, 'ok' | 'message'>): boolean {
  if (result.ok) return false;
  const msg = String(result.message ?? '');
  return msg.includes('JSONP') || msg.includes('로드에 실패');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function getCoordWithTransientRetry(
  addr: string,
  apiKey: string,
  type: VWorldGetCoordAddressType
): Promise<GetCoordFromAddressResult> {
  let last: GetCoordFromAddressResult = { ok: false, message: '좌표 조회 실패' };
  for (const wait of TRANSIENT_RETRY_DELAYS_MS) {
    if (wait) await sleep(wait);
    last = await getCoordFromAddress(addr, { apiKey, type });
    if (last.ok || !isTransientVworldFailure(last)) return last;
  }
  return last;
}

/** 원주소 실패 시 행정리→법정리 주소로 GetCoord 재시도 */
export async function geocodeExcelAddress(addr: string, apiKey: string): Promise<ExcelGeocodeResult> {
  let coord = await getCoordWithTransientRetry(addr, apiKey, 'ROAD');
  if (!coord.ok) {
    coord = await getCoordWithTransientRetry(addr, apiKey, 'PARCEL');
  }
  if (coord.ok) return { ...coord, hangjeongFix: null };
  const alt = hangjeongRiAddressAlt(addr);
  if (!alt) return { ...coord, hangjeongFix: null };
  let retry = await getCoordWithTransientRetry(alt, apiKey, 'ROAD');
  if (!retry.ok) {
    retry = await getCoordWithTransientRetry(alt, apiKey, 'PARCEL');
  }
  if (retry.ok) {
    return { ...retry, hangjeongFix: `${addr} → ${alt}` };
  }
  return { ...coord, hangjeongFix: null };
}

/** 한 번의 엑셀 올리기 안에서 같은 주소 좌표를 재사용한다. 일시 실패는 캐시하지 않는다. */
export function createExcelGeocodeCache(): (addr: string, apiKey: string) => Promise<ExcelGeocodeResult> {
  const hit = new Map<string, ExcelGeocodeResult>();

  return async (addr: string, apiKey: string): Promise<ExcelGeocodeResult> => {
    const key = String(addr ?? '').trim();
    if (!key) return { ok: false, message: '주소가 비어 있습니다.', hangjeongFix: null };
    const cached = hit.get(key);
    if (cached) return { ...cached };
    const result = await geocodeExcelAddress(key, apiKey);
    if (result.ok || !isTransientVworldFailure(result)) {
      hit.set(key, result);
    }
    return result;
  };
}
