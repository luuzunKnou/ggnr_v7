/**
 * 점용(울진·공통) 레이어 색.
 * - parent/facility/parcel/mgj: 울진 usage_data_as* WMS와 동일
 * - useFee: water_ngl_fee_list WMS(#2196F3)
 * - 부서업무 공통점용 WMS도 같은 스타일명(usage_data_as*) 재사용
 * - 데이터조회 공통점용 기본 스타일(테이블명 CSS)은 하천·도로·국공유지 × 본표·필지·물건지가 서로 구분되는 색
 * - parentActive: 목록 선택·도형 수정 시 벡터 강조(기존 빨간 표시)
 */
export const OCCUPATION_LAYER_STYLE = {
  /** 점용대장 WMS */
  parent: {
    fill: "#68CCCA",
    stroke: "#FFFFFF",
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
  /** 점사용료 (water_ngl_fee_list 등) */
  useFee: {
    fill: "#2196F3",
    stroke: "#FFFFFF",
    fillOpacity: 0.3,
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

/** 목록 레이어 on/off 버튼 — 켜짐 시 WMS fill 색 */
export type OccupationLayerToggleStyleKey = "parent" | "facility" | "useFee";

function hexLuminance(hex: string): number {
  const h = hex.replace("#", "");
  if (h.length !== 6) return 0.5;
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** 레이어 토글 켜짐 스타일 (면 색 기준). */
export function occupationLayerToggleActiveFromFill(
  fill: string,
  stroke: string = "#FFFFFF"
): { backgroundColor: string; borderColor: string; color: string } {
  const border = stroke.toUpperCase() === "#FFFFFF" ? fill : stroke;
  const color = hexLuminance(fill) > 0.55 ? "#1e293b" : "#ffffff";
  return {
    backgroundColor: fill,
    borderColor: border,
    color,
  };
}

/**
 * 레이어 토글 버튼 활성 스타일 (WMS fill·stroke 기준).
 */
export function occupationLayerToggleActiveStyle(
  key: OccupationLayerToggleStyleKey
): { backgroundColor: string; borderColor: string; color: string } {
  const s = OCCUPATION_LAYER_STYLE[key];
  return occupationLayerToggleActiveFromFill(s.fill, s.stroke);
}

export function occupationFillRgba(
  key: OccupationLayerStyleKey,
  opacity: number = OCCUPATION_LAYER_STYLE[key].fillOpacity
): string {
  const alpha = opacity ?? OCCUPATION_LAYER_STYLE[key].fillOpacity;
  const hex = OCCUPATION_LAYER_STYLE[key].fill.replace("#", "");
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function occupationStrokeRgba(
  key: OccupationLayerStyleKey,
  opacity: number = 0.95
): string {
  const hex = OCCUPATION_LAYER_STYLE[key].stroke.replace("#", "");
  if (hex.length !== 6) return OCCUPATION_LAYER_STYLE[key].stroke;
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
