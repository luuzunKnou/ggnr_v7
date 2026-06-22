import type Map from "ol/Map";
import { MAP_AUTO_NAV_MAX_ZOOM } from "./mapDefaults";

export type Extent3857 = [number, number, number, number];
type FitPadding = [number, number, number, number];

export type MapAutoNavOptions = {
  maxZoom?: number;
  duration?: number;
  /** fit 추가 여백(상·우·하·좌). view.padding(패널)과 별개 */
  fitPadding?: FitPadding;
  /** extent 폭·높이가 이보다 작으면 중심+zoom 이동 */
  pointThreshold?: number;
  pointZoom?: number;
  applyMapViewPadding?: (() => void) | null;
};

function parseExtent3857(raw: number[] | Extent3857 | null | undefined): Extent3857 | null {
  if (!raw || raw.length !== 4) return null;
  const ext = raw.map((v) => Number(v)) as Extent3857;
  if (!ext.every(Number.isFinite)) return null;
  return ext;
}

/** 패널 view.padding 반영 후 map size 갱신 */
export function prepareMapForPanelAwareNavigation(
  map: Map,
  applyMapViewPadding?: (() => void) | null
): void {
  applyMapViewPadding?.();
  map.updateSize();
}

/**
 * extent(3857)로 fit/이동.
 * OpenLayers View.fit는 view.padding(좌측 패널)을 이미 반영 — fitPadding은 도형 주변 여백만.
 */
export function fitMapToExtent3857(
  map: Map,
  extentRaw: number[] | Extent3857,
  options?: MapAutoNavOptions
): boolean {
  const ext = parseExtent3857(extentRaw);
  if (!ext) return false;

  const view = map.getView();
  const [xmin, ymin, xmax, ymax] = ext;
  const w = Math.abs(xmax - xmin);
  const h = Math.abs(ymax - ymin);
  const pointThreshold = options?.pointThreshold ?? 2;
  const maxZoom = options?.maxZoom ?? MAP_AUTO_NAV_MAX_ZOOM;
  const duration = options?.duration ?? 500;
  const fitPadding = options?.fitPadding ?? [80, 80, 80, 80];
  const pointZoom = options?.pointZoom ?? Math.min(20, maxZoom);

  if (w < pointThreshold && h < pointThreshold) {
    // 이미 더 가까이 보고 있으면 줌 아웃하지 않음 — 포인트 클릭 시 현재 줌 유지
    const currentZoom = view.getZoom() ?? 0;
    view.animate({
      center: [(xmin + xmax) / 2, (ymin + ymax) / 2],
      zoom: Math.max(currentZoom, pointZoom),
      duration,
    });
    return true;
  }

  view.fit(ext, {
    padding: fitPadding,
    maxZoom,
    duration,
  });
  return true;
}

/** 레이아웃·패널 padding 반영 후 fit (리스트 선택 등) */
export function scheduleFitMapToExtent3857(
  map: Map,
  extentRaw: number[] | Extent3857,
  options?: MapAutoNavOptions
): void {
  const run = () => {
    prepareMapForPanelAwareNavigation(map, options?.applyMapViewPadding);
    fitMapToExtent3857(map, extentRaw, options);
  };
  queueMicrotask(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(run);
    });
  });
}

/** 패널을 고려한 중심 이동 */
export function scheduleAnimateMapToCenter3857(
  map: Map,
  center3857: [number, number],
  zoom: number,
  options?: Pick<MapAutoNavOptions, "duration" | "applyMapViewPadding">
): void {
  const run = () => {
    prepareMapForPanelAwareNavigation(map, options?.applyMapViewPadding);
    map.getView().animate({
      center: center3857,
      zoom,
      duration: options?.duration ?? 450,
    });
  };
  queueMicrotask(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(run);
    });
  });
}
