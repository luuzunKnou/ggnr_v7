'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { call } from '@/lib/api';
import { useMapContext, type MapContextValue } from '../../../_mapComponents/MapContext';
import ImageLayer from 'ol/layer/Image';
import ImageStatic from 'ol/source/ImageStatic';
import type Map from 'ol/Map';
import type BaseLayer from 'ol/layer/Base';
import { getIntersection, isEmpty, type Extent } from 'ol/extent';
import { transformExtent } from 'ol/proj';
import ImageWrapper from 'ol/Image';
import { DEVICE_PIXEL_RATIO } from 'ol/has';

// ---------------------------------------------------------------------------
// 행정안전부 재난안전대응정보시스템 safemap 오픈API WMS
// - 지방하천 IF_0100_WMS / 국가하천 IF_0089_WMS / 산사태위험 IF_0046_WMS / 물놀이관리지역 IF_0044_WMS
// 문서(Java): serviceKey, srs, bbox, format, width, height, transparent (layers 없음)
// 뷰포트 bbox당 단일 이미지 요청(ImageStatic)으로 타일 폭주 방지
// ---------------------------------------------------------------------------

/** 서버/URL 길이 부담 완화용 요청 해상도 상한(긴 변 px) */
const SAFEMAP_MAX_IMAGE_EDGE_PX = 2048;
const SAFEMAP_VIEWPORT_REFRESH_MS = 220;

const SAFEMAP_FLOOD_LOCAL_WMS_URL = 'https://safemap.go.kr/openapi2/IF_0100_WMS';
const SAFEMAP_FLOOD_NATIONAL_WMS_URL = 'https://safemap.go.kr/openapi2/IF_0089_WMS';
const SAFEMAP_LANDSLIDE_WMS_URL = 'https://safemap.go.kr/openapi2/IF_0046_WMS';
const SAFEMAP_WATER_PLAY_MANAGED_WMS_URL = 'https://safemap.go.kr/openapi2/IF_0044_WMS';
/** 행안부 생활안전정보 침수흔적도 WMS (문서: IF_0092, 레이어 A2SM_FLUDMARKS) */
const SAFEMAP_FLOOD_TRACE_WMS_URL = 'https://safemap.go.kr/openapi2/IF_0092_WMS';

/** 재난안전지도 safemap 래스터 레이어 투명도 (병원·저수지 제원 등만 GeoServer — safetydataMapLayerFactory) */
const SAFETY_RASTER_OPACITY = {
  floodRiverLocal: 0.3,
  floodRiverNational: 0.3,
  landslideRisk: 0.3,
  /** 침수흔적도 IF_0092 */
  moisFloodTrace: 0.88,
  waterPlayManaged: 1,
} as const;

/** 500·CORS·네트워크 오류 시 타일 큐/맵 렌더가 멈추지 않도록 투명 1px로 대체 */
const TRANSPARENT_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ZQAAAAASUVORK5CYII=';

const SAFETY_MAP_OL_LAYER_KEY = 'safetyMapLayerKind';
const FLOOD_RIVER_LOCAL_KIND = 'floodRiverLocal';
const FLOOD_RIVER_NATIONAL_KIND = 'floodRiverNational';
const LANDSLIDE_RISK_KIND = 'landslideRisk';
const WATER_PLAY_MANAGED_KIND = 'waterPlayManaged';

/** 하천범람 침수심 등급 (제공처 기준) */
const FLOOD_DEPTH_LEGEND: { label: string; color: string }[] = [
  { label: '1등급(0.5m 미만)', color: '#FFFF7F' },
  { label: '2등급(0.5m ~ 1.0m 미만)', color: '#BFFF00' },
  { label: '3등급(1.0m ~ 2.0m 미만)', color: '#00FFFF' },
  { label: '4등급(2.0m ~ 5.0m 미만)', color: '#BF7FFF' },
  { label: '5등급(5.0m 이상)', color: '#FF007F' },
];

