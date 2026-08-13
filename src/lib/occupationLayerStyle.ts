/**
 * 점용(울진·공통) 레이어 색.
 * - parent/facility/parcel/mgj: 울진 usage_data_as* WMS와 동일
 * - 부서업무 공통점용 WMS도 같은 스타일명(usage_data_as*) 재사용
 * - 데이터조회 공통점용 기본 SLD(테이블명)는 기존 팔레트 유지
 * - parentActive: 목록 선택·도형 수정 시 벡터 강조(기존 빨간 표시)
 */
export const OCCUPATION_LAYER_STYLE = {
  /** 점용대장 WMS */
  parent: {
    fill: "#68CCCA",
    stroke: "#3BA8A6",
    fillOpacity: 0.35,
  },
  /** 점용대장 선택·도형수정 강조 (기존 빨강) */
  parentActive: {
    fill: "#EF4444",
    stroke: "#EF4444",
    fillOpacity: 0.12,
  },
  /** 점용시설물 (울진) */
  facility: {
    fill: "#FBBA00",
    stroke: "#FBBA00",
    fillOpacity: 0.35,
  },
  /** 필지 */
  parcel: {
    fill: "#1D4ED8",
    stroke: "#FFFFFF",
    fillOpacity: 0.35,
  },
  /** 물건지 */
  mgj: {
    fill: "#EF4444",
    stroke: "#FFFFFF",
    fillOpacity: 0.35,
  },
} as const;

export type OccupationLayerStyleKey = keyof typeof OCCUPATION_LAYER_STYLE;

export function occupationFillRgba(
  key: OccupationLayerStyleKey,
  opacity: number = OCCUPATION_LAYER_STYLE[key].fillOpacity
): string {
  const hex = OCCUPATION_LAYER_STYLE[key].fill.replace("#", "");
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export function occupationStrokeRgba(
  key: OccupationLayerStyleKey,
  opacity = 0.95
): string {
  const hex = OCCUPATION_LAYER_STYLE[key].stroke.replace("#", "");
  if (hex.length !== 6) return OCCUPATION_LAYER_STYLE[key].stroke;
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
