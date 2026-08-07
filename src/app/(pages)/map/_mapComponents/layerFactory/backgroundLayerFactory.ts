import WebGLTileLayer from 'ol/layer/WebGLTile';
import TileLayer from 'ol/layer/Tile';
import BaseLayer from 'ol/layer/Base';
import ImageTile from 'ol/source/ImageTile';
import XYZ from 'ol/source/XYZ';
import Projection from 'ol/proj/Projection';
import { get as getProjection } from 'ol/proj';
import TileGrid from 'ol/tilegrid/TileGrid';

// 배경지도 제공업체 타입
export type MapProvider = 'vworld' | 'kakao' | 'google' | 'osm' | 'ortho2d';

/** 자체 정사영상 XYZ 타일(`/api/2dtiles/{id}/…`) — backgroundMapSelector 자체항공영상 옵션 id와 동일 */
export const LOCAL_ORTHO_BACKGROUND_IDS = [
  'aerial-2017',
  'aerial-2021',
  'aerial-2022',
  'high-res-2024',
  'fire-nir',
  'fire-ortho',
  'fire-drone',
] as const;

export const LOCAL_ORTHO_BG_ID_SET = new Set<string>(LOCAL_ORTHO_BACKGROUND_IDS);

/**
 * 동적 자체항공영상 id 규칙:
 *   satellite_YYYY
 *   satellite_YYYY_표시명
 *   satellite_YYYY_CRS_표시명   (예: satellite_2022_5187_산불영상)
 */
const DYNAMIC_ORTHO_ID_RE = /^satellite_\d{4}(?:_.+)?$/i;

export function isLocalOrthoBackgroundId(id: string): boolean {
  return LOCAL_ORTHO_BG_ID_SET.has(id as (typeof LOCAL_ORTHO_BACKGROUND_IDS)[number]) || DYNAMIC_ORTHO_ID_RE.test(id);
}

/** 동적 ID(satellite_YYYY[_표시명])는 디스크 그룹 폴더명과 동일 — 즉시 4세그먼트 URL로 매핑 가능 */
export function isDynamicOrthoBackgroundId(id: string): boolean {
  return DYNAMIC_ORTHO_ID_RE.test(id);
}

// VWorld 레이어 타입
export type VWorldLayerType = 'base' | 'satellite' | 'white' | 'night';

// 카카오맵 레이어 타입
export type KakaoLayerType = 'base' | 'satellite';

// 구글 레이어 타입
export type GoogleLayerType = 'base' | 'satellite' | 'terrain';

// OSM 레이어 타입
export type OSMLayerType = 'base' | 'satellite' | 'terrain';

/** VWorld 2D 타일 API 최대 줌 인덱스(0부터). 로컬 정사·타일 소스 maxZoom 과 동일하게 맞춤. */
export const VWORLD_MAX_ZOOM_INDEX = 19;

/** tileSetId → 그룹 폴더 매핑 (브라우저). 변환 완료 시 정사영상관리 패널에서 갱신 */
export const ORTHO_TILESET_GROUP_LS_KEY = 'ggnr_ortho_tileset_group';

/** tileSetId(UI) → 디스크 타일 루트 폴더명(outputSlug). 레거시 호환용으로만 유지 */
export const ORTHO_TILESET_OUTPUT_SLUG_LS_KEY = 'ggnr_ortho_tileset_output_slug';

/**
 * 2D XYZ / Cesium UrlTemplate 공통 — `/api/2dtiles/.../{z}/{x}/{y}.jpg`
 * - `groupName` 있음: `/api/2dtiles/{group}/{z}/{x}/{y}.jpg`
 * - `groupName` 빈 문자열: 레거시 `/api/2dtiles/{tileSetId}/{z}/{x}/{y}.jpg`
 */