/** 산사태위험지도 등급 (IF_0046 / 제공 UI 목업 색상 기준) */
const LANDSLIDE_RISK_LEGEND: { label: string; color: string }[] = [
  { label: '1등급', color: '#FF3838' },
  { label: '2등급', color: '#F5C400' },
  { label: '3등급', color: '#C5E86C' },
  { label: '4등급', color: '#5EC8F7' },
  { label: '5등급', color: '#2563EB' },
];

/** 침수흔적도 IF_0092 — 전체(침수심) 6등급 (선택 안전정보 UI 기준) */
const FLOOD_TRACE_DEPTH_LEGEND: { label: string; color: string }[] = [
  { label: '1등급(0.5m 미만)', color: '#FFEE58' },
  { label: '2등급(0.5m ~ 1.0m 미만)', color: '#DCE775' },
  { label: '3등급(1.0m ~ 1.5m 미만)', color: '#B2EBF2' },
  { label: '4등급(1.5m ~ 2.0m 미만)', color: '#80CBC4' },
  { label: '5등급(2.0m ~ 3.0m 미만)', color: '#81D4FA' },
  { label: '6등급(3.0m 이상)', color: '#9FA8DA' },
];

/** WMS 단일 이미지 로드 → 프로그레스 UI 대상 */
const SAFEMAP_WMS_PROGRESS_LAYER_IDS = new Set([
  'floodRiverLocal',
  'floodRiverNational',
  'landslideRisk',
  'moisFloodTrace',
  WATER_PLAY_MANAGED_KIND,
]);

const LAYERS: { id: string; label: string }[] = [
  { id: 'floodRiverLocal', label: '하천범람지도 (지방하천)' },
  { id: 'floodRiverNational', label: '하천범람지도 (국가하천)' },
  { id: 'landslideRisk', label: '산사태위험지도' },
  { id: 'moisFloodTrace', label: '침수흔적도' },
  { id: 'waterPlayManaged', label: '물놀이 관리지역' },
];

/** 교통정보(ITS CCTV)와 동일 — `devTestService.getEmdExtentWgs84` (schema.emd 합집합 envelope) */
type EmdWgs84Bbox = { minX: number; maxX: number; minY: number; maxY: number };

function emdWgs84To3857Extent(emd: EmdWgs84Bbox | null): Extent | null {
  if (!emd) return null;
  const { minX, maxX, minY, maxY } = emd;
  if (![minX, maxX, minY, maxY].every((v) => Number.isFinite(Number(v)))) return null;
  return transformExtent([minX, minY, maxX, maxY], 'EPSG:4326', 'EPSG:3857') as Extent;
}

/**
 * 뷰 bbox와 emd(서비스 구역)의 교집합으로 WMS 요청 — 뷰가 넓을 때 emd 밖 영역으로 요청이 나가지 않게 함
 * (뷰가 emd와 겹치지 않으면 emd 전체 3857 extent로 fallback — 지도상 올바른 위치에만 래스터 표시)
 */
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

/**
 * WMS GetMap의 width·height 종횡비는 bbox(요청 srs)와 같아야 한다.
 * 그렇지 않으면(뷰포트 비만 쓰면) 축소 시 심볼·폴리곤이 한쪽으로 늘어난 것처럼 보인다.
 */
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

/** IF_0092 등 일부 WMS는 layers(및 styles) 필요 */
type SafemapWmsQueryExtra = { layers?: string; styles?: string };

/** useSafemapFloodWmsSync deps 안정화 — 매 렌더 새 객체 시 effect 무한 루프 */
const SAFEMAP_FLOOD_TRACE_WMS_EXTRA: SafemapWmsQueryExtra = { layers: 'A2SM_FLUDMARKS' };

