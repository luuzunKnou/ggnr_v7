'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import dynamic from 'next/dynamic';
import type ImageWrapper from 'ol/Image';
import type OlMapType from 'ol/Map';
import { Map as OlMap, View } from 'ol';
import type { Geometry } from 'ol/geom';
import Polygon from 'ol/geom/Polygon';
import MultiPolygon from 'ol/geom/MultiPolygon';
import ImageLayer from 'ol/layer/Image';
import TileLayer from 'ol/layer/Tile';
import type BaseLayer from 'ol/layer/Base';
import { ImageWMS, type XYZ } from 'ol/source';
import { PARCEL_ANALYSIS_BASEMAP_TILE_TIMEOUT_MS } from '@/lib/parcelAnalysisTheme';
import { fromString } from 'ol/transform';
import { isCanvas } from 'ol/dom';
import { getCenter } from 'ol/extent';
import {
  PARCEL_ANALYSIS_BOUNDARY_STROKE,
  PARCEL_ANALYSIS_BOUNDARY_STROKE_WIDTH,
  PARCEL_ANALYSIS_CAPTURE_PROJECTION,
  PARCEL_ANALYSIS_MAP_FIT_PADDING,
  PARCEL_ANALYSIS_MAP_MAX_ZOOM,
  PARCEL_ANALYSIS_OUTSIDE_MASK_FILL,
  PARCEL_ANALYSIS_VWORLD_BASE_URL,
  PARCEL_ANALYSIS_VWORLD_SATELLITE_URL,
  createParcelAnalysisBasemapSource,
  createParcelAnalysisStaticMapOptions,
  readParcelAnalysisCaptureGeometry,
  resolveBasicMapLayersForCapture,
  toCaptureDisplayGeometry,
} from './parcelAnalysis.mapStyle';
import '@/app/(pages)/map/_mapComponents/config/projections';
import { sortLayerNamesForWmsStack, type LayerDbGeometryKind } from '@/lib/mapLayerGeometryOrder';

/** 숨김 OL 지도 캡처 해상도 */
export const PARCEL_ANALYSIS_CAPTURE_SIZE: [number, number] = [900, 400];


export type ParcelAnalysisCaptureHomeView = {
  center: [number, number];
  resolution: number;
  zoom: number;
  displayGeom: Geometry;
};

const homeViewCache = new Map<string, ParcelAnalysisCaptureHomeView>();

/**
 * 동일 분석 WKT에 대해 모든 캡처가 같은 중심·줌을 쓰도록 고정한다.
 * 여백은 최소(fit padding)만 두어 분석 영역이 화면에 가득 차게 한다.
 */
export function resolveParcelAnalysisCaptureHomeView(wkt5181: string): ParcelAnalysisCaptureHomeView {
  const key = wkt5181.trim();
  const cached = homeViewCache.get(key);
  if (cached) return cached;

  const displayGeom = toCaptureDisplayGeometry(readParcelAnalysisCaptureGeometry(key));
  const extent = displayGeom.getExtent();
  const view = new View({ projection: PARCEL_ANALYSIS_CAPTURE_PROJECTION });
  view.fit(extent, {
    size: PARCEL_ANALYSIS_CAPTURE_SIZE,
    padding: PARCEL_ANALYSIS_MAP_FIT_PADDING,
    maxZoom: PARCEL_ANALYSIS_MAP_MAX_ZOOM,
  });

  const center = (view.getCenter() as [number, number] | undefined) ?? (getCenter(extent) as [number, number]);
  const home: ParcelAnalysisCaptureHomeView = {
    center,
    resolution: view.getResolution() ?? 1,
    zoom: view.getZoom() ?? PARCEL_ANALYSIS_MAP_MAX_ZOOM,
    displayGeom,
  };
  homeViewCache.set(key, home);
  return home;
}

/** 디코드 실패·WMS 오류 응답 시 빈 타일 대체 — Next 개발 오버레이 EncodingError 방지 */
export const MAP_CAPTURE_TRANSPARENT_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ZQAAAAASUVORK5CYII=';

async function isWmsErrorPayload(blob: Blob): Promise<boolean> {
  const head = await blob.slice(0, Math.min(blob.size, 512)).text();
  return /ServiceException|ExceptionReport|InternalError|Rendering process failed/i.test(head);
}

async function isImageBlob(blob: Blob): Promise<boolean> {
  if (blob.size < 4) return false;
  const head = await blob.slice(0, 4).arrayBuffer();
  const bytes = new Uint8Array(head);
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return true;
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return true;
  return false;
}

