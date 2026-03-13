/**
 * Cesium 모듈 단일 로드. HMR 시 import('cesium')가 무효화되는 문제 방지를 위해
 * window에 캐시하고 한 번만 로드. (CesiumMap에서 직접 import 시 HMR 업데이트로 모듈 삭제 오류 발생)
 */
const CesiumCacheKey = '__GGNR_CESIUM_PROMISE__';

export function getCesium(): Promise<typeof import('cesium')> {
  if (typeof window === 'undefined') return import('cesium');
  const win = window as unknown as { [key: string]: Promise<typeof import('cesium')> | undefined };
  let p = win[CesiumCacheKey];
  if (!p) {
    p = import('cesium');
    win[CesiumCacheKey] = p;
  }
  return p.catch((err) => {
    win[CesiumCacheKey] = undefined;
    throw err;
  });
}
