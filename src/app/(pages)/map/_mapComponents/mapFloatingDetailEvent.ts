/**
 * 지도에 떠 있는 상세 플로팅(민원·메모·관망조회 최소화 바 등)을 닫으라는 알림.
 * 도형편집기·사이드바 메뉴 전환처럼 현재 업무 route를 벗어날 때 사용.
 */
export const MAP_FLOATING_DETAIL_CLOSE_EVENT = 'ggnr-map-floating-detail-close';

export function requestCloseMapFloatingDetail(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(MAP_FLOATING_DETAIL_CLOSE_EVENT));
}
