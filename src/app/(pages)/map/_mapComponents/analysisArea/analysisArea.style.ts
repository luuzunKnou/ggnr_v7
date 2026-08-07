import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';

/** 메인 지도 분석 영역 강조색 (확정·그리기·행정경계 공통) */
export const ANALYSIS_AREA_BLUE = '37, 99, 235';

function areaBlueRgba(alpha: number): string {
  return `rgba(${ANALYSIS_AREA_BLUE}, ${alpha})`;
}

/** 확정 분석 영역 — 실선 + 반투명 채움 */
export const ANALYSIS_AREA_STYLE = new Style({
  stroke: new Stroke({ color: areaBlueRgba(1), width: 2.5 }),
  fill: new Fill({ color: areaBlueRgba(0.18) }),
});

/** 도형 그리기 중 — 확정과 동일 + 꼭짓점 */
export const ANALYSIS_DRAW_STYLE = new Style({
  stroke: new Stroke({ color: areaBlueRgba(1), width: 2.5 }),
  fill: new Fill({ color: areaBlueRgba(0.18) }),
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: areaBlueRgba(1) }),
    stroke: new Stroke({ color: '#fff', width: 1.5 }),
  }),
});

/** 시군구 참고 경계 — 점선 + 연한 채움 */
export const ANALYSIS_SIGUNGU_BOUNDARY_STYLE = new Style({
  stroke: new Stroke({ color: areaBlueRgba(0.9), width: 2.5, lineDash: [6, 4] }),
  fill: new Fill({ color: areaBlueRgba(0.05) }),
});

/** 필지분석 경로 호환 별칭 */
export const PARCEL_ANALYSIS_AREA_BLUE = ANALYSIS_AREA_BLUE;
export const PARCEL_ANALYSIS_AREA_STYLE = ANALYSIS_AREA_STYLE;
export const PARCEL_ANALYSIS_DRAW_STYLE = ANALYSIS_DRAW_STYLE;
export const PARCEL_ANALYSIS_SIGUNGU_BOUNDARY_STYLE = ANALYSIS_SIGUNGU_BOUNDARY_STYLE;
