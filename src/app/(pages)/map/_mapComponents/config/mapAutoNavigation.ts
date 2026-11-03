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
  /** 이보다 축소되지 않음(공시지가 라벨 축척 유지 등) */
  maxResolution?: number;
  /**
   * true면 현재보다 축소하지 않음(필지 선택 등).
   * 화면 밖·축소 상태면 확대·이동만 하고, 이미 확대돼 있으면 중심만 맞춤.
   */
  noZoomOut?: boolean;
  applyMapViewPadding?: (() => void) | null;
};

function parseExtent3857(raw: number[] | Extent3857 | null | undefined): Extent3857 | null {
  if (!raw || raw.length !== 4) return null;
  const nums = raw.map((v) => Number(v));
  if (!nums.every(Number.isFinite)) return null;
  const xmin = Math.min(nums[0]!, nums[2]!);
  const xmax = Math.max(nums[0]!, nums[2]!);
  const ymin = Math.min(nums[1]!, nums[3]!);
  const ymax = Math.max(nums[1]!, nums[3]!);
  const w = xmax - xmin;
  const h = ymax - ymin;
  if (w > 5_000_000 || h > 5_000_000) return null;
  const cx = (xmin + xmax) / 2;
  const cy = (ymin + ymax) / 2;
  // EPSG:3857 — 한국 주변 허용 (해외·오염 좌표 fit 방지)
  if (cx < 10_000_000 || cx > 16_500_000 || cy < 2_000_000 || cy > 6_500_000) return null;
  return [xmin, ymin, xmax, ymax];
}

/** 패널 view.padding 반영 후 map size 갱신 */
export function prepareMapForPanelAwareNavigation(
  map: Map,
  applyMapViewPadding?: (() => void) | null
): void {
  applyMapViewPadding?.();
  map.updateSize();
  // 좌측 패널 padding이 지도 폭보다 크면 fit/타일 요청이 깨져 흰 화면이 될 수 있음
  const size = map.getSize();
  const view = map.getView();
  const padding = view.padding;
  if (!size || !padding) return;
  const mapW = size[0] ?? 0;
  const left = Number(padding[3] ?? 0);
  if (mapW > 0 && left >= mapW - 40) {
    view.padding = [padding[0] ?? 0, padding[1] ?? 0, padding[2] ?? 0, Math.max(0, mapW - 80)];
  }
}

/**
 * extent(3857)로 fit/이동.
 * OpenLayers View.fit는 view.padding(좌측 패널)을 이미 반영 — fitPadding은 도형 주변 여백만.
 *
 * 참고: OL10 FitOptions에는 maxResolution이 없다(무시됨).
 * maxResolution이 있으면 직접 resolution을 계산·클램프한 뒤 animate 한다.
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
  const center: [number, number] = [(xmin + xmax) / 2, (ymin + ymax) / 2];

  if (w < pointThreshold && h < pointThreshold) {
    // 이미 더 가까이 보고 있으면 줌 아웃하지 않음 — 포인트 클릭 시 현재 줌 유지
    const currentZoom = view.getZoom() ?? 0;
    view.animate({
      center,
      zoom: Math.max(currentZoom, pointZoom),
      duration,
    });
    return true;
  }

  const maxResolution =
    typeof options?.maxResolution === 'number' &&
    Number.isFinite(options.maxResolution) &&
    options.maxResolution > 0
      ? options.maxResolution
      : null;
  const noZoomOut = options?.noZoomOut === true;

  /** OL10 fit는 maxResolution 미지원. noZoomOut·maxResolution은 resolution을 직접 잡아 animate */
  if (maxResolution != null || noZoomOut) {
    const size = map.getSize();
    if (!size || size[0] <= 0 || size[1] <= 0) return false;
    const pad = fitPadding;
    const availW = Math.max(1, size[0] - pad[1] - pad[3]);
    const availH = Math.max(1, size[1] - pad[0] - pad[2]);
    let resolution = view.getResolutionForExtent(ext, [availW, availH]);
    if (!Number.isFinite(resolution) || resolution <= 0) return false;
    if (maxResolution != null) {
      /** 전체 범위가 더 축소되어야 해도 지정 축척보다 밖으로 나가지 않음 */
      resolution = Math.min(resolution, maxResolution);
    }
    if (noZoomOut) {
      const currentRes = view.getResolution();
      if (currentRes != null && Number.isFinite(currentRes) && currentRes > 0) {
        /** 해상도가 작을수록 확대 — 현재보다 큰 해상도(축소)로 가지 않음 */
        resolution = Math.min(resolution, currentRes);
      }
    }
    /** maxZoom보다 더 확대하지 않음 */
    const minResForMaxZoom = view.getResolutionForZoom(maxZoom);
    if (Number.isFinite(minResForMaxZoom)) {
      resolution = Math.max(resolution, minResForMaxZoom);
    }
    const constrained =
      typeof view.getConstrainedResolution === 'function'
        ? view.getConstrainedResolution(resolution)
        : resolution;
    view.animate({
      center,
      resolution: constrained && constrained > 0 ? constrained : resolution,
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