export function buildLocalOrthoXyzUrlTemplate(
  tileSetId: string,
  groupName?: string | null,
  outputSlug?: string | null
): string {
  const pathSeg = outputSlug != null && String(outputSlug).trim().length > 0 ? String(outputSlug).trim() : tileSetId;
  const encId = encodeURIComponent(pathSeg);
  return groupName != null && String(groupName).length > 0
    ? `/api/2dtiles/${encodeURIComponent(String(groupName))}/{z}/{x}/{y}.jpg`
    : `/api/2dtiles/${encId}/{z}/{x}/{y}.jpg`;
}

/**
 * 로컬 tiles_jpg 배경(항상 JPEG raster 타일).
 */
export function createLocalOrthoTileLayer(
  tileSetId: string,
  groupName?: string | null,
  outputSlug?: string | null,
  sourceProjectionCode?: string | null
): TileLayer<XYZ> {
  const url = buildLocalOrthoXyzUrlTemplate(tileSetId, groupName, outputSlug);
  return new TileLayer({
    source: new XYZ({
      url,
      projection: sourceProjectionCode ? (getProjection(sourceProjectionCode) ?? undefined) : undefined,
      maxZoom: VWORLD_MAX_ZOOM_INDEX,
      crossOrigin: 'anonymous',
      tileSize: 512,
      wrapX: false,
      attributions: '© local orthophoto',
    }),
  });
}

/**
 * VWorld 배경지도 레이어 생성
 */
