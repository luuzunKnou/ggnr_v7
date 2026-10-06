/** 카카오 지도 JS SDK 1회 로드 (로드뷰용) */

import { withBasePath } from '@/lib/basePath';

export type KakaoRoadviewOptions = {
  disableZoomControl?: boolean;
  pan?: number;
  tilt?: number;
  zoom?: number;
  panoId?: number;
};

type KakaoMapsNs = {
  maps: {
    load: (cb: () => void) => void;
    LatLng: new (lat: number, lng: number) => KakaoLatLng;
    Roadview: new (container: HTMLElement, options?: KakaoRoadviewOptions) => KakaoRoadview;
    RoadviewClient: new () => KakaoRoadviewClient;
    event: {
      addListener: (target: object, type: string, handler: (...args: unknown[]) => void) => void;
      removeListener: (target: object, type: string, handler: (...args: unknown[]) => void) => void;
    };
  };
};

export type KakaoLatLng = {
  getLat: () => number;
  getLng: () => number;
};

export type KakaoViewpoint = {
  pan: number;
  tilt: number;
  zoom: number;
};

export type KakaoRoadview = {
  setPanoId: (panoId: number, position: KakaoLatLng) => void;
  getPanoId: () => number;
  getPosition: () => KakaoLatLng;
  getViewpoint: () => KakaoViewpoint;
  setViewpoint: (viewpoint: KakaoViewpoint) => void;
  relayout: () => void;
};

export type KakaoRoadviewClient = {
  getNearestPanoId: (
    position: KakaoLatLng,
    radius: number,
    callback: (panoId: number | null) => void
  ) => void;
};

declare global {
  interface Window {
    kakao?: KakaoMapsNs;
  }
}

/** proxy=서버가 dapi를 받는 단계, domain=카카오 도메인 거절, followup=이어받는 CDN 단계 */
export type KakaoSdkStage = 'proxy' | 'domain' | 'followup';

export type KakaoSdkFailureDetail = {
  stage?: KakaoSdkStage;
  kakaoOfficialMsg?: string;
  kakaoCode?: number;
  httpStatus?: number;
};

/** loadKakaoMapsSdk reject — message 는 앱 내부 구분용 */
export class KakaoMapsSdkLoadError extends Error {
  readonly stage?: KakaoSdkStage;
  readonly kakaoOfficialMsg?: string;
  readonly kakaoCode?: number;
  readonly httpStatus?: number;

  constructor(message: string, detail?: KakaoSdkFailureDetail) {
    super(message);
    this.name = 'KakaoMapsSdkLoadError';
    this.stage = detail?.stage;
    this.kakaoOfficialMsg = detail?.kakaoOfficialMsg;
    this.kakaoCode = detail?.kakaoCode;
    this.httpStatus = detail?.httpStatus;
  }
}

function looksLikeDomainMismatch(text: string): boolean {
  return (
    /domain mismatched/i.test(text) ||
    /registered web domains/i.test(text) ||
    /잘못된 접근/.test(text)
  );
}

export function isKakaoDomainMismatch(detail?: {
  stage?: KakaoSdkStage;
  kakaoOfficialMsg?: string;
  kakaoCode?: number;
  httpStatus?: number;
}): boolean {
  if (detail?.stage === 'domain') return true;
  return looksLikeDomainMismatch(detail?.kakaoOfficialMsg ?? '');
}

function clipProbeText(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 180);
}

/** script onerror는 상태 코드가 없다. 같은 프록시 주소를 다시 읽어 단계만 가른다. */
async function probeProxyFailure(scriptUrl: string): Promise<KakaoSdkFailureDetail> {
  try {
    const res = await fetch(scriptUrl, { cache: 'no-store' });
    const text = await res.text();
    let headerMsg = '';
    try {
      headerMsg = decodeURIComponent(res.headers.get('x-kakao-proxy-error') ?? '');
    } catch {
      headerMsg = res.headers.get('x-kakao-proxy-error') ?? '';
    }
    if (looksLikeDomainMismatch(text) || looksLikeDomainMismatch(headerMsg)) {
      return {
        stage: 'domain',
        httpStatus: res.status,
        kakaoOfficialMsg: clipProbeText(headerMsg || text),
      };
    }
    return {
      stage: 'proxy',
      httpStatus: res.status,
      kakaoOfficialMsg: clipProbeText(headerMsg || text),
    };
  } catch (error) {
    return {
      stage: 'proxy',
      kakaoOfficialMsg: error instanceof Error ? error.message : String(error),
    };
  }
}

let loadPromise: Promise<KakaoMapsNs> | null = null;

function rejectSdkLoad(
  message: string,
  reject: (reason: Error) => void,
  detail?: KakaoSdkFailureDetail
) {
  loadPromise = null;
  reject(new KakaoMapsSdkLoadError(message, detail));
}

export function loadKakaoMapsSdk(appKey: string): Promise<KakaoMapsNs> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('window 없음'));
  }
  const key = appKey.trim();
  if (!key) {
    return Promise.reject(new Error('카카오 지도 API 키가 없습니다'));
  }
  if (window.kakao?.maps?.LatLng && window.kakao?.maps?.Roadview) {
    return Promise.resolve(window.kakao);
  }
  if (loadPromise) return loadPromise;

  // 경로에 dapi.kakao.com/v2/maps/sdk.js 유지 — SDK 콜백 경로 검사용. Referer 는 서버 프록시에서 dggs.kr 고정.
  const scriptUrl =
    withBasePath(`/proxy/dapi.kakao.com/v2/maps/sdk.js`) +
    `?appkey=${encodeURIComponent(key)}&autoload=false`;

  loadPromise = new Promise((resolve, reject) => {
    const finish = () => {
      const kakao = window.kakao;
      if (!kakao?.maps?.load) {
        rejectSdkLoad('카카오 지도 SDK 로드 실패', reject, {
          stage: 'proxy',
          kakaoOfficialMsg: '스크립트는 왔지만 카카오 로더가 없습니다.',
        });
        return;
      }
      kakao.maps.load(() => {
        if (!window.kakao?.maps?.Roadview) {
          rejectSdkLoad('카카오 로드뷰 모듈 없음', reject, { stage: 'followup' });
          return;
        }
        resolve(window.kakao);
      });
    };

    document
      .querySelectorAll('script[src*="/dapi.kakao.com/v2/maps/sdk.js"]')
      .forEach((existingScript) => {
        existingScript.remove();
      });

    const script = document.createElement('script');
    script.id = 'kakao-map-sdk';
    script.dataset.kakaoMapsSdk = '1';
    script.async = true;
    script.src = scriptUrl;
    script.onload = finish;
    script.onerror = () => {
      void probeProxyFailure(scriptUrl).then((detail) => {
        rejectSdkLoad('카카오 지도 스크립트 오류', reject, detail);
      });
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

export function getKakaoMaps(): KakaoMapsNs | null {
  return window.kakao ?? null;
}
