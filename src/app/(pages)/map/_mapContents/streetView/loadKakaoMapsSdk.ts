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

let loadPromise: Promise<KakaoMapsNs> | null = null;

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

  loadPromise = new Promise((resolve, reject) => {
    const finish = () => {
      const kakao = window.kakao;
      if (!kakao?.maps?.load) {
        reject(new Error('카카오 지도 SDK 로드 실패'));
        loadPromise = null;
        return;
      }
      kakao.maps.load(() => {
        if (!window.kakao?.maps?.Roadview) {
          reject(new Error('카카오 로드뷰 모듈 없음'));
          loadPromise = null;
          return;
        }
        resolve(window.kakao);
      });
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-kakao-maps-sdk]');
    if (existing) {
      if (window.kakao?.maps) {
        finish();
        return;
      }
      existing.addEventListener('load', finish);
      existing.addEventListener('error', () => {
        loadPromise = null;
        reject(new Error('카카오 지도 스크립트 오류'));
      });
      return;
    }

    const script = document.createElement('script');
    script.dataset.kakaoMapsSdk = '1';
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
    script.onload = finish;
    script.onerror = () => {
      loadPromise = null;
      reject(new Error('카카오 지도 스크립트 오류'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

export function getKakaoMaps(): KakaoMapsNs | null {
  return window.kakao ?? null;
}
