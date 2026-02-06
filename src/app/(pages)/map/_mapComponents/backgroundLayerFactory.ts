/**
 * MapLibre 배경지도 팩토리
 * 참조: layer 속성관리 완료 프로젝트의 backgroundLayerFactory (OpenLayers 버전)
 * - id → provider/layerType 파싱 및 MapLibre raster 소스 스펙 반환
 */

export type MapProvider = 'vworld' | 'google' | 'osm';

export type VWorldLayerType = 'base' | 'satellite' | 'white' | 'night';
export type GoogleLayerType = 'base' | 'satellite' | 'terrain';
export type OSMLayerType = 'base' | 'satellite' | 'terrain' | 'cyclosm' | 'hot';

export type BackgroundLayerSpec = {
  type: 'raster';
  tiles: string[];
  tileSize: number;
  attribution?: string;
  minzoom?: number;
  maxzoom?: number;
};

type LayerType = VWorldLayerType | GoogleLayerType | OSMLayerType;

/** 배경지도 ID를 provider와 layerType으로 변환 */
export function parseBackgroundMapId(
  id: string
): { provider: MapProvider; layerType: LayerType } | null {
  if (id === 'no-background') return null;

  // 국토정보지리원 : VWorld 항공영상으로 매핑
  if (id.startsWith('aerial-20') || id.startsWith('high-res') || id.startsWith('fire-')) {
    return { provider: 'vworld', layerType: 'satellite' };
  }

  if (id === 'general-vworld') return { provider: 'vworld', layerType: 'base' };
  if (id === 'general-google' || id === 'general-google-building') return { provider: 'google', layerType: 'base' };
  if (id === 'general-osm') return { provider: 'osm', layerType: 'base' };
  if (id === 'general-osm-hot') return { provider: 'osm', layerType: 'hot' };

  if (id === 'aerial-vworld') return { provider: 'vworld', layerType: 'satellite' };
  if (id === 'aerial-google') return { provider: 'google', layerType: 'satellite' };
  if (id === 'aerial-osm') return { provider: 'osm', layerType: 'satellite' };

  if (id === 'topo-google') return { provider: 'google', layerType: 'terrain' };
  if (id === 'topo-osm') return { provider: 'osm', layerType: 'cyclosm' };

  if (id === 'white-map') return { provider: 'vworld', layerType: 'white' };
  if (id === 'night-map') return { provider: 'vworld', layerType: 'night' };

  return { provider: 'osm', layerType: 'base' };
}

export function getProviderFromId(id: string): MapProvider | null {
  const parsed = parseBackgroundMapId(id);
  return parsed?.provider ?? null;
}

// ─── VWorld (xdworld, API 키 불필요) ───
const VWORLD_LAYER: Record<VWorldLayerType, { path: string; ext: string }> = {
  base: { path: 'Base', ext: 'png' },
  satellite: { path: 'Satellite', ext: 'jpeg' },
  white: { path: 'white', ext: 'png' },
  night: { path: 'midnight', ext: 'png' },
};

function getVWorldSpec(type: VWorldLayerType): BackgroundLayerSpec {
  const { path, ext } = VWORLD_LAYER[type];
  return {
    type: 'raster',
    tiles: [`https://xdworld.vworld.kr/2d/${path}/service/{z}/{x}/{y}.${ext}`],
    tileSize: 256,
    attribution: '© VWorld',
    minzoom: 0,
    maxzoom: 19,
  };
}

// ─── 구글 ───
const GOOGLE_LAYER: Record<GoogleLayerType, string> = {
  base: 'm',
  satellite: 's',
  terrain: 'p', // p = terrain with roads (t는 미지원/차단 시 검은 타일)
};

const GOOGLE_TILE_SUBDOMAINS = ['mt0', 'mt1', 'mt2', 'mt3'];

function getGoogleSpec(type: GoogleLayerType): BackgroundLayerSpec {
  const lyrs = GOOGLE_LAYER[type];
  const tiles = GOOGLE_TILE_SUBDOMAINS.map(
    (sub) => `https://${sub}.google.com/vt/lyrs=${lyrs}&hl=en&x={x}&y={y}&z={z}`
  );
  return {
    type: 'raster',
    tiles,
    tileSize: 256,
    attribution: '© Google',
    minzoom: 0,
    maxzoom: 20,
  };
}

// ─── OSM ───
function getOSMSpec(type: OSMLayerType): BackgroundLayerSpec {
  if (type === 'base') {
    return {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      minzoom: 0,
      maxzoom: 19,
    };
  }
  if (type === 'satellite') {
    return {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '© Esri',
      minzoom: 0,
      maxzoom: 19,
    };
  }
  if (type === 'cyclosm') {
    return {
      type: 'raster',
      tiles: [
        'https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© CyclOSM © OpenStreetMap contributors',
      minzoom: 0,
      maxzoom: 19,
    };
  }
  if (type === 'hot') {
    return {
      type: 'raster',
      tiles: [
        'https://tile-a.openstreetmap.fr/hot/{z}/{x}/{y}.png',
        'https://tile-b.openstreetmap.fr/hot/{z}/{x}/{y}.png',
        'https://tile-c.openstreetmap.fr/hot/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© Humanitarian OSM Team © OpenStreetMap contributors',
      minzoom: 0,
      maxzoom: 19,
    };
  }
  // terrain: Stadia Outdoors (등고선·hillshade)
  return {
    type: 'raster',
    tiles: ['https://tiles.stadiamaps.com/tiles/outdoors/{z}/{x}/{y}.png'],
    tileSize: 256,
    attribution: '© Stadia Maps © OpenStreetMap contributors',
    minzoom: 0,
    maxzoom: 19,
  };
}

function createSpec(provider: MapProvider, layerType: LayerType): BackgroundLayerSpec {
  switch (provider) {
    case 'vworld':
      return getVWorldSpec(layerType as VWorldLayerType);
    case 'google':
      return getGoogleSpec(layerType as GoogleLayerType);
    case 'osm':
      return getOSMSpec(layerType as OSMLayerType);
    default:
      return getOSMSpec('base');
  }
}

/** 배경지도 ID로 MapLibre raster 소스 스펙 반환. no-background 또는 미지원 시 null */
export function getBackgroundLayerSpecById(id: string): BackgroundLayerSpec | null {
  const parsed = parseBackgroundMapId(id);
  if (!parsed) return null;
  return createSpec(parsed.provider, parsed.layerType);
}
