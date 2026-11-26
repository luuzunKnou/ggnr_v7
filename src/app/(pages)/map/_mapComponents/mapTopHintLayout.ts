/**
 * 지도 상단 확대 안내·공간분석 안내·그리기 도구모음 세로 위치.
 * 지적(공시지가) 안내가 켜지면 아래 배너·도구모음을 한 칸 더 내린다.
 */

/** 공간분석 상단 안내 — 지적 안내 없을 때 */
export const MAP_TOP_HINT_PX = 16

/**
 * 공간분석 상단 안내 — 지적 안내 바로 아래.
 * top 72일 때 지적과의 틈이 약 30이었음 → 틈 15로 (72−15).
 */
export const MAP_TOP_HINT_BELOW_CADASTRAL_PX = 57

/** 그리기 도구모음 기본 top (tailwind top-20 = 80) */
export const MAP_TOOLBAR_TOP_PX = 80

/** 지적 안내가 있을 때 도구모음 — 안내와 같은 만큼 위로 (128−15) */
export const MAP_TOOLBAR_TOP_BELOW_CADASTRAL_PX = 113

export function mapTopHintPx(cadastralHintVisible: boolean): number {
  return cadastralHintVisible ? MAP_TOP_HINT_BELOW_CADASTRAL_PX : MAP_TOP_HINT_PX
}

export function mapToolbarTopPx(cadastralHintVisible: boolean): number {
  return cadastralHintVisible ? MAP_TOOLBAR_TOP_BELOW_CADASTRAL_PX : MAP_TOOLBAR_TOP_PX
}