function applyTransparent(img: HTMLImageElement): void {
  try {
    img.removeAttribute('crossorigin');
    img.src = MAP_CAPTURE_TRANSPARENT_PNG;
  } catch {
    /* ignore */
  }
}

async function applyValidatedImageBlob(img: HTMLImageElement, blob: Blob, onFail?: () => void): Promise<void> {
  const fallback = () => {
    onFail?.();
    applyTransparent(img);
  };
  if (await isWmsErrorPayload(blob)) {
    fallback();
    return;
  }
  if (!(await isImageBlob(blob))) {
    fallback();
    return;
  }
  const blobUrl = URL.createObjectURL(blob);
  img.crossOrigin = 'anonymous';
  img.onload = () => URL.revokeObjectURL(blobUrl);
  img.onerror = () => {
    URL.revokeObjectURL(blobUrl);
    fallback();
  };
  img.src = blobUrl;
}

/** fetch → 매직바이트 검증 후에만 img에 반영 (배경 타일용) */
export async function loadMapCaptureImage(
  img: HTMLImageElement,
  src: string,
  onFail?: () => void
): Promise<void> {
  const fallback = () => {
    onFail?.();
    applyTransparent(img);
  };

  if (!src || src.startsWith('data:')) {
    fallback();
    return;
  }

  try {
    const res = await fetch(src, { method: 'GET', cache: 'no-store', mode: 'cors' });
    if (!res.ok) {
      fallback();
      return;
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (/xml|text\/html|text\/plain/i.test(contentType)) {
      fallback();
      return;
    }
    await applyValidatedImageBlob(img, await res.blob(), onFail);
  } catch {
    fallback();
  }
}

export type WmsCaptureFailKind =
  | 'network'
  | 'layer_not_defined'
  | 'style_not_defined'
  | 'service_exception'
  | 'invalid_response';

export type WmsCaptureLoadResult =
  | { ok: true }
  | { ok: false; kind: WmsCaptureFailKind };

function classifyWmsErrorText(text: string): WmsCaptureFailKind {
  if (/LayerNotDefined/i.test(text)) return 'layer_not_defined';
  if (/StyleNotDefined/i.test(text)) return 'style_not_defined';
  if (/ServiceException|ExceptionReport|Rendering process failed/i.test(text)) {
    return 'service_exception';
  }
  return 'invalid_response';
}

function formatWmsCaptureNotice(
  failed: Array<{ key: string; kind: WmsCaptureFailKind }>,
  totalRequested: number
): string {
  if (!failed.length) return '';
  const groups: Record<WmsCaptureFailKind, string[]> = {
    layer_not_defined: [],
    style_not_defined: [],
    network: [],
    service_exception: [],
    invalid_response: [],
  };
  for (const f of failed) groups[f.kind].push(f.key);
  const label: Record<WmsCaptureFailKind, string> = {
    layer_not_defined: '미등록',
    style_not_defined: '스타일 없음',
    network: '네트워크',
    service_exception: '서버 오류',
    invalid_response: '응답 오류',
  };
  const parts = (Object.keys(groups) as WmsCaptureFailKind[])
    .filter((k) => groups[k].length > 0)
    .map((k) => `${label[k]}: ${groups[k].join(', ')}`);
  const detail = parts.join(' · ');
  if (failed.length >= totalRequested) {
    return `GeoServer 레이어를 불러오지 못했습니다 (${detail}). 위 지도는 항공·분석영역만 표시됩니다.`;
  }
  return `일부 레이어를 지도에 그리지 못했습니다 (${detail}). 나머지는 표시됩니다.`;
}

/** WMS GetMap — POST 전송 (레이어별 1회, 실패 종류 구분) */
export async function loadWmsCapturePost(
  img: HTMLImageElement,
  src: string,
  onFail?: (kind: WmsCaptureFailKind) => void,
  networkRetries = 2
): Promise<WmsCaptureLoadResult> {
  const fail = (kind: WmsCaptureFailKind): WmsCaptureLoadResult => {
    onFail?.(kind);
    applyTransparent(img);
    return { ok: false, kind };
  };

  if (!src || src.startsWith('data:')) {
    return fail('invalid_response');
  }

  type Once = { status: 'ok' } | { status: 'retry' } | { status: 'fail'; kind: WmsCaptureFailKind };

  const postOnce = async (): Promise<Once> => {
    try {
      const url = new URL(src);
      const baseUrl = url.origin + url.pathname;
      const body = url.search.startsWith('?') ? url.search.slice(1) : url.search;
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        cache: 'no-store',
      });
      if (!res.ok) return { status: 'retry' };
      const contentType = res.headers.get('content-type') ?? '';
      const blob = await res.blob();
      if (/xml|text\/html|text\/plain/i.test(contentType) || (await isWmsErrorPayload(blob))) {
        const text = await blob.slice(0, 800).text();
        return { status: 'fail', kind: classifyWmsErrorText(text) };
      }
      if (!(await isImageBlob(blob))) {
        return { status: 'fail', kind: 'invalid_response' };
      }
      const blobUrl = URL.createObjectURL(blob);
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => {
          URL.revokeObjectURL(blobUrl);
          resolve();
        };
        img.onerror = () => {
          URL.revokeObjectURL(blobUrl);
          reject(new Error('img'));
        };
        img.src = blobUrl;
      });
      return { status: 'ok' };
    } catch {
      return { status: 'retry' };
    }
  };

  let left = networkRetries;
  while (true) {
    const result = await postOnce();
    if (result.status === 'ok') return { ok: true };
    if (result.status === 'fail') return fail(result.kind);
    if (left <= 0) return fail('network');
    left -= 1;
  }
}

