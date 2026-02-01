import WebGLTileLayer from 'ol/layer/WebGLTile';
import TileLayer from 'ol/layer/Tile';
import BaseLayer from 'ol/layer/Base';
import ImageTile from 'ol/source/ImageTile';
import XYZ from 'ol/source/XYZ';
import Projection from 'ol/proj/Projection';
import { get as getProjection } from 'ol/proj';
import TileGrid from 'ol/tilegrid/TileGrid';

// 배경지도 제공업체 타입
export type MapProvider = 'vworld' | 'kakao' | 'google' | 'osm';

// VWorld 레이어 타입
export type VWorldLayerType = 'base' | 'satellite' | 'white' | 'night';

// 카카오맵 레이어 타입
export type KakaoLayerType = 'base' | 'satellite';

// 구글 레이어 타입
export type GoogleLayerType = 'base' | 'satellite' | 'terrain';

// OSM 레이어 타입
export type OSMLayerType = 'base' | 'satellite' | 'terrain';


/**
 * VWorld 배경지도 레이어 생성
 */
export function createVWorldLayer(type: VWorldLayerType): WebGLTileLayer {
  const layerMap: Record<VWorldLayerType, { path: string; ext: string }> = {
    base: { path: 'Base', ext: 'png' }, // 일반지도
    satellite: { path: 'Satellite', ext: 'jpeg' }, // 항공영상
    white: { path: 'gray', ext: 'png' }, // 백색지도 (gray 사용)
    night: { path: 'midnight', ext: 'png' }, // 야간지도
  };

  const layerInfo = layerMap[type];
  
  // VWorld xdworld URL 패턴 (API 키 불필요)
  // VWorld는 최대 줌 레벨 19까지만 지원
  // 줌 레벨 20 이상일 때는 19 레벨의 타일을 가져옴
  return new WebGLTileLayer({
    source: new ImageTile({
      loader: (z, x, y) => {
        // 줌 레벨이 19를 초과하면 19로 제한
        const actualZ = z > 19 ? 19 : z;
        const url = `https://xdworld.vworld.kr/2d/${layerInfo.path}/service/${actualZ}/${x}/${y}.${layerInfo.ext}`;
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = url;
        });
      },
      attributions: '© VWorld',
      tileSize: 256,
    }),
    cacheSize: 256, // 타일 캐시 크기 확대 (기본 256)
  });
}

/**
 * 카카오맵 배경지도 레이어 생성
 * EPSG:5181 좌표계 사용
 */
export function createKakaoLayer(type: KakaoLayerType): TileLayer<XYZ> {
  const kakaoResolutions = [2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1, 0.5, 0.25];
  const kakaoExtent = [-30000, -60000, 494288, 988576];

  // Projection 객체 생성 (proj4에 등록된 좌표계 사용)
  const kakaoProjection = new Projection({
    code: 'EPSG:5181',
    extent: kakaoExtent,
    units: 'm',
  });

  if (type === 'satellite') {
    // 카카오 항공영상
    return new TileLayer({
      source: new XYZ({
        projection: kakaoProjection,
        tileSize: 256,
        tileGrid: new TileGrid({
          origin: [kakaoExtent[0], kakaoExtent[1]],
          resolutions: kakaoResolutions,
        }),
        tileUrlFunction: (tileCoord) => {
          if (!tileCoord) return undefined;
          const z = kakaoResolutions.length - tileCoord[0];
          const x = tileCoord[1];
          const y = tileCoord[2] * -1 - 1;
          return `http://s0.maps.daum-img.net/L${z}/${y}/${x}.jpg?v=160114`;
        },
        attributions: '© Kakao',
      }),
    });
  } else {
    // 카카오 일반지도
    return new TileLayer({
      source: new XYZ({
        projection: kakaoProjection,
        tileSize: 256,
        tileGrid: new TileGrid({
          origin: [kakaoExtent[0], kakaoExtent[1]],
          resolutions: kakaoResolutions,
        }),
        tileUrlFunction: (tileCoord) => {
          if (!tileCoord) return undefined;
          const z = kakaoResolutions.length - tileCoord[0];
          const x = tileCoord[1];
          const y = tileCoord[2] * -1 - 1;
          return `http://i0.maps.daum-img.net/map/image/G03/i/2015munich/L${z}/${y}/${x}.png`;
        },
        attributions: '© Kakao',
      }),
    });
  }
}

/**
 * 구글맵 배경지도 레이어 생성
 */
