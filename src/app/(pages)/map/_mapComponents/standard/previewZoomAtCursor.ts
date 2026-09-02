export type PreviewPan = { x: number; y: number };

/**
 * translate(pan) + rotate + scale 변환에서 커서 아래 콘텐츠 점을 고정한 채 배율만 변경할 때 pan 보정.
 * viewport 중심 = 컨테이너 중앙, 콘텐츠도 중심 정렬(translate -50% -50%) 구조를 가정.
 */
export function adjustPanForZoomAtPoint(
  pan: PreviewPan,
  pointer: { x: number; y: number },
  viewportCenter: { x: number; y: number },
  oldScale: number,
  newScale: number,
  rotationDeg: number
): PreviewPan {
  if (oldScale === newScale || oldScale === 0) return pan;

  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const dx = pointer.x - viewportCenter.x - pan.x;
  const dy = pointer.y - viewportCenter.y - pan.y;

  const lx = (dx * cos + dy * sin) / oldScale;
  const ly = (-dx * sin + dy * cos) / oldScale;

  const sdx = lx * newScale * cos - ly * newScale * sin;
  const sdy = lx * newScale * sin + ly * newScale * cos;

  return {
    x: pan.x + dx - sdx,
    y: pan.y + dy - sdy,
  };
}

export function zoomPreviewAtPointer(
  pan: PreviewPan,
  pointer: { x: number; y: number } | null,
  containerRect: { width: number; height: number },
  oldScale: number,
  scaleDelta: number,
  minScale: number,
  maxScale: number,
  rotationDeg: number
): { pan: PreviewPan; scale: number } | null {
  const newScale = Math.min(maxScale, Math.max(minScale, oldScale + scaleDelta));
  if (newScale === oldScale) return null;

  const center = { x: containerRect.width / 2, y: containerRect.height / 2 };
  const pt = pointer ?? center;
  const nextPan = adjustPanForZoomAtPoint(pan, pt, center, oldScale, newScale, rotationDeg);
  return { pan: nextPan, scale: newScale };
}
