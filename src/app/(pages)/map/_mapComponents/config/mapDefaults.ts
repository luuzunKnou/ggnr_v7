import TileGrid from 'ol/tilegrid/TileGrid';

/**
 * 2D/3D 지도 공통 기본 뷰 설정 (안동 중심)
 */
export const DEFAULT_CENTER_LON = 128.7229;
export const DEFAULT_CENTER_LAT = 36.5664;
export const DEFAULT_ZOOM_2D = 10;
/** 3D 지도 초기 카메라 높이(m). 2D zoom 10과 비슷한 축척 */
export const DEFAULT_CAMERA_HEIGHT_3D = 50_000;
/** 3D 타일 고도 오프셋(m). 지형/수면에 가려질 때 위로 올려서 표시. 0이면 미적용 */
export const TILESET_HEIGHT_OFFSET_M: number = 50;
/** PNTS 포인트 클라우드 화면 픽셀 크기.b3dm 등 메시 타일에는 영향 없음 */
export const TILESET_POINT_CLOUD_POINT_SIZE = 6;
/**
 * 3D Tiles LOD — 허용 화면 공간 오차(px). 0에 가까울수록 최고 LOD(성능 무시).
 */
export const TILESET_MAX_SCREEN_SPACE_ERROR = 0;
/** 원거리·지평선에서 SSE를 완화하는 최적화(Cesium 기본 true). 최고 화질이면 false */
export const TILESET_DYNAMIC_SCREEN_SPACE_ERROR = false;
/** 화면 가장자리 타일을 나중에·거칠게 로드하는 최적화(Cesium 기본 true). 최고 화질이면 false */
export const TILESET_FOVEATED_SCREEN_SPACE_ERROR = false;
/** GPU 타일 캐시 바이트(기본 512MB). 고해상 타일이 캐시에서 덜 밀리도록 여유 */
export const TILESET_CACHE_BYTES = 2 * 1024 * 1024 * 1024;
/** cacheBytes 초과 시 허용 추가 여유 바이트(기본 512MB) */
export const TILESET_MAX_CACHE_OVERFLOW_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * 목록·도형 선택 등으로 지도를 자동 이동·줌할 때 허용할 최대 줌 인덱스(0부터).
 * 배경 타일·VWorld 한도와 맞추기 위해 19로 고정.
 */
export const MAP_AUTO_NAV_MAX_ZOOM = 19;

/**
 * EPSG:3857 표준 웹메르카터 해상도 (zoom 0 = 256px 타일 기준).
 * OpenLayers View, TileWMS, VWorld 등이 동일한 줌/해상도 체계를 쓰도록 통일.
 */
const WEB_MERCATOR_MAX = 156543.03392804097;
export const RESOLUTIONS_3857: number[] = [];
for (let z = 0; z <= 20; z++) {
  RESOLUTIONS_3857[z] = WEB_MERCATOR_MAX / Math.pow(2, z);
}

/** EPSG:3857 표준 extent (미터) */
const EXTENT_3857 = [-20037508.34, -20037508.34, 20037508.34, 20037508.34];

/**
 * GeoServer TileWMS 등에서 사용할 EPSG:3857 공통 TileGrid.
 * View의 resolutions와 동일해 줌 시 WMS·배경 타일이 같은 해상도로 요청됨.
 */
export function getTileGrid3857(): TileGrid {
  return new TileGrid({
    extent: EXTENT_3857,
    origin: [EXTENT_3857[0], EXTENT_3857[1]],
    resolutions: RESOLUTIONS_3857,
  });
}