function buildSafemapWmsImageUrl(
  wmsBaseUrl: string,
  serviceKey: string,
  extent3857: Extent,
  widthPx: number,
  heightPx: number,
  extra?: SafemapWmsQueryExtra
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
  if (extra?.layers != null && extra.layers !== '') u.searchParams.set('layers', extra.layers);
  if (extra?.styles !== undefined) u.searchParams.set('styles', extra.styles);
  return u.toString();
}

/** ImageStatic용: 500/CORS 시 투명 이미지로 대체 */
function safemapStaticImageLoadFunction(image: ImageWrapper, src: string) {
  try {
    const el = image.getImage() as HTMLImageElement;
    if (!src) {
      el.src = TRANSPARENT_PNG;
      return;
    }
    el.crossOrigin = 'anonymous';
    const cleanup = () => {
      el.onload = null;
      el.onerror = null;
    };
    el.onload = cleanup;
    el.onerror = () => {
      cleanup();
      try {
        el.removeAttribute('crossorigin');
        el.src = TRANSPARENT_PNG;
      } catch {
        /* ignore */
      }
    };
    el.src = src;
  } catch {
    try {
      (image.getImage() as HTMLImageElement).src = TRANSPARENT_PNG;
    } catch {
      /* ignore */
    }
  }
}

function createSafemapFloodImageLayer(
  map: Map,
  serviceKey: string,
  wmsBaseUrl: string,
  layerKind: string,
  zIndex: number,
  layerOpacity: number,
  emdWgs84: EmdWgs84Bbox | null,
  wmsExtra?: SafemapWmsQueryExtra
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
  const url = buildSafemapWmsImageUrl(wmsBaseUrl, serviceKey, fallback, w, h, wmsExtra);
  const layer = new ImageLayer({
    opacity: layerOpacity,
    source: new ImageStatic({
      url,
      imageExtent: fallback,
      projection: 'EPSG:3857',
      crossOrigin: 'anonymous',
      interpolate: true,
      imageLoadFunction: safemapStaticImageLoadFunction,
    }),
  });
  layer.set(SAFETY_MAP_OL_LAYER_KEY, layerKind);
  layer.setZIndex(zIndex);
  return layer;
}