export function createVWorldLayer(type: VWorldLayerType): WebGLTileLayer {
  const layerMap: Record<VWorldLayerType, { path: string; ext: string }> = {
    base: { path: 'Base', ext: 'png' }, // 일반지도
    satellite: { path: 'Satellite', ext: 'jpeg' }, // 항공영상
    white: { path: 'white', ext: 'png' }, // 백색지도
    night: { path: 'midnight', ext: 'png' }, // 야간지도
  };

  const layerInfo = layerMap[type];

  return new WebGLTileLayer({
    source: new ImageTile({
      /** 줌 19까지만 타일 요청. 뷰가 그보다 크면 동일 타일을 확대만(재요청 없음). */
      maxZoom: VWORLD_MAX_ZOOM_INDEX,
      loader: (z, x, y) => {
        const url = `https://xdworld.vworld.kr/2d/${layerInfo.path}/service/${z}/${x}/${y}.${layerInfo.ext}`;
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
    /** 지형만(t)은 너무 어두움 → 지형+라벨(p) */
    terrain: 'p',
  };

  const layer = layerMap[type];

  return new WebGLTileLayer({
    source: new ImageTile({
      url: `https://mt0.google.com/vt/lyrs=${layer}&hl=en&x={x}&y={y}&z={z}`,
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
    case 'ortho2d':
      throw new Error('ortho2d 배경은 createBackgroundLayerById 경로로만 생성합니다.');
    default:
      return createOSMLayer('base') as BaseLayer;
  }
}

/**
 * 배경지도 ID로부터 provider 추출
 */
export function getProviderFromId(id: string): MapProvider | null {
  if (id === 'no-background') return null;
  if (isLocalOrthoBackgroundId(id)) return 'ortho2d';
  const parsed = parseBackgroundMapId(id);
  return parsed?.provider || null;
}

/**
 * 배경지도 ID를 provider와 layerType으로 변환
 */
export function parseBackgroundMapId(
  id: string
): { provider: MapProvider; layerType: VWorldLayerType | KakaoLayerType | GoogleLayerType | OSMLayerType } | null {
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
  if (isLocalOrthoBackgroundId(id)) {
    return null;
  }

  return { provider: 'osm', layerType: 'base' };
}

/** Cesium UrlTemplateImageryProvider(WebMercator)와 동일 규칙의 XYZ 타일 스펙 */
export type CesiumRasterBasemapSpec = {
  kind: 'xyzTemplate';
  url: string;
  tileWidth: number;
  tileHeight: number;
  maximumLevel: number;
  credit?: string;
  /** `{s}` 플레이스홀더용 — 미주입 시 Cesium 기본(`abc`)과 호환되는 OSM 스타일 URL은 단일 호스트 사용 권장 */
  subdomains?: string | string[];
};

/**
 * 배경지도 id → Cesium 하단 래스터 규칙 (2D parseBackgroundMapId / 타일 URL 과 동일 계열).
 * - null 반환: 자체정사(ortho는 별도 경로), 카카오(EPSG:5181), 배경없음·Ion 폴백 등
 */
export function getCesiumRasterBasemapSpecForId(id: string): CesiumRasterBasemapSpec | null {
  if (id === 'no-background' || isLocalOrthoBackgroundId(id)) {
    return null;
  }

  const parsed = parseBackgroundMapId(id);
  if (!parsed) {
    return null;
  }

  if (parsed.provider === 'kakao') {
    return null;
  }

  const { provider, layerType } = parsed;

  if (provider === 'vworld') {
    const layerMap: Record<VWorldLayerType, { path: string; ext: string }> = {
      base: { path: 'Base', ext: 'png' },
      satellite: { path: 'Satellite', ext: 'jpeg' },
      white: { path: 'white', ext: 'png' },
      night: { path: 'midnight', ext: 'png' },
    };
    const info = layerMap[layerType as VWorldLayerType];
    return {
      kind: 'xyzTemplate',
      url: `https://xdworld.vworld.kr/2d/${info.path}/service/{z}/{x}/{y}.${info.ext}`,
      tileWidth: 256,
      tileHeight: 256,
      maximumLevel: VWORLD_MAX_ZOOM_INDEX,
      credit: '© VWorld',
    };
  }

  if (provider === 'google') {
    const layerMap: Record<GoogleLayerType, string> = {
      base: 'm',
      satellite: 's',
      terrain: 'p',
    };
    const lyrs = layerMap[layerType as GoogleLayerType];
    return {
      kind: 'xyzTemplate',
      url: `https://mt0.google.com/vt/lyrs=${lyrs}&hl=en&x={x}&y={y}&z={z}`,
      tileWidth: 256,
      tileHeight: 256,
      maximumLevel: 21,
      credit: '© Google',
    };
  }

  if (provider === 'osm') {
    if (layerType === 'base') {
      return {
        kind: 'xyzTemplate',
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        tileWidth: 256,
        tileHeight: 256,
        maximumLevel: VWORLD_MAX_ZOOM_INDEX,
        credit: '© OpenStreetMap',
        subdomains: 'abc',
      };
    }
    if (layerType === 'satellite') {
      return {
        kind: 'xyzTemplate',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        tileWidth: 256,
        tileHeight: 256,
        maximumLevel: 19,
        credit: '© Esri World Imagery',
      };
    }
    return {
      kind: 'xyzTemplate',
      url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      tileWidth: 256,
      tileHeight: 256,
      maximumLevel: VWORLD_MAX_ZOOM_INDEX,
      credit: '© OpenTopoMap',
      subdomains: 'abc',
    };
  }

  return null;
}

/** 배경지도 ID로 레이어 생성 (OpenLayers) */
export function createBackgroundLayerById(id: string): BaseLayer | null {
  if (id === 'no-background') {
    return null;
  }
  if (isLocalOrthoBackgroundId(id)) {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(ORTHO_TILESET_GROUP_LS_KEY);
      if (!raw) return null;
      const m = JSON.parse(raw) as Record<string, string>;
      if (Object.prototype.hasOwnProperty.call(m, id)) {
        let outputSlug: string | undefined;
        try {
          const os = window.localStorage.getItem(ORTHO_TILESET_OUTPUT_SLUG_LS_KEY);
          if (os) {
            const om = JSON.parse(os) as Record<string, string>;
            if (Object.prototype.hasOwnProperty.call(om, id) && om[id]) outputSlug = om[id];
          }
        } catch {
          /* ignore */
        }
        return createLocalOrthoTileLayer(id, m[id], outputSlug) as BaseLayer;
      }
    } catch {
      /* ignore */
    }
    return null;
  }
  const parsed = parseBackgroundMapId(id);
  if (!parsed) {
    return null;
  }
  return createBackgroundLayer(parsed.provider, parsed.layerType);
}
