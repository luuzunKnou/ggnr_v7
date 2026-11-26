/** 긴 동기 작업 사이마다 이벤트 루프에 양보 — 지도 팬·줌이 멈추지 않게 */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}
