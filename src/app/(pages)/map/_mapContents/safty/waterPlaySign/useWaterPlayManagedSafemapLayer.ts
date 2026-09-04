'use client';

/**
 * 재난안전지도 «물놀이 관리지역»(IF_0044) WMS 동기화 — 물놀이 표지판 전용 복제본.
 * SafetyMapLayerPanel 과 레이어 kind 를 분리해 동시 오픈 시 소유권 충돌을 피한다.
 */
import { useCallback, useEffect, useState } from 'react';
import ImageLayer from 'ol/layer/Image';
import ImageStatic from 'ol/source/ImageStatic';
import type Map from 'ol/Map';
import type BaseLayer from 'ol/layer/Base';
import { getIntersection, isEmpty, type Extent } from 'ol/extent';
import { transformExtent } from 'ol/proj';
import ImageWrapper from 'ol/Image';
import { DEVICE_PIXEL_RATIO } from 'ol/has';
import { call } from '@/lib/api';
import { useMapContext, type MapContextValue } from '../../../_mapComponents/MapContext';

const SAFEMAP_MAX_IMAGE_EDGE_PX = 2048;
const SAFEMAP_VIEWPORT_REFRESH_MS = 220;
const SAFEMAP_WMS_TIMEOUT_MS = 5000;

const SAFEMAP_WATER_PLAY_MANAGED_WMS_URL = 'https://safemap.go.kr/openapi2/IF_0044_WMS';
const LAYER_OPACITY = 1;
const LAYER_Z_INDEX = 121;
/** 재난안전지도 waterPlayManaged 와 구분 */
const OL_LAYER_KIND = 'waterPlaySignManaged';
const OL_LAYER_KEY = 'safetyMapLayerKind';

const TRANSPARENT_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

type EmdWgs84Bbox = { minX: number; maxX: number; minY: number; maxY: number };

function emdWgs84To3857Extent(emd: EmdWgs84Bbox | null): Extent | null {
  if (!emd) return null;
  const { minX, maxX, minY, maxY } = emd;
  if (![minX, maxX, minY, maxY].every((v) => Number.isFinite(Number(v)))) return null;
  return transformExtent([minX, minY, maxX, maxY], 'EPSG:4326', 'EPSG:3857') as Extent;
}

function getSafemapWmsExtent3857(
  viewExtent3857: Extent,
  emdWgs84: EmdWgs84Bbox | null
): Extent {
  const emd3857 = emdWgs84To3857Extent(emdWgs84);
  if (!emd3857) return viewExtent3857;
  const inter = getIntersection(viewExtent3857, emd3857);
  if (!isEmpty(inter)) return inter;
  return emd3857;
}

function clampSafemapImageSizeForExtent(
  widthCssPx: number,
  heightCssPx: number,
  pixelRatio: number,
  extent3857: Extent
): [number, number] {
  const [xmin, ymin, xmax, ymax] = extent3857;
  const bw = Math.max(1e-12, xmax - xmin);
  const bh = Math.max(1e-12, ymax - ymin);
  const extentRatio = bw / bh;

  let w = Math.max(1, Math.round(widthCssPx * pixelRatio));
  let h = Math.max(1, Math.round(heightCssPx * pixelRatio));
  const vr = w / h;
  if (vr > extentRatio) {
    w = Math.max(1, Math.round(h * extentRatio));
  } else {
    h = Math.max(1, Math.round(w / extentRatio));
  }

  const edge = Math.max(w, h);
  if (edge > SAFEMAP_MAX_IMAGE_EDGE_PX) {
    const s = SAFEMAP_MAX_IMAGE_EDGE_PX / edge;
    w = Math.max(1, Math.round(w * s));
    h = Math.max(1, Math.round(w / extentRatio));
  }
  return [w, h];
}

function buildSafemapWmsImageUrl(
  wmsBaseUrl: string,
  serviceKey: string,
  extent3857: Extent,
  widthPx: number,
  heightPx: number
): string {
  const [xmin, ymin, xmax, ymax] = extent3857;
  const u = new URL(wmsBaseUrl);
  u.searchParams.set('serviceKey', serviceKey);
  u.searchParams.set('srs', 'EPSG:3857');
  u.searchParams.set('bbox', `${xmin},${ymin},${xmax},${ymax}`);
  u.searchParams.set('format', 'image/png');
  u.searchParams.set('width', String(widthPx));
  u.searchParams.set('height', String(heightPx));
  u.searchParams.set('transparent', 'TRUE');
  return u.toString();
}

