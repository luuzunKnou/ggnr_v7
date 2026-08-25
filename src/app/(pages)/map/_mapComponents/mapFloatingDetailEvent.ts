/** 지도에 떠 있는 민원·메모 화면을 닫으라는 알림 (도형편집기처럼 지도 밖으로 나가는 기능에서 사용) */
export const MAP_FLOATING_DETAIL_CLOSE_EVENT = 'ggnr-map-floating-detail-close';

export function requestCloseMapFloatingDetail(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(MAP_FLOATING_DETAIL_CLOSE_EVENT));
}
