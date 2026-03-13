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
  
  return new WebGLTileLayer({
    source: new ImageTile({
      loader: (z, x, y) => {
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
    cacheSize: 256,
  });
}

/**
 * 카카오맵 배경지도 레이어 생성
 * EPSG:5181 좌표계 사용
 */
export function createKakaoLayer(type: KakaoLayerType): TileLayer<XYZ> {
  const kakaoResolutions = [2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1, 0.5, 0.25];
  const kakaoExtent = [-30000, -60000, 494288, 988576];

  const kakaoProjection = new Projection({
    code: 'EPSG:5181',
    extent: kakaoExtent,
    units: 'm',
  });

  if (type === 'satellite') {
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
    base: 'm',
    satellite: 's',
    terrain: 't',
  };

  const layer = layerMap[type];

  return new WebGLTileLayer({
    source: new ImageTile({
      url: `http://mt0.google.com/vt/lyrs=${layer}&hl=en&x={x}&y={y}&z={z}`,
      attributions: '© Google',
      tileSize: 256,
      crossOrigin: 'anonymous',
    }),
    cacheSize: 256,
  });
}

/**
 * OSM 배경지도 레이어 생성
 */
export function createOSMLayer(type: OSMLayerType): WebGLTileLayer {
  if (type === 'base') {
    return new WebGLTileLayer({
      source: new ImageTile({
        url: 'https://{a-c}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attributions: '© OpenStreetMap',
        tileSize: 256,
      }),
      cacheSize: 256,
    });
  } else if (type === 'satellite') {
    return new WebGLTileLayer({
      source: new ImageTile({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attributions: '© Esri',
        tileSize: 256,
      }),
      cacheSize: 256,
    });
  } else {
    return new WebGLTileLayer({
      source: new ImageTile({
        url: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attributions: '© OpenTopoMap',
        tileSize: 256,
      }),
      cacheSize: 256,
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
  if (id.startsWith('aerial-20') || id.startsWith('high-res') || id.startsWith('fire-')) {
    return { provider: 'vworld', layerType: 'base' };
  }

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

  if (id === 'aerial-vworld') {
    return { provider: 'vworld', layerType: 'satellite' };
  }
  if (id === 'aerial-daum') {
    return { provider: 'kakao', layerType: 'satellite' };
  }
  if (id === 'aerial-google') {
    return { provider: 'google', layerType: 'satellite' };
  }

  if (id === 'topo-google') {
    return { provider: 'google', layerType: 'terrain' };
  }
  if (id === 'topo-osm') {
    return { provider: 'osm', layerType: 'terrain' };
  }

  if (id === 'white-map') {
    return { provider: 'vworld', layerType: 'white' };
  }
  if (id === 'night-map') {
    return { provider: 'vworld', layerType: 'night' };
  }
  if (id === 'no-background') {
    return null;
  }

  return { provider: 'osm', layerType: 'base' };
}

/**
 * 배경지도 ID로 레이어 생성
 */
export function createBackgroundLayerById(id: string): BaseLayer | null {
  const parsed = parseBackgroundMapId(id);
  if (!parsed) {
    return null;
  }
  return createBackgroundLayer(parsed.provider, parsed.layerType);
}