export function createGoogleLayer(type: GoogleLayerType): WebGLTileLayer {
  const layerMap: Record<GoogleLayerType, string> = {
    base: 'm', // 일반지도
    satellite: 's', // 항공영상
    terrain: 't', // 지형도
  };

  const layer = layerMap[type];

  // 구글맵 URL 템플릿 사용 (OpenLayers가 자동으로 좌표 변환)
  return new WebGLTileLayer({
    source: new ImageTile({
      url: `http://mt0.google.com/vt/lyrs=${layer}&hl=en&x={x}&y={y}&z={z}`,
      attributions: '© Google',
      tileSize: 256,
      crossOrigin: 'anonymous',
    }),
    cacheSize: 256, // 타일 캐시 크기 확대 (기본 256)
  });
}

/**
 * OSM 배경지도 레이어 생성
 */
export function createOSMLayer(type: OSMLayerType): WebGLTileLayer {
  if (type === 'base') {
    // OSM 일반지도 - OSM source는 WebGLTileLayer와 호환되지 않으므로 ImageTile로 변환
    return new WebGLTileLayer({
      source: new ImageTile({
        url: 'https://{a-c}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attributions: '© OpenStreetMap',
        tileSize: 256,
      }),
      cacheSize: 256, // 타일 캐시 크기 확대 (기본 256)
    });
  } else if (type === 'satellite') {
    // OSM 항공영상 (Esri World Imagery 사용)
    return new WebGLTileLayer({
      source: new ImageTile({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attributions: '© Esri',
        tileSize: 256,
      }),
      cacheSize: 256, // 타일 캐시 크기 확대 (기본 256)
    });
  } else {
    // OSM 지형도 (OpenTopoMap 사용)
    return new WebGLTileLayer({
      source: new ImageTile({
        url: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attributions: '© OpenTopoMap',
        tileSize: 256,
      }),
      cacheSize: 256, // 타일 캐시 크기 확대 (기본 256)
    });
  }
}

/**
 * 배경지도 레이어 생성 헬퍼 함수
 */
export function createBackgroundLayer(
  provider: MapProvider,
  layerType: VWorldLayerType | KakaoLayerType | GoogleLayerType | OSMLayerType
): BaseLayer {
  switch (provider) {
    case 'vworld':
      return createVWorldLayer(layerType as VWorldLayerType) as BaseLayer;
    case 'kakao':
      return createKakaoLayer(layerType as KakaoLayerType) as BaseLayer;
    case 'google':
      return createGoogleLayer(layerType as GoogleLayerType) as BaseLayer;
    case 'osm':
      return createOSMLayer(layerType as OSMLayerType) as BaseLayer;
    default:
      return createOSMLayer('base') as BaseLayer;
  }
}

/**
 * 배경지도 ID로부터 provider 추출
 */
export function getProviderFromId(id: string): MapProvider | null {
  const parsed = parseBackgroundMapId(id);
  return parsed?.provider || null;
}

/**
 * 배경지도 ID를 provider와 layerType으로 변환
 */
export function parseBackgroundMapId(
  id: string
): { provider: MapProvider; layerType: VWorldLayerType | KakaoLayerType | GoogleLayerType | OSMLayerType } | null {
  // 자체항공영상: 현재는 VWorld 항공영상으로 매핑
  if (id.startsWith('aerial-20') || id.startsWith('high-res') || id.startsWith('fire-')) {
    return { provider: 'vworld', layerType: 'base' };
  }

  // 일반영상
  if (id === 'general-vworld') {
    return { provider: 'vworld', layerType: 'base' };
  }
  if (id === 'general-daum') {
    return { provider: 'kakao', layerType: 'base' };
  }
  if (id === 'general-google' || id === 'general-google-building') {
    return { provider: 'google', layerType: 'base' };
  }
  if (id === 'general-osm') {
    return { provider: 'osm', layerType: 'base' };
  }

  // 항공영상
  if (id === 'aerial-vworld') {
    return { provider: 'vworld', layerType: 'satellite' };
  }
  if (id === 'aerial-daum') {
    return { provider: 'kakao', layerType: 'satellite' };
  }
  if (id === 'aerial-google') {
    return { provider: 'google', layerType: 'satellite' };
  }

  // 지형도
  if (id === 'topo-google') {
    return { provider: 'google', layerType: 'terrain' };
  }
  if (id === 'topo-osm') {
    return { provider: 'osm', layerType: 'terrain' };
  }

  // 기타영상
  if (id === 'white-map') {
    return { provider: 'vworld', layerType: 'white' };
  }
  if (id === 'night-map') {
    return { provider: 'vworld', layerType: 'night' };
  }
  if (id === 'no-background') {
    return null; // 배경 없음
  }

  // 기본값
  return { provider: 'osm', layerType: 'base' };
}

/**
 * 배경지도 ID로 레이어 생성
 */
export function createBackgroundLayerById(id: string): BaseLayer | null {
  const parsed = parseBackgroundMapId(id);
  if (!parsed) {
    return null; // 배경 없음
  }
  return createBackgroundLayer(parsed.provider, parsed.layerType);
}