function useSafemapFloodWmsSync(
  mapContext: MapContextValue | null | undefined,
  wantLayer: boolean,
  safemapApiKey: string,
  layerKind: string,
  wmsBaseUrl: string,
  zIndex: number,
  layerOpacity: number,
  emdWgs84: EmdWgs84Bbox | null,
  onImageLoadingChange?: (loading: boolean) => void,
  wmsExtra?: SafemapWmsQueryExtra
) {
  useEffect(() => {
    const want = wantLayer && safemapApiKey.length > 0;

    const detach = () => {
      const map = mapContext?.mapInstanceRef?.current;
      if (map) removeSafetyMapLayersByKind(map, layerKind);
    };

    if (!want) {
      onImageLoadingChange?.(false);
      detach();
      return;
    }

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    let debounceId: ReturnType<typeof setTimeout> | null = null;
    let imageLayer: ImageLayer<ImageStatic> | null = null;
    let loadGeneration = 0;

    const applyViewport = () => {
      if (cancelled || !imageLayer) return;
      const map = mapContext?.mapInstanceRef?.current;
      if (!map) return;
      const size = map.getSize();
      if (!size || size[0] < 1 || size[1] < 1) return;
      const viewExtent = map.getView().calculateExtent(size) as Extent;
      const extent = getSafemapWmsExtent3857(viewExtent, emdWgs84);
      const [w, h] = clampSafemapImageSizeForExtent(size[0], size[1], DEVICE_PIXEL_RATIO, extent);
      const url = buildSafemapWmsImageUrl(wmsBaseUrl, safemapApiKey, extent, w, h, wmsExtra);
      const gen = ++loadGeneration;
      onImageLoadingChange?.(true);
      const src = new ImageStatic({
        url,
        imageExtent: extent.slice() as Extent,
        projection: 'EPSG:3857',
        crossOrigin: 'anonymous',
        interpolate: true,
        imageLoadFunction: safemapStaticImageLoadFunction,
      });
      const finish = () => {
        if (cancelled || gen !== loadGeneration) return;
        onImageLoadingChange?.(false);
      };
      src.once('imageloadend', finish);
      src.once('imageloaderror', finish);
      imageLayer.setSource(src);
    };

    const scheduleApply = () => {
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
      if (!map || cancelled) return false;
      const existing = map
        .getLayers()
        .getArray()
        .find((l) => l.get(SAFETY_MAP_OL_LAYER_KEY) === layerKind) as ImageLayer<ImageStatic> | undefined;
      if (!existing) {
        const layer = createSafemapFloodImageLayer(
          map,
          safemapApiKey,
          wmsBaseUrl,
          layerKind,
          zIndex,
          layerOpacity,
          emdWgs84,
          wmsExtra
        );
        map.addLayer(layer);
        imageLayer = layer;
        map.on('moveend', scheduleApply);
        map.on('change:size', scheduleApply);
        queueMicrotask(applyViewport);
      } else {
        existing.setOpacity(layerOpacity);
        imageLayer = existing;
      }
      return true;
    };

    if (tryAttach()) {
      return () => {
        cancelled = true;
        loadGeneration += 1;
        onImageLoadingChange?.(false);
        cleanupListeners();
        detach();
        imageLayer = null;
      };
    }

    intervalId = setInterval(() => {
      if (cancelled) return;
      if (tryAttach() && intervalId != null) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    }, 150);

    return () => {
      cancelled = true;
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
    layerKind,
    wmsBaseUrl,
    zIndex,
    layerOpacity,
    emdWgs84,
    mapContext?.mapInstanceRef,
    onImageLoadingChange,
    wmsExtra,
  ]);
}

function removeSafetyMapLayersByKind(map: Map, kind: string) {
  const stack = map.getLayers();
  const found = stack
    .getArray()
    .filter((l) => l.get(SAFETY_MAP_OL_LAYER_KEY) === kind) as BaseLayer[];
  found.forEach((l) => stack.remove(l));
}

type Props = {
  onClose: () => void;
};

export function SafetyMapLayerPanel({ onClose }: Props) {
  const mapContext = useMapContext();
  const visible = mapContext?.safetyMapLayerVisibility ?? {};
  const setVisibleRecord = mapContext?.setSafetyMapLayerVisibility;
  const [safemapApiKey, setSafemapApiKey] = useState('');
  const [wmsImageLoading, setWmsImageLoading] = useState<Record<string, boolean>>({});
  const [emdWgs84, setEmdWgs84] = useState<EmdWgs84Bbox | null>(null);

  const onFloodLocalLoading = useCallback((loading: boolean) => {
    setWmsImageLoading((p) => ({ ...p, floodRiverLocal: loading }));
  }, []);
  const onFloodNationalLoading = useCallback((loading: boolean) => {
    setWmsImageLoading((p) => ({ ...p, floodRiverNational: loading }));
  }, []);
  const onLandslideLoading = useCallback((loading: boolean) => {
    setWmsImageLoading((p) => ({ ...p, landslideRisk: loading }));
  }, []);
  const onWaterPlayManagedLoading = useCallback((loading: boolean) => {
    setWmsImageLoading((p) => ({ ...p, [WATER_PLAY_MANAGED_KIND]: loading }));
  }, []);
  const onMoisFloodTraceLoading = useCallback((loading: boolean) => {
    setWmsImageLoading((p) => ({ ...p, moisFloodTrace: loading }));
  }, []);

  const activeCount = useMemo(
    () => LAYERS.filter((l) => visible[l.id] === true).length,
    [visible]
  );

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

  /** 교통(CCTV)과 동일 emd WGS84 bbox — safemap WMS `bbox`를 서비스 읍면동 합집합으로 제한 */
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

  /** 예전 버전의 VWorld 재해위험지구 래스터가 맵에 남아 있으면 제거 */
  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (map) removeSafetyMapLayersByKind(map, 'moisHazardZone');
  }, [mapContext?.mapInstanceRef]);

  useSafemapFloodWmsSync(
    mapContext,
    visible.floodRiverLocal,
    safemapApiKey,
    FLOOD_RIVER_LOCAL_KIND,
    SAFEMAP_FLOOD_LOCAL_WMS_URL,
    115,
    SAFETY_RASTER_OPACITY.floodRiverLocal,
    emdWgs84,
    onFloodLocalLoading
  );
  useSafemapFloodWmsSync(
    mapContext,
    visible.floodRiverNational,
    safemapApiKey,
    FLOOD_RIVER_NATIONAL_KIND,
    SAFEMAP_FLOOD_NATIONAL_WMS_URL,
    116,
    SAFETY_RASTER_OPACITY.floodRiverNational,
    emdWgs84,
    onFloodNationalLoading
  );
  useSafemapFloodWmsSync(
    mapContext,
    visible.landslideRisk,
    safemapApiKey,
    LANDSLIDE_RISK_KIND,
    SAFEMAP_LANDSLIDE_WMS_URL,
    117,
    SAFETY_RASTER_OPACITY.landslideRisk,
    emdWgs84,
    onLandslideLoading
  );
  useSafemapFloodWmsSync(
    mapContext,
    visible.moisFloodTrace === true,
    safemapApiKey,
    'moisFloodTrace',
    SAFEMAP_FLOOD_TRACE_WMS_URL,
    118,
    SAFETY_RASTER_OPACITY.moisFloodTrace,
    emdWgs84,
    onMoisFloodTraceLoading,
    SAFEMAP_FLOOD_TRACE_WMS_EXTRA
  );
  useSafemapFloodWmsSync(
    mapContext,
    visible.waterPlayManaged === true,
    safemapApiKey,
    WATER_PLAY_MANAGED_KIND,
    SAFEMAP_WATER_PLAY_MANAGED_WMS_URL,
    121,
    SAFETY_RASTER_OPACITY.waterPlayManaged,
    emdWgs84,
    onWaterPlayManagedLoading
  );

  const toggle = useCallback(
    (id: string) => {
      setVisibleRecord?.((prev) => {
        const cur = prev[id] === true;
        return { ...prev, [id]: !cur };
      });
    },
    [setVisibleRecord]
  );

  const setAll = useCallback(
    (on: boolean) => {
      setVisibleRecord?.(Object.fromEntries(LAYERS.map((l) => [l.id, on])));
    },
    [setVisibleRecord]
  );

  const safemapWmsOnNoKey =
    (visible.floodRiverLocal === true ||
      visible.floodRiverNational === true ||
      visible.landslideRisk === true ||
      visible.moisFloodTrace === true ||
      visible.waterPlayManaged === true) &&
    !safemapApiKey;

  const showFloodDepthLegend =
    visible.floodRiverLocal === true || visible.floodRiverNational === true;
  const showLandslideLegend = visible.landslideRisk === true;
  const showFloodTraceLegend = visible.moisFloodTrace === true;

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden opacity-[0.98]">
      <div className="shrink-0 border-b border-slate-200 bg-gradient-to-b from-[#f0f9fc] to-white px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="text-[15px] font-semibold leading-tight text-slate-800">재난안전지도</h2>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              홍수·산사태·침수 등 참조 레이어를 켜고 끕니다.
            </p>
            <p className="mt-1.5 text-[11px] font-medium text-primary/90">
              표시 중 {activeCount} / {LAYERS.length}
            </p>
            {safemapWmsOnNoKey && (
              <p className="mt-1.5 text-[11px] text-amber-700">
                하천범람·산사태·침수흔적·물놀이관리지역 등 safemap WMS 표시를 위해 runtime.env의 SAFEMAP_API_KEY를 설정하세요.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2 border-t border-slate-200/80 pt-3">
          <Layers2 className="h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={1.75} />
          <span className="text-[11px] text-slate-500">레이어</span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setAll(true)}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
          >
            모두 켜기
          </button>
          <span className="text-slate-300" aria-hidden>
            |
          </span>
          <button
            type="button"
            onClick={() => setAll(false)}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
          >
            모두 끄기
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col bg-slate-50/90">
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" role="list">
          {LAYERS.map((layer) => {
            const isOn = visible[layer.id] === true;
            const showWmsProgress =
              SAFEMAP_WMS_PROGRESS_LAYER_IDS.has(layer.id) && isOn && wmsImageLoading[layer.id];
            return (
              <li key={layer.id}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isOn}
                  aria-busy={showWmsProgress || undefined}
                  onClick={() => toggle(layer.id)}
                  className={cn(
                    'relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-[5px] border px-3 py-2.5 text-left shadow-sm transition-all',
                    isOn
                      ? 'border-primary/35 bg-white ring-1 ring-primary/15'
                      : 'border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/80'
                  )}
                >
                  <span
                    className={cn(
                      'min-w-0 flex-1 text-[12px] leading-snug',
                      isOn ? 'font-medium text-slate-900' : 'text-slate-700'
                    )}
                  >
                    {layer.label}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-[5px] px-2 py-0.5 text-[10px] font-medium tabular-nums',
                      isOn ? 'bg-primary/15 text-primary' : 'bg-slate-100 text-slate-500'
                    )}
                  >
                    {isOn ? '표시' : '숨김'}
                  </span>
                  {showWmsProgress && (
                    <div
                      className="pointer-events-none absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden bg-slate-200/90"
                      role="progressbar"
                      aria-valuetext="WMS 이미지 불러오는 중"
                    >
                      <div className="h-full w-[32%] bg-primary animate-safemap-wms-indeterminate" />
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {showFloodDepthLegend ? (
          <div
            className="shrink-0 border-t border-slate-200 bg-white px-3 py-2.5"
            aria-label="하천범람 침수심 범례"
          >
            <p className="mb-2 text-[11px] font-semibold text-slate-700">침수심 범례</p>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {FLOOD_DEPTH_LEGEND.map((row) => (
                <li key={row.label} className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="h-4 w-5 shrink-0 rounded-[3px] border border-slate-300/80 shadow-sm"
                    style={{ backgroundColor: row.color }}
                    aria-hidden
                  />
                  <span className="min-w-0 text-[11px] leading-snug text-slate-600">{row.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {showLandslideLegend ? (
          <div
            className="shrink-0 border-t border-slate-200 bg-white px-3 py-2.5"
            aria-label="산사태위험지도 범례"
          >
            <p className="mb-2 text-[11px] font-semibold text-slate-700">산사태위험지도 범례</p>
            <ul className="grid grid-cols-3 gap-x-2.5 gap-y-1.5">
              {LANDSLIDE_RISK_LEGEND.map((row) => (
                <li key={row.label} className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="h-4 w-5 shrink-0 rounded-[3px] border border-slate-300/80 shadow-sm"
                    style={{ backgroundColor: row.color }}
                    aria-hidden
                  />
                  <span className="min-w-0 text-[11px] leading-snug text-slate-600">{row.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {showFloodTraceLegend ? (
          <div
            className="shrink-0 border-t border-slate-200 bg-white px-3 py-2.5"
            aria-label="침수흔적도 침수심 범례"
          >
            <p className="mb-2 text-[11px] font-semibold text-slate-700">침수흔적도 범례 (침수심)</p>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {FLOOD_TRACE_DEPTH_LEGEND.map((row) => (
                <li key={row.label} className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="h-4 w-5 shrink-0 rounded-[3px] border border-slate-300/80 shadow-sm"
                    style={{ backgroundColor: row.color }}
                    aria-hidden
                  />
                  <span className="min-w-0 text-[11px] leading-snug text-slate-600">{row.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
