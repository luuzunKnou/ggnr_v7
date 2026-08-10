/** 카카오 지도 JS SDK 1회 로드 (로드뷰용) */

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

export type KakaoSdkFailureDetail = {
  kakaoOfficialMsg?: string;
  kakaoCode?: number;
  httpStatus?: number;
  /** script onerror — 네트워크 401(도메인 미등록) 가능성 높음 */
  scriptLoadFailed?: boolean;
};

/** loadKakaoMapsSdk reject — message 는 앱 내부 구분용 */
export class KakaoMapsSdkLoadError extends Error {
  readonly kakaoOfficialMsg?: string;
  readonly kakaoCode?: number;
  readonly httpStatus?: number;
  readonly scriptLoadFailed?: boolean;

  constructor(message: string, detail?: KakaoSdkFailureDetail) {
    super(message);
    this.name = 'KakaoMapsSdkLoadError';
    this.kakaoOfficialMsg = detail?.kakaoOfficialMsg;
    this.kakaoCode = detail?.kakaoCode;
    this.httpStatus = detail?.httpStatus;
    this.scriptLoadFailed = detail?.scriptLoadFailed;
  }
}

export function isKakaoDomainMismatch(detail?: {
  kakaoOfficialMsg?: string;
  kakaoCode?: number;
  httpStatus?: number;
  scriptLoadFailed?: boolean;
}): boolean {
  if (detail?.scriptLoadFailed) return true;
  const msg = detail?.kakaoOfficialMsg ?? '';
  return (
    detail?.kakaoCode === -401 ||
    detail?.httpStatus === 401 ||
    /domain mismatched/i.test(msg) ||
    /registered web domains/i.test(msg) ||
    /잘못된 접근/i.test(msg)
  );
}

/** script onerror 시 CORS 로 본문을 읽을 수 없음 — 카카오 공식 응답 형식으로 caller 치환 */
function buildScriptUnauthorizedDetail(): KakaoSdkFailureDetail {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return {
    scriptLoadFailed: true,
    httpStatus: 401,
    kakaoCode: -401,
    kakaoOfficialMsg: `domain mismatched! caller=${origin}. check out registered web domains.`,
  };
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
    `/proxy/dapi.kakao.com/v2/maps/sdk.js` +
    `?appkey=${encodeURIComponent(key)}&autoload=false`;

  loadPromise = new Promise((resolve, reject) => {
    const finish = () => {
      const kakao = window.kakao;
      if (!kakao?.maps?.load) {
        rejectSdkLoad('카카오 지도 SDK 로드 실패', reject);
        return;
      }
      kakao.maps.load(() => {
        if (!window.kakao?.maps?.Roadview) {
          rejectSdkLoad('카카오 로드뷰 모듈 없음', reject);
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
      rejectSdkLoad('카카오 지도 스크립트 오류', reject, buildScriptUnauthorizedDetail());
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

export function getKakaoMaps(): KakaoMapsNs | null {
  return window.kakao ?? null;
}