/**
 * OL 지도 뷰포트의 레이어별 canvas를 transform까지 반영해 한 장으로 합성한다.
 * OpenLayers Composite 렌더러와 동일한 방식.
 */
export function compositeOpenLayersMapToCanvas(
  map: OlMapType,
  targetCanvas: HTMLCanvasElement
): boolean {
  const size = map.getSize();
  if (!size) return false;
  const [width, height] = size;
  targetCanvas.width = width;
  targetCanvas.height = height;
  const ctx = targetCanvas.getContext('2d');
  if (!ctx) return false;

  const layersRoot = map.getViewport().querySelector('.ol-layers');
  if (!layersRoot) return false;

  ctx.globalCompositeOperation = 'source-over';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);

  let drew = false;
  for (const container of layersRoot.children) {
    const element = container as HTMLElement;
    const canvas = (element.firstElementChild ?? element) as HTMLCanvasElement;

    const backgroundColor = element.style.backgroundColor;
    if (backgroundColor) {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, width, height);
    }

    if (!isCanvas(canvas) || !canvas.width || !canvas.height) continue;

    const opacity = element.style.opacity || canvas.style.opacity;
    ctx.globalAlpha = opacity === '' ? 1 : Number(opacity);

    const transform = canvas.style.transform;
    if (transform) {
      const matrix = fromString(transform);
      if (matrix.length === 6) {
        ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
      }
    } else {
      const w = parseFloat(canvas.style.width) / canvas.width;
      const h = parseFloat(canvas.style.height) / canvas.height;
      ctx.setTransform(
        Number.isFinite(w) && w > 0 ? w : 1,
        0,
        0,
        Number.isFinite(h) && h > 0 ? h : 1,
        0,
        0
      );
    }

    ctx.drawImage(canvas, 0, 0);
    drew = true;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  return drew;
}

function forEachExteriorRing(geom: Geometry, fn: (ring: number[][]) => void): void {
  if (geom instanceof Polygon) {
    const ring = geom.getCoordinates()[0];
    if (ring) fn(ring as number[][]);
    return;
  }
  if (geom instanceof MultiPolygon) {
    for (const poly of geom.getCoordinates()) {
      const ring = poly[0];
      if (ring) fn(ring as number[][]);
    }
  }
}

function strokePixelRing(
  ctx: CanvasRenderingContext2D,
  map: OlMapType,
  ring: number[][],
  closed = true
): void {
  ring.forEach((coord, index) => {
    const pixel = map.getPixelFromCoordinate(coord);
    if (!pixel) return;
    if (index === 0) ctx.moveTo(pixel[0], pixel[1]);
    else ctx.lineTo(pixel[0], pixel[1]);
  });
  if (closed) ctx.closePath();
}

/**
 * v6 MapCapture와 같이 픽셀 좌표로 마스크·노란 외곽선을 합성한다.
 * OL 벡터 레이어 대신 2D canvas에 그려 WMS·타일과 어긋남을 줄인다.
 */
