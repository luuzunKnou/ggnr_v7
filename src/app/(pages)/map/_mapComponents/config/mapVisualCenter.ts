import type Map from 'ol/Map';
import type { Coordinate } from 'ol/coordinate';

/** view.padding 반영 시각 중심 픽셀 [x, y] */
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
