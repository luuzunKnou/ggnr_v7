/** 지도 우측 «수치지형도» */

export const DIGITAL_MAP_CONTROL_ID = 'digital-map';

/**
 * 이 줌 이하(포함)는 도엽 테두리만, 그 위는 도면.
 * z14 = 축척 막대 960m, z15 = 480m
 * (서버 PMTiles 의 도엽 테두리·도면 레이어 구간과 같은 값 — digitalMapPmtilesBuild.ts)
 */
export const DIGITAL_MAP_OUTLINE_MAX_ZOOM = 14;

/** PMTiles 안의 도엽 테두리 레이어 이름 (digitalMapPmtilesBuild.ts 와 동일) */
export const DIGITAL_MAP_FRAME_LAYER = 'frame';

/** 도엽 테두리 — 검은 실선 */
export const DIGITAL_MAP_FOOTPRINT_STROKE = '#000000';
export const DIGITAL_MAP_FOOTPRINT_WIDTH = 1.2;