export function paintParcelAnalysisCaptureOverlay(
  map: OlMapType,
  targetCanvas: HTMLCanvasElement,
  displayGeom: Geometry
): void {
  const ctx = targetCanvas.getContext('2d');
  if (!ctx) return;

  const overlay = document.createElement('canvas');
  overlay.width = targetCanvas.width;
  overlay.height = targetCanvas.height;
  const overlayCtx = overlay.getContext('2d');
  if (!overlayCtx) return;

  overlayCtx.fillStyle = PARCEL_ANALYSIS_OUTSIDE_MASK_FILL;
  overlayCtx.fillRect(0, 0, overlay.width, overlay.height);
  overlayCtx.globalCompositeOperation = 'destination-out';
  overlayCtx.beginPath();
  forEachExteriorRing(displayGeom, (ring) => strokePixelRing(overlayCtx, map, ring));
  overlayCtx.fill();

  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(overlay, 0, 0);

  ctx.beginPath();
  forEachExteriorRing(displayGeom, (ring) => strokePixelRing(ctx, map, ring));
  ctx.strokeStyle = PARCEL_ANALYSIS_BOUNDARY_STROKE;
  ctx.lineWidth = PARCEL_ANALYSIS_BOUNDARY_STROKE_WIDTH;
  ctx.stroke();
}

type MapCaptureProps = {
  wkt5181: string;
  geoserverUrl: string;
  workspace: string;
  /** 기본도 선택 id (basicMap:* ) */
  layerIds?: string[];
  /** 시설목록 그룹 GeoServer 레이어명 */
  wmsLayerKeys?: string[];
  /** WMS 적층 순서(면→선→점)용 */
  wmsLayerGeomTypes?: Record<string, LayerDbGeometryKind>;
  /** 시설목록은 v6처럼 항공영상 배경 */
  showSatellite?: boolean;
  /** WMS·캡처 실패 시 아무것도 렌더하지 않음 (시설목록) */
  hideOnFailure?: boolean;
};

const WMS_EXCEPTIONS = 'application/vnd.ogc.se_xml';
const WMS_VIEWPORT_RATIO = 1;
/** 타일 단색 폴백(8s) 이후 여유를 두고 최종 합성 */
/** 레이어별 WMS 병렬 로드 여유 (기본 타일 타임아웃 이후) */
const CAPTURE_FALLBACK_MS = PARCEL_ANALYSIS_BASEMAP_TILE_TIMEOUT_MS + 8_000;
const BASEMAP_TILE_IDLE_MS = 200;

/**
 * 배경 타일 로드가 끝난 뒤 합성한다.
 * WMS만 기다리면 rendercomplete가 타일보다 먼저 올라 빈 canvas가 고정될 수 있다.
 */
function waitForBasemapTiles(
  source: XYZ | null,
  map: OlMap,
  onReady: () => void,
  maxWaitMs: number
): () => void {
  if (!source) {
    onReady();
    return () => {};
  }
  const tileSource = source;

  let pending = 0;
  let done = false;
  let idleTimer = 0;
  const maxTimer = window.setTimeout(finish, maxWaitMs);

  function finish() {
    if (done) return;
    done = true;
    if (idleTimer) window.clearTimeout(idleTimer);
    window.clearTimeout(maxTimer);
    tileSource.un('tileloadstart', onStart);
    tileSource.un('tileloadend', onEnd);
    tileSource.un('tileloaderror', onEnd);
    onReady();
  }

  function onStart() {
    pending += 1;
  }

  function onEnd() {
    pending = Math.max(0, pending - 1);
    if (idleTimer) window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      if (pending <= 0) finish();
    }, BASEMAP_TILE_IDLE_MS);
  }

  tileSource.on('tileloadstart', onStart);
  tileSource.on('tileloadend', onEnd);
  tileSource.on('tileloaderror', onEnd);

  map.renderSync();
  idleTimer = window.setTimeout(() => {
    if (pending <= 0) finish();
  }, BASEMAP_TILE_IDLE_MS);

  return finish;
}

