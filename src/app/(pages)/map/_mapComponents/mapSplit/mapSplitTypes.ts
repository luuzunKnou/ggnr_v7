/** 보조 칸에 올릴 기능. null이면 분할 OFF(주 칸 전체) */
export type MapSplitSecondaryKind = 'streetView' | 'map' | 'panorama' | null;

export type MapSplitOrientation = 'horizontal' | 'vertical';

/** 좌우 분할: 패널 없을 때 기본값(측정 전 fallback) */
export const MAP_SPLIT_DEFAULT_PRIMARY_RATIO = 0.5;
/** 상하 분할 기본 1:1 */
export const MAP_SPLIT_VERTICAL_PRIMARY_RATIO = 0.5;
export const MAP_SPLIT_MIN_RATIO = 0.2;
export const MAP_SPLIT_MAX_RATIO = 0.85;
export const MAP_SPLIT_ANIM_MS = 320;
/** 분할선 컨트롤 pill 위치 (0~1, 양끝 여백 — 버튼 1개 기준 fallback) */
export const MAP_SPLIT_CONTROL_OFFSET_MIN = 0.04;
export const MAP_SPLIT_CONTROL_OFFSET_MAX = 0.96;
/** 상하 분할 시 우측 지도 메뉴 열(45px) + right-4(16px) — pill이 넘지 않도록 */
export const MAP_SPLIT_CONTROL_RIGHT_MENU_RESERVE_PX = 61;
/** 접힘 상태에서 기준 최대치보다 추가 허용할 우측 이동(px) */
export const MAP_SPLIT_CONTROL_RIGHT_EXTEND_PX = 100;
/** 버튼 1개 크기(px) — h-6 w-6 */
export const MAP_SPLIT_CONTROL_BTN_PX = 24;
/** 버튼 간격(px) — gap-1 */
export const MAP_SPLIT_CONTROL_BTN_GAP_PX = 4;
/** pill 반폭(접힘) */
export const MAP_SPLIT_CONTROL_PILL_HALF_PX = 14;
/** pill 반폭(펼침, 버튼 3~4개) — 우측 clamp fallback */
export const MAP_SPLIT_CONTROL_PILL_HALF_EXPANDED_PX = 58;
/** pill 전폭(펼침) — 좌측 앵커 시 우측 확장 여유 fallback */
export const MAP_SPLIT_CONTROL_PILL_EXPANDED_WIDTH_PX =
  MAP_SPLIT_CONTROL_PILL_HALF_EXPANDED_PX * 2;
/** 상하 분할 시 컨트롤 비율 상한 (전역 offset 상한과 동일) */
export const MAP_SPLIT_CONTROL_VERTICAL_MAX_RATIO = MAP_SPLIT_CONTROL_OFFSET_MAX;
/** 한계 도달 진동(ms) */
export const MAP_SPLIT_CONTROL_EDGE_SHAKE_MS = 180;
