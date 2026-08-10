/**
 * 포인터가 맵 viewport 안에 있는지 document pointermove로 추적.
 * 분할선·형제 맵으로 넘어갈 때 pointerleave가 안 뜨는 경우도 잡는다.
 */
export function bindMapViewportPointerPresence(
  map: { getViewport(): HTMLElement },
  handlers: { onEnter?: () => void; onLeave?: () => void }
): () => void {
  const viewport = map.getViewport();
  let over = false;

  const setOver = (next: boolean) => {
    if (next === over) return;
    over = next;
    if (next) handlers.onEnter?.();
    else handlers.onLeave?.();
  };

  const hitTest = (clientX: number, clientY: number) => {
    const rect = viewport.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      setOver(false);
      return;
    }
    const inside =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;
    setOver(inside);
  };

  const onPointerMove = (e: PointerEvent) => {
    hitTest(e.clientX, e.clientY);
  };

  const onLeaveViewport = () => {
    setOver(false);
  };

  document.addEventListener('pointermove', onPointerMove, { passive: true });
  // 창 밖으로 나갈 때
  window.addEventListener('blur', onLeaveViewport);
  viewport.addEventListener('pointerleave', onLeaveViewport);

  return () => {
    document.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('blur', onLeaveViewport);
    viewport.removeEventListener('pointerleave', onLeaveViewport);
    if (over) handlers.onLeave?.();
  };
}