function resolveGeoServerBase(configUrl: string): string {
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8080/geoserver`;
  }
  return configUrl.replace(/\/$/, '') || 'http://localhost:8080/geoserver';
}

function useMapCaptureWhenVisible(rootRef: RefObject<HTMLDivElement | null>) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || visible) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisible(true);
      },
      { rootMargin: '400px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootRef, visible]);

  return visible;
}

function ParcelAnalysisMapCaptureInner({
  wkt5181,
  layerIds,
  wmsLayerKeys,
  wmsLayerGeomTypes,
  showSatellite,
  hideOnFailure,
  geoserverUrl,
  workspace,
}: MapCaptureProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [wmsNotice, setWmsNotice] = useState<string | null>(null);
  const [captureVisible, setCaptureVisible] = useState<boolean | null>(hideOnFailure ? null : true);
  const [preparing, setPreparing] = useState(true);
  const visible = useMapCaptureWhenVisible(rootRef);
  const lastCaptureSessionRef = useRef<string | null>(null);

  const captureKey = [
    layerIds?.join('|') ?? '',
    wmsLayerKeys?.join('|') ?? '',
    showSatellite ? 'sat' : '',
    Object.entries(wmsLayerGeomTypes ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join('|'),
  ].join(';');
  const captureSessionKey = `${wkt5181.trim()}|${captureKey}`;

  useEffect(() => {
    if (!visible) return;
    if (lastCaptureSessionRef.current === captureSessionKey) return;

    setWmsNotice(null);
    setPreparing(true);
    if (hideOnFailure) setCaptureVisible(null);

    const basicDefs = layerIds?.length ? resolveBasicMapLayersForCapture(layerIds) : [];
    const basicWmsKeys = basicDefs.filter((d) => d.wmsLayer).map((d) => d.wmsLayer!);
    const facilityKeys = (wmsLayerKeys ?? []).filter((key) => key.trim().length > 0);
    const useSatellite = showSatellite ?? basicDefs.some((d) => d.showSatellite);
    const wmsKeys = facilityKeys.length
      ? sortLayerNamesForWmsStack(facilityKeys, wmsLayerGeomTypes ?? {})
      : sortLayerNamesForWmsStack(basicWmsKeys, {});
    const hasRenderable = useSatellite || wmsKeys.length > 0 || basicDefs.length > 0;
    if (!hasRenderable || !wkt5181.trim()) {
      setPreparing(false);
      return;
    }

    const mapContainer = document.createElement('div');
    mapContainer.style.width = `${PARCEL_ANALYSIS_CAPTURE_SIZE[0]}px`;
    mapContainer.style.height = `${PARCEL_ANALYSIS_CAPTURE_SIZE[1]}px`;
    // fixed + 화면 밖 — visibility:hidden은 canvas 미렌더 원인 → opacity만 사용
    mapContainer.style.position = 'fixed';
    mapContainer.style.left = '-10000px';
    mapContainer.style.top = '0';
    mapContainer.style.opacity = '0';
    mapContainer.style.pointerEvents = 'none';
    mapContainer.style.zIndex = '-1';
    mapContainer.setAttribute('data-parcel-map-capture', 'true');
    document.body.appendChild(mapContainer);

    let map: OlMap | null = null;
    let cancelled = false;
    let composed = false;
    let fallbackTimer = 0;
    let disposeTileWait: (() => void) | null = null;
    let wmsReady = false;
    let tilesReady = false;
    const wmsFailures: Array<{ key: string; kind: WmsCaptureFailKind }> = [];
    let wmsPending = 0;

    const teardownMap = () => {
      if (map) {
        map.setTarget(undefined);
        map = null;
      }
      if (mapContainer.parentNode) document.body.removeChild(mapContainer);
    };

    const finishCapture = () => {
      if (cancelled || composed || !map) return;
      composed = true;
      if (fallbackTimer) window.clearTimeout(fallbackTimer);

      const canvas = canvasRef.current;
      const home = resolveParcelAnalysisCaptureHomeView(wkt5181);
      if (!canvas) {
        if (hideOnFailure) setCaptureVisible(false);
        setPreparing(false);
        teardownMap();
        return;
      }

      map.renderSync();
      const ok = compositeOpenLayersMapToCanvas(map, canvas);
      if (!ok) {
        if (hideOnFailure) setCaptureVisible(false);
        else setWmsNotice('지도 이미지를 합성하지 못했습니다.');
        setPreparing(false);
        teardownMap();
        return;
      }

      paintParcelAnalysisCaptureOverlay(map, canvas, home.displayGeom);
      if (hideOnFailure) setCaptureVisible(true);
      lastCaptureSessionRef.current = captureSessionKey;
      setPreparing(false);
      if (wmsFailures.length > 0 && !hideOnFailure) {
        setWmsNotice(formatWmsCaptureNotice(wmsFailures, wmsKeys.length));
      }
      teardownMap();
    };

    const tryScheduleCompose = () => {
      if (cancelled || composed || !map || !wmsReady || !tilesReady) return;
      map.once('rendercomplete', finishCapture);
      map.renderSync();
    };

    const markOneWmsDone = () => {
      wmsPending = Math.max(0, wmsPending - 1);
      if (wmsPending <= 0) {
        wmsReady = true;
        tryScheduleCompose();
      }
    };

    try {
      const home = resolveParcelAnalysisCaptureHomeView(wkt5181);
      const view = new View({
        projection: PARCEL_ANALYSIS_CAPTURE_PROJECTION,
        center: home.center,
        resolution: home.resolution,
      });

      const basemapSource = createParcelAnalysisBasemapSource(
        useSatellite ? PARCEL_ANALYSIS_VWORLD_SATELLITE_URL : PARCEL_ANALYSIS_VWORLD_BASE_URL
      );
      const layers: BaseLayer[] = [new TileLayer({ source: basemapSource })];

      const wmsKeysLower = wmsKeys.map((k) => k.toLowerCase());
      if (wmsKeysLower.length > 0) {
        const wmsBase = `${resolveGeoServerBase(geoserverUrl)}/${workspace}/wms`;
        wmsPending = wmsKeysLower.length;
        for (const key of wmsKeysLower) {
          const wmsLayer = new ImageLayer({
            source: new ImageWMS({
              url: wmsBase,
              params: {
                LAYERS: `${workspace}:${key}`,
                STYLES: key,
                VERSION: '1.1.1',
                EXCEPTIONS: WMS_EXCEPTIONS,
                TRANSPARENT: true,
              },
              serverType: 'geoserver',
              ratio: WMS_VIEWPORT_RATIO,
              imageLoadFunction: (image: ImageWrapper, src: string) => {
                const img = image.getImage() as HTMLImageElement;
                void loadWmsCapturePost(img, src).then((result) => {
                  if (cancelled) return;
                  if (!result.ok) {
                    wmsFailures.push({ key, kind: result.kind });
                  }
                  markOneWmsDone();
                });
              },
            }),
          });
          layers.push(wmsLayer);
        }
      }

      map = new OlMap({
        target: mapContainer,
        layers,
        view,
        pixelRatio: 1,
        ...createParcelAnalysisStaticMapOptions(),
      });
      map.updateSize();

      wmsReady = wmsPending === 0;
      disposeTileWait = waitForBasemapTiles(
        basemapSource,
        map,
        () => {
          if (cancelled) return;
          tilesReady = true;
          tryScheduleCompose();
        },
        PARCEL_ANALYSIS_BASEMAP_TILE_TIMEOUT_MS + 2_000
      );

      if (wmsPending > 0) {
        map.renderSync();
      }

      fallbackTimer = window.setTimeout(finishCapture, CAPTURE_FALLBACK_MS);
    } catch {
      queueMicrotask(() => {
        if (cancelled) return;
        if (hideOnFailure) setCaptureVisible(false);
        else setWmsNotice('분석 영역 지도 캡처에 실패했습니다.');
        setPreparing(false);
      });
      teardownMap();
    }

    return () => {
      cancelled = true;
      disposeTileWait?.();
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      teardownMap();
    };
  }, [visible, captureSessionKey, geoserverUrl, workspace, hideOnFailure]);

  if (hideOnFailure && captureVisible === false) return null;

  return (
    <div
      ref={rootRef}
      className={hideOnFailure && captureVisible !== true ? 'h-0 overflow-hidden opacity-0' : undefined}
      aria-hidden={hideOnFailure && captureVisible !== true ? true : undefined}
    >
      <canvas
        ref={canvasRef}
        className="my-2 max-w-full rounded border border-border bg-muted"
        style={{
          width: '100%',
          height: 'auto',
          aspectRatio: `${PARCEL_ANALYSIS_CAPTURE_SIZE[0]} / ${PARCEL_ANALYSIS_CAPTURE_SIZE[1]}`,
        }}
      />
      {visible && preparing ? (
        <p className="mb-2 text-[11px] text-muted-foreground">지도 캡처 준비 중…</p>
      ) : !preparing && wmsNotice ? (
        <p className="mb-2 text-[11px] text-amber-700 dark:text-amber-300">{wmsNotice}</p>
      ) : null}
    </div>
  );
}

export const ParcelAnalysisMapCapture = dynamic(
  () => Promise.resolve({ default: ParcelAnalysisMapCaptureInner }),
  { ssr: false }
);