function safemapStaticImageLoadFunction(
  image: ImageWrapper,
  src: string,
  onFailed?: () => void
) {
  const failOnce = () => {
    try {
      onFailed?.();
    } catch {
      /* ignore */
    }
  };
  try {
    const el = image.getImage() as HTMLImageElement;
    if (!src) {
      failOnce();
      el.src = TRANSPARENT_PNG;
      return;
    }
    el.crossOrigin = 'anonymous';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      el.onload = null;
      el.onerror = null;
      if (timer != null) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
    const settle = (failed: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!failed) return;
      failOnce();
      try {
        el.removeAttribute('crossorigin');
        el.src = TRANSPARENT_PNG;
      } catch {
        /* ignore */
      }
    };
    el.onload = () => settle(false);
    el.onerror = () => settle(true);
    timer = setTimeout(() => settle(true), SAFEMAP_WMS_TIMEOUT_MS);
    el.src = src;
  } catch {
    failOnce();
    try {
      (image.getImage() as HTMLImageElement).src = TRANSPARENT_PNG;
    } catch {
      /* ignore */
    }
  }
}

function bindSafemapImageLoadFunction(onFailed?: () => void) {
  return (image: ImageWrapper, src: string) => safemapStaticImageLoadFunction(image, src, onFailed);
}

function removeLayersByKind(map: Map, kind: string) {
  const stack = map.getLayers();
  const found = stack
    .getArray()
    .filter((l) => l.get(OL_LAYER_KEY) === kind) as BaseLayer[];
  found.forEach((l) => stack.remove(l));
}

function createLayer(
  map: Map,
  serviceKey: string,
  emdWgs84: EmdWgs84Bbox | null,
  onFailed?: () => void
): ImageLayer<ImageStatic> {
  const size = map.getSize();
  const view = map.getView();
  const viewExtent: Extent = view.calculateExtent(size ?? [512, 512]);
  const fallback: Extent = getSafemapWmsExtent3857(viewExtent, emdWgs84);
  const [w, h] = clampSafemapImageSizeForExtent(
    size?.[0] ?? 512,
    size?.[1] ?? 512,
    DEVICE_PIXEL_RATIO,
    fallback
  );
  const url = buildSafemapWmsImageUrl(
    SAFEMAP_WATER_PLAY_MANAGED_WMS_URL,
    serviceKey,
    fallback,
    w,
    h
  );
  const layer = new ImageLayer({
    opacity: LAYER_OPACITY,
    source: new ImageStatic({
      url,
      imageExtent: fallback,
      projection: 'EPSG:3857',
      crossOrigin: 'anonymous',
      interpolate: true,
      imageLoadFunction: bindSafemapImageLoadFunction(onFailed),
    }),
  });
  layer.set(OL_LAYER_KEY, OL_LAYER_KIND);
  layer.setZIndex(LAYER_Z_INDEX);
  return layer;
}

