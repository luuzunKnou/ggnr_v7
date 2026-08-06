import { FLOAT_PANEL_BELOW_SEARCH_TOP_EXTRA } from '@/app/(pages)/map/searchBarOffsetContext';

/** 주변 도로 단독 기준 top */
export function safetyWaterFloatBaseTop(searchTopPx: number) {
  return searchTopPx + FLOAT_PANEL_BELOW_SEARCH_TOP_EXTRA + 48;
}

/** 홍수 예보 — 공통 기준보다 위 */
export function safetyWaterForecastFloatTop(searchTopPx: number) {
  return searchTopPx + FLOAT_PANEL_BELOW_SEARCH_TOP_EXTRA + 8;
}

/** 홍수 예보 패널 아래 ↔ 주변 도로 간격 */
export const FORECAST_TO_CCTV_GAP_PX = 12;

/** 높이 미측정 시 폴백 (예보 모달 — 목록 1건 펼침 기준) */
export const FORECAST_HEIGHT_FALLBACK_PX = 380;
