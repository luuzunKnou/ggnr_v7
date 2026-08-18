/** 브라우저에서 401이면 로그인 모달을 열기 위한 이벤트 */
export const AUTH_REQUIRED_EVENT = 'ggnr-auth-required';

export function notifyAuthRequired(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
}