function useWaterPlayManagedWmsSync(
  mapContext: MapContextValue | null | undefined,
  wantLayer: boolean,
  safemapApiKey: string,
  emdWgs84: EmdWgs84Bbox | null,
  onImageLoadingChange?: (loading: boolean) => void,
  onCallFailed?: () => void,
  onCallOk?: () => void
) {
  useEffect(() => {
    const detach = () => {
      const map = mapContext?.mapInstanceRef?.current;
      if (map) removeLayersByKind(map, OL_LAYER_KIND);
    };

    if (!wantLayer) {
      onImageLoadingChange?.(false);
      detach();
      return;
    }

    if (!safemapApiKey) {
      onImageLoadingChange?.(false);
      detach();
      onCallFailed?.();
      return;
    }

    let cancelled = false;
    let halted = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    let debounceId: ReturnType<typeof setTimeout> | null = null;
    let imageLayer: ImageLayer<ImageStatic> | null = null;
    let loadGeneration = 0;
    let failGuard: { stale: boolean } | null = null;

    const haltAfterFail = () => {
      if (cancelled || halted) return;
      halted = true;
      if (failGuard) failGuard.stale = true;
      loadGeneration += 1;
      onImageLoadingChange?.(false);
      if (debounceId != null) {
        clearTimeout(debounceId);
        debounceId = null;
      }
      const map = mapContext?.mapInstanceRef?.current;
      if (map) {
        map.un('moveend', scheduleApply);
        map.un('change:size', scheduleApply);
      }
      detach();
      imageLayer = null;
      try {
        onCallFailed?.();
      } catch {
        /* ignore */
      }
    };

    const nextFailHandler = () => {
      if (failGuard) failGuard.stale = true;
      const guard = { stale: false };
      failGuard = guard;
      return () => {
        if (guard.stale || cancelled || halted) return;
        haltAfterFail();
      };
    };

    const applyViewport = () => {
      if (cancelled || halted || !imageLayer) return;
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;
      const size = map.getSize();
      if (!size || size[0] < 1 || size[1] < 1) return;
      const viewExtent = map.getView().calculateExtent(size) as Extent;
      const extent = getSafemapWmsExtent3857(viewExtent, emdWgs84);
      const [w, h] = clampSafemapImageSizeForExtent(size[0], size[1], DEVICE_PIXEL_RATIO, extent);
      const url = buildSafemapWmsImageUrl(
        SAFEMAP_WATER_PLAY_MANAGED_WMS_URL,
        safemapApiKey,
        extent,
        w,
        h
      );
      const gen = ++loadGeneration;
      onImageLoadingChange?.(true);
      const src = new ImageStatic({
        url,
        imageExtent: extent.slice() as Extent,
        projection: 'EPSG:3857',
        crossOrigin: 'anonymous',
        interpolate: true,
        imageLoadFunction: bindSafemapImageLoadFunction(nextFailHandler()),
      });
      const finish = () => {
        if (cancelled || halted || gen !== loadGeneration) return;
        onImageLoadingChange?.(false);
      };
      src.once('imageloadend', () => {
        finish();
        if (!cancelled && !halted) {
          try {
            onCallOk?.();
          } catch {
            /* ignore */
          }
        }
      });
      src.once('imageloaderror', () => {
        finish();
        haltAfterFail();
      });
      imageLayer.setSource(src);
    };

    const scheduleApply = () => {
      if (cancelled || halted) return;
      if (debounceId != null) clearTimeout(debounceId);
      debounceId = setTimeout(() => {
        debounceId = null;
        applyViewport();
      }, SAFEMAP_VIEWPORT_REFRESH_MS);
    };

    const cleanupListeners = () => {
      const map = mapContext?.mapInstanceRef?.current;
      if (map) {
        map.un('moveend', scheduleApply);
        map.un('change:size', scheduleApply);
      }
      if (debounceId != null) {
        clearTimeout(debounceId);
        debounceId = null;
      }
    };

    const tryAttach = (): boolean => {
      const map = mapContext?.mapInstanceRef?.current;
      if (!map || cancelled || halted) return false;
      const existing = map
        .getLayers()
        .getArray()
        .find((l) => l.get(OL_LAYER_KEY) === OL_LAYER_KIND) as
        | ImageLayer<ImageStatic>
        | undefined;
      if (!existing) {
        const layer = createLayer(map, safemapApiKey, emdWgs84, nextFailHandler());
        map.addLayer(layer);
        imageLayer = layer;
        map.on('moveend', scheduleApply);
        map.on('change:size', scheduleApply);
        queueMicrotask(applyViewport);
      } else {
        existing.setOpacity(LAYER_OPACITY);
        imageLayer = existing;
      }
      return true;
    };

    if (tryAttach()) {
      return () => {
        cancelled = true;
        halted = true;
        if (failGuard) failGuard.stale = true;
        loadGeneration += 1;
        onImageLoadingChange?.(false);
        cleanupListeners();
        detach();
        imageLayer = null;
      };
    }

    intervalId = setInterval(() => {
      if (cancelled || halted) return;
      if (tryAttach() && intervalId != null) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    }, 150);

    return () => {
      cancelled = true;
      halted = true;
      if (failGuard) failGuard.stale = true;
      loadGeneration += 1;
      onImageLoadingChange?.(false);
      if (intervalId != null) clearInterval(intervalId);
      cleanupListeners();
      detach();
      imageLayer = null;
    };
  }, [
    wantLayer,
    safemapApiKey,
    emdWgs84,
    mapContext?.mapInstanceRef,
    onImageLoadingChange,
    onCallFailed,
    onCallOk,
  ]);
}

/** 물놀이 표지판 헤더 토글칩 — 물놀이 관리지역 safemap WMS */
export function useWaterPlayManagedSafemapLayer() {
  const mapContext = useMapContext();
  const [on, setOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [safemapApiKey, setSafemapApiKey] = useState('');
  const [emdWgs84, setEmdWgs84] = useState<EmdWgs84Bbox | null>(null);

  useEffect(() => {
    call('', 'POST', { service: 'configService', action: 'getMapConfig', params: {} })
      .then((res) => {
        const data = res?.data ?? res;
        const d = data as { SAFEMAP_API_KEY?: string };
        setSafemapApiKey(String(d?.SAFEMAP_API_KEY ?? '').trim());
      })
      .catch(() => {
        setSafemapApiKey('');
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'devTestService',
          action: 'getEmdExtentWgs84',
          params: {},
        });
        if (cancelled) return;
        const d = res?.data ?? res;
        const err = (d as { error?: string })?.error;
        if (err || d?.minX == null || d?.maxX == null || d?.minY == null || d?.maxY == null) {
          setEmdWgs84(null);
          return;
        }
        setEmdWgs84({
          minX: Number(d.minX),
          maxX: Number(d.maxX),
          minY: Number(d.minY),
          maxY: Number(d.maxY),
        });
      } catch {
        if (!cancelled) setEmdWgs84(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onLoading = useCallback((v: boolean) => {
    setLoading(v);
  }, []);
  const onFailed = useCallback(() => {
    setFailed(true);
  }, []);
  const onOk = useCallback(() => {
    setFailed(false);
  }, []);

  useWaterPlayManagedWmsSync(
    mapContext,
    on,
    safemapApiKey,
    emdWgs84,
    onLoading,
    onFailed,
    onOk
  );

  const toggle = useCallback(() => {
    setOn((prev) => {
      if (prev) setFailed(false);
      return !prev;
    });
  }, []);

  return { on, toggle, loading, failed };
}
