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
