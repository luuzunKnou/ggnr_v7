import type Map from 'ol/Map';
import type { Coordinate } from 'ol/coordinate';

/** view.padding 반영 시각 중심 픽셀 [x, y] — 센터마크 UI 위치용 */
export function getMapVisualCenterPixel(map: Map): [number, number] | null {
  const size = map.getSize();
  if (!size || size.length < 2) return null;
  const padding = map.getView().padding ?? [0, 0, 0, 0];
  const top = padding[0] ?? 0;
  const right = padding[1] ?? 0;
  const bottom = padding[2] ?? 0;
  const left = padding[3] ?? 0;
  const x = left + (size[0] - left - right) / 2;
  const y = top + (size[1] - top - bottom) / 2;
  return [x, y];
}

/** view.padding 반영 시각 중심 지도 좌표 */
export function getMapVisualCenterCoordinate(map: Map): Coordinate | null {
  const pixel = getMapVisualCenterPixel(map);
  if (!pixel) {
    const c = map.getView().getCenter();
    return c ? [...c] : null;
  }
  const coord = map.getCoordinateFromPixel(pixel);
  if (coord) return [...coord];
  const c = map.getView().getCenter();
  return c ? [...c] : null;
}

/**
 * 거리뷰 ON 전용 — 패널 여백 변경 시 맵 중심(A)을 새 센터마크(남은 영역 정중앙)에 맞춤.
 * 일반 센터마크용 패딩 적용(setCenter 없음)과 분리.
 *
 * 1) A = 현재 view.getCenter() (조작 전 맵 중심)
 * 2) padding 적용 → 센터마크 화면 위치 이동
 * 3) setCenter(A) → A가 새 마크 위치(패딩된 뷰 정중앙)로 오도록 지도 이동
 */
export function applyViewPaddingPreservingVisualCenter(
  map: Map,
  padding: [number, number, number, number]
): Coordinate | null {
  const view = map.getView();
  const center = view.getCenter();
  const A: Coordinate | null = center ? [...center] : null;

  view.padding = padding;
  map.updateSize();

  if (A) {
    view.setCenter(A);
  }
  return A;
}
