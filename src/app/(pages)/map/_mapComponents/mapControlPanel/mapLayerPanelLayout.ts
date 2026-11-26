/** 우측 맵 컨트롤 top(60px) + 화면 하단 여백(10px) */
export const MAP_LAYER_PANEL_MAX_H_CLASS = 'max-h-[calc(100vh-70px)]';

/** 확장 패널 표면 — 우측 메뉴 버튼과 동일 opacity(standard-map-float-surface) */
export const MAP_LAYER_PANEL_SURFACE_CLASS = 'standard-map-float-surface'

/** 슈퍼유저: 호버 title에 한글·영문 테이블명 병기 (관망도 dualTitle과 동일) */
export function layerHoverTitle(
  korName: string,
  tableName: string,
  showEng: boolean
): string {
  const primary = String(korName ?? '').trim();
  const eng = String(tableName ?? '').trim();
  if (!showEng) return primary || eng;
  if (primary && eng && primary.toLowerCase() !== eng.toLowerCase()) {
    return `${primary} (${eng})`;
  }
  return primary || eng;
}
