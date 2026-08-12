'use client';

/**
 * 변동이력 결과 — 살아 있는 OpenLayers 지도 (3차).
 * - 배경: 디스크 등록 자체 정사(선택일 이하 최근 연도) · 없으면 VWorld 항공
 * - 영역 WKT(5181) + sync_log as-of 시점 도형 + 당일 전·후(old/new) 겹침
 * - 선택 운영 레이어: 전용 ImageWMS 콤마 + 영역 INTERSECTS (메인 serviceLayer 미사용)
 * - 영역 fit은 영역이 바뀔 때만 (날짜 변경 시 좌표 고정)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import Feature from 'ol/Feature';
import WKT from 'ol/format/WKT';
import GeoJSON from 'ol/format/GeoJSON';
import type { Geometry } from 'ol/geom';
import Polygon from 'ol/geom/Polygon';
import type ImageLayer from 'ol/layer/Image';
import type ImageWMS from 'ol/source/ImageWMS';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { isEmpty } from 'ol/extent';
import { Fill, Stroke, Style, Circle as CircleStyle } from 'ol/style';
import type BaseLayer from 'ol/layer/Base';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import { Minus, Plus, Scan } from 'lucide-react';

import '../../_mapComponents/config/projections';
import {
  MAP_AUTO_NAV_MAX_ZOOM,
} from '../../_mapComponents/config/mapDefaults';
import {
  createBackgroundLayerById,
  createLocalOrthoTileLayer,
  isDynamicOrthoBackgroundId,
  isLocalOrthoBackgroundId,
  VWORLD_MAX_ZOOM_INDEX,
} from '../../_mapComponents/layerFactory/backgroundLayerFactory';
import {
  createParcelAnalysisMaskOuterRing,
  getParcelAnalysisExteriorRings,
  PARCEL_ANALYSIS_BOUNDARY_STROKE,
  PARCEL_ANALYSIS_BOUNDARY_STROKE_WIDTH,
  PARCEL_ANALYSIS_OUTSIDE_MASK_FILL,
  PARCEL_ANALYSIS_VWORLD_SATELLITE_URL,
} from '../parcelAnalysis/parcelAnalysis.mapStyle';
import { buildCompareFeatures, normalizeGeoJsonGeometry } from './changeHistory.compare';
import {
  prefetchCompareStyles,
  resolveCompareFeatureStyle,
} from './changeHistory.styleCache';
import type { ChangeHistoryAsOfFeature, ChangeHistoryDayDiffFeature } from './changeHistory.types';
import {
  applyChangeHistoryWmsParams,
  buildChangeHistoryWmsParams,
  CHANGE_HISTORY_WMS_DEBOUNCE_MS,
  createChangeHistoryWmsLayer,
} from './changeHistory.wms';
import {
  formatChangeHistoryBackgroundLabel,
} from './changeHistory.ortho';
import { Switch } from '@/app/shadcnComponents/ui/switch';

/** 스타일 실패 시에도 점은 보이게 — 변경 후(z=2)가 변경 전(z=1) 위 */
const EMERGENCY_POINT_AFTER = new Style({
  zIndex: 2,
  image: new CircleStyle({
    radius: 7,
    fill: new Fill({ color: 'rgba(37, 99, 235, 0.9)' }),
    stroke: new Stroke({ color: '#1d4ed8', width: 2 }),
  }),
});
const EMERGENCY_POINT_BEFORE = new Style({
  zIndex: 1,
  image: new CircleStyle({
    radius: 7,
    fill: new Fill({ color: 'rgba(156, 163, 175, 0.85)' }),
    stroke: new Stroke({ color: '#6b7280', width: 2 }),
  }),
});
const EMERGENCY_LINE_AFTER = new Style({
  zIndex: 2,
  stroke: new Stroke({ color: 'rgba(37, 99, 235, 0.95)', width: 3 }),
});
const EMERGENCY_LINE_BEFORE = new Style({
  zIndex: 1,
  stroke: new Stroke({ color: 'rgba(107, 114, 128, 0.85)', width: 2.5, lineDash: [8, 6] }),
});
const EMERGENCY_POLY_AFTER = new Style({
  zIndex: 2,
  fill: new Fill({ color: 'rgba(37, 99, 235, 0.25)' }),
  stroke: new Stroke({ color: 'rgba(37, 99, 235, 0.95)', width: 2 }),
});
const EMERGENCY_POLY_BEFORE = new Style({
  zIndex: 1,
  fill: new Fill({ color: 'rgba(156, 163, 175, 0.2)' }),
  stroke: new Stroke({ color: 'rgba(107, 114, 128, 0.85)', width: 2, lineDash: [6, 5] }),
});

/** 필지분석 캡처와 동일 — 영역이 화면에 크게 차도록 */
const MAP_FIT_PADDING: [number, number, number, number] = [20, 20, 20, 20];
/** 메인과 동일 — fit·자동 맞춤 19, 버튼·휠 수동 확대 20 */
const MAP_FIT_MAX_ZOOM = MAP_AUTO_NAV_MAX_ZOOM;
const VIEW_MAX_ZOOM = MAP_AUTO_NAV_MAX_ZOOM + 1;
const VIEW_MIN_ZOOM = 5;

const BOUNDARY_STYLE = new Style({
  stroke: new Stroke({
    color: PARCEL_ANALYSIS_BOUNDARY_STROKE,
    width: PARCEL_ANALYSIS_BOUNDARY_STROKE_WIDTH,
  }),
});

const OUTSIDE_MASK_STYLE = new Style({
  fill: new Fill({ color: PARCEL_ANALYSIS_OUTSIDE_MASK_FILL }),
});

function readGeom5181To3857(geom: { type: string; coordinates?: unknown }): Geometry | null {
  try {
    const type = geom.type;
    if (
      type !== 'Point' &&
      type !== 'Polygon' &&
      type !== 'LineString' &&
      type !== 'MultiPolygon' &&
      type !== 'MultiPoint' &&
      type !== 'MultiLineString'
    ) {
      return null;
    }
    const gj = new GeoJSON();
    const f = gj.readFeature(
      {
        type: 'Feature',
        geometry: { type, coordinates: geom.coordinates },
        properties: {},
      },
      { dataProjection: 'EPSG:5181', featureProjection: 'EPSG:3857' }
    );
    const feat = Array.isArray(f) ? f[0] : f;
    return feat.getGeometry() ?? null;
  } catch {
    return null;
  }
}

/**
 * 결과 모달 배경 — 필지분석 캡처와 동일 VWorld 항공 XYZ.
 * createParcelAnalysisBasemapSource의 연한 단색 폴백은 쓰지 않음(하얀 화면처럼 보임).
 */
function createResultBasemapBackground(): TileLayer<XYZ> {
  const layer = new TileLayer({
    source: new XYZ({
      url: PARCEL_ANALYSIS_VWORLD_SATELLITE_URL,
      crossOrigin: 'anonymous',
      maxZoom: VWORLD_MAX_ZOOM_INDEX,
      attributions: '© VWorld',
    }),
    zIndex: 0,
  });
  layer.set('name', 'changeHistoryBasemapBg');
  return layer;
}

/** 영역 바깥 검정 반투명 마스크 — pan/zoom 시에도 화면 전체를 덮도록 갱신 */
function updateOutsideMask(map: Map, areaGeom: Geometry | null, maskSource: VectorSource): void {
  maskSource.clear();
  if (!areaGeom) return;

  const holes = getParcelAnalysisExteriorRings(areaGeom);
  if (!holes.length) return;

  const view = map.getView();
  const center = view.getCenter();
  const resolution = view.getResolution();
  const size = map.getSize();
  if (!center || resolution == null || !size || size[0] < 2 || size[1] < 2) return;

  const outerRing = createParcelAnalysisMaskOuterRing(
    center as [number, number],
    resolution,
    [size[0], size[1]] as [number, number],
    2
  );
  maskSource.addFeature(
    new Feature({
      geometry: new Polygon([outerRing, ...holes]),
    })
  );
}

/** 지도 크기가 잡히기 전에 fit하면 해상도가 NaN이 되어 하얗게 남는다. */
function fitAreaWhenReady(map: Map, geom: Geometry): boolean {
  map.updateSize();
  const size = map.getSize();
  if (!size || size[0] < 2 || size[1] < 2) return false;
  const extent = geom.getExtent();
  if (isEmpty(extent)) return false;
  map.getView().fit(extent, {
    padding: MAP_FIT_PADDING,
    maxZoom: MAP_FIT_MAX_ZOOM,
    duration: 0,
  });
  return true;
}

/**
 * 등록된 자체 정사(satellite_YYYY* · aerial-YYYY 등) id.
 * 없으면 VWorld 항공영상.
 */
function pickChangeHistoryBackground(orthoMapId: string | null): {
  layer: BaseLayer;
  isBasemapFallback: boolean;
} {
  if (orthoMapId && isLocalOrthoBackgroundId(orthoMapId)) {
    // 동적 satellite_* 는 디스크 폴더명 = id — LS 없이 바로 타일 (메인 배경과 동일)
    if (isDynamicOrthoBackgroundId(orthoMapId)) {
      const layer = createLocalOrthoTileLayer(orthoMapId, '') as BaseLayer;
      layer.setZIndex(0);
      return { layer, isBasemapFallback: false };
    }
    const layer = createBackgroundLayerById(orthoMapId);
    if (layer) {
      layer.setZIndex(0);
      return { layer, isBasemapFallback: false };
    }
  }
  return { layer: createResultBasemapBackground(), isBasemapFallback: true };
}

export type ChangeHistoryLiveMapProps = {
  wkt5181: string | null;
  selectedDate: string;
  /** 디스크에서 고른 자체 정사 배경 id (없으면 VWorld) */
  orthoBackgroundMapId: string | null;
  /** 좌측 선택 레이어의 실 GeoServer 테이블명 (WMS 콤마) */
  wmsTableNames: string[];
  /** 서버 as-of 결과(없으면 빈 도형) */
  asOfFeatures?: ChangeHistoryAsOfFeature[];
  /** 선택일 당일 전·후 도형 — 변경 전 레이어 복원에 사용 */
  dayDiffFeatures?: ChangeHistoryDayDiffFeature[];
  /** 시점·변경 도형 조회 중 — 지도 위 가림 스피너 */
  mapLoading?: boolean;
  /** 실제 깐 배경 (정사 성공 여부) — 하단 요약과 맞춤 */
  onBackgroundResolved?: (info: { isOrtho: boolean; year: string | null }) => void;
  className?: string;
};

export function ChangeHistoryLiveMap({
  wkt5181,
  selectedDate,
  orthoBackgroundMapId,
  wmsTableNames,
  asOfFeatures: asOfFeaturesProp,
  dayDiffFeatures: dayDiffFeaturesProp,
  mapLoading = false,
  onBackgroundResolved,
  className,
}: ChangeHistoryLiveMapProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const areaGeomRef = useRef<Geometry | null>(null);
  const boundarySourceRef = useRef(new VectorSource());
  const maskSourceRef = useRef(new VectorSource());
  const featSourceRef = useRef(new VectorSource());
  const featLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const bgLayerRef = useRef<BaseLayer | null>(null);
  const wmsLayerRef = useRef<ImageLayer<ImageWMS> | null>(null);
  const fittedWktRef = useRef<string | null>(null);
  const didFitContentRef = useRef(false);
  const wmsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isBasemapFallback, setIsBasemapFallback] = useState(true);
  const [showBefore, setShowBefore] = useState(true);
  const [showAfter, setShowAfter] = useState(true);

  const asOfFeatures = asOfFeaturesProp ?? [];
  const dayDiffFeatures = dayDiffFeaturesProp ?? [];

  const wmsParams = useMemo(
    () =>
      buildChangeHistoryWmsParams({
        tableNames: wmsTableNames,
        areaWkt5181: wkt5181,
        selectedDate,
      }),
    [wmsTableNames, wkt5181, selectedDate]
  );

  useEffect(() => {
    const el = rootRef.current;
    if (!el || mapRef.current) return;

    const boundaryLayer = new VectorLayer({
      source: boundarySourceRef.current,
      style: BOUNDARY_STYLE,
      zIndex: 5,
    });
    const maskLayer = new VectorLayer({
      source: maskSourceRef.current,
      style: OUTSIDE_MASK_STYLE,
      zIndex: 4,
    });
    const featLayer = new VectorLayer({
      source: featSourceRef.current,
      /** 변경 후가 변경 전 위에 그려지도록 */
      renderOrder: (a, b) => {
        const sa = (a.get('compareSide') as string) === 'after' ? 1 : 0;
        const sb = (b.get('compareSide') as string) === 'after' ? 1 : 0;
        return sa - sb;
      },
      style: (f): Style => {
        const side = (f.get('compareSide') as 'before' | 'after' | undefined) ?? 'after';
        const gType = f.getGeometry()?.getType();
        // 점: SVG 404·Icon 실패가 많아 원으로 고정. 선·면은 GeoServer 색(실제 도형 종류 기준).
        if (gType === 'Point' || gType === 'MultiPoint') {
          return side === 'before' ? EMERGENCY_POINT_BEFORE : EMERGENCY_POINT_AFTER;
        }
        try {
          const table = String(f.get('tableName') ?? '');
          const styled = resolveCompareFeatureStyle(table, side, gType, () => {
            featLayer.changed();
          });
          if (styled instanceof Style) return styled;
          if (Array.isArray(styled) && styled[0] instanceof Style) return styled[0];
        } catch {
          // fall through
        }
        if (gType === 'Polygon' || gType === 'MultiPolygon') {
          return side === 'before' ? EMERGENCY_POLY_BEFORE : EMERGENCY_POLY_AFTER;
        }
        return side === 'before' ? EMERGENCY_LINE_BEFORE : EMERGENCY_LINE_AFTER;
      },
      zIndex: 10,
    });
    featLayerRef.current = featLayer;

    const wmsLayer = createChangeHistoryWmsLayer();
    wmsLayerRef.current = wmsLayer;

    const { layer: bg, isBasemapFallback: basemapFb } = pickChangeHistoryBackground(orthoBackgroundMapId);
    bg.set('name', 'changeHistoryBg');
    bg.setZIndex?.(0);
    bgLayerRef.current = bg;
    setIsBasemapFallback(basemapFb);

    const map = new Map({
      target: el,
      layers: [bg, wmsLayer, featLayer, maskLayer, boundaryLayer],
      view: new View({
        projection: 'EPSG:3857',
        center: [14135000, 4510000],
        zoom: 12,
        maxZoom: VIEW_MAX_ZOOM,
        minZoom: VIEW_MIN_ZOOM,
      }),
      controls: [],
      pixelRatio: 1,
    });
    mapRef.current = map;

    const syncMask = () => updateOutsideMask(map, areaGeomRef.current, maskSourceRef.current);
    const ensureMapSize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w < 2 || h < 2) return;
      map.updateSize();
      const geom = areaGeomRef.current;
      if (geom && !didFitContentRef.current) {
        if (fitAreaWhenReady(map, geom)) {
          didFitContentRef.current = true;
          fittedWktRef.current = wkt5181;
        }
      }
      syncMask();
    };

    map.on('moveend', syncMask);
    let disposed = false;
    const ensureMapSizeSafe = () => {
      if (disposed) return;
      ensureMapSize();
    };
    const rafId = requestAnimationFrame(ensureMapSizeSafe);
    const sizeTimerIds = [
      window.setTimeout(ensureMapSizeSafe, 50),
      window.setTimeout(ensureMapSizeSafe, 200),
      window.setTimeout(ensureMapSizeSafe, 500),
    ];

    const resizeObserver = new ResizeObserver(() => ensureMapSizeSafe());
    resizeObserver.observe(el);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      for (const id of sizeTimerIds) clearTimeout(id);
      resizeObserver.disconnect();
      if (wmsTimerRef.current) clearTimeout(wmsTimerRef.current);
      map.un('moveend', syncMask);
      map.setTarget(undefined);
      mapRef.current = null;
      bgLayerRef.current = null;
      wmsLayerRef.current = null;
      featLayerRef.current = null;
      areaGeomRef.current = null;
      boundarySourceRef.current.clear();
      maskSourceRef.current.clear();
      fittedWktRef.current = null;
      didFitContentRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const { layer: next, isBasemapFallback: basemapFb } = pickChangeHistoryBackground(orthoBackgroundMapId);
    next.set('name', 'changeHistoryBg');
    next.setZIndex?.(0);
    const layers = map.getLayers();
    const prev = bgLayerRef.current;
    if (prev) layers.remove(prev);
    layers.insertAt(0, next);
    bgLayerRef.current = next;
    setIsBasemapFallback(basemapFb);
  }, [orthoBackgroundMapId]);

  useEffect(() => {
    if (!onBackgroundResolved) return;
    const year = orthoBackgroundMapId
      ? (/^(?:satellite_|aerial-|high-res-)(\d{4})/i.exec(orthoBackgroundMapId)?.[1] ?? null)
      : null;
    onBackgroundResolved({
      isOrtho: !isBasemapFallback,
      year: isBasemapFallback ? null : year,
    });
  }, [isBasemapFallback, orthoBackgroundMapId, onBackgroundResolved]);

  // 3-5: GetMap 디바운스 — 발행 레이어 정의는 변경하지 않음
  // 시점 벡터(변경 전·후)가 있으면 운영 WMS는 숨김 — 최신본·이중 표시 혼선 방지
  // 조회 중(mapLoading)에도 WMS 숨김 — 운영본·구 도형 깜빡임 방지
  useEffect(() => {
    const layer = wmsLayerRef.current;
    if (!layer) return;
    const hideWms =
      mapLoading || asOfFeatures.length > 0 || dayDiffFeatures.length > 0;
    layer.setVisible(!hideWms);
    if (hideWms) return;
    if (wmsTimerRef.current) clearTimeout(wmsTimerRef.current);
    wmsTimerRef.current = setTimeout(() => {
      applyChangeHistoryWmsParams(layer, wmsParams);
    }, CHANGE_HISTORY_WMS_DEBOUNCE_MS);
    return () => {
      if (wmsTimerRef.current) clearTimeout(wmsTimerRef.current);
    };
  }, [wmsParams, asOfFeatures.length, dayDiffFeatures.length, mapLoading]);

  useEffect(() => {
    const map = mapRef.current;
    const boundarySource = boundarySourceRef.current;
    const maskSource = maskSourceRef.current;
    boundarySource.clear();
    maskSource.clear();
    areaGeomRef.current = null;

    if (!map || !wkt5181?.trim()) {
      fittedWktRef.current = null;
      didFitContentRef.current = false;
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    try {
      const format = new WKT();
      const geom = format.readGeometry(wkt5181, {
        dataProjection: 'EPSG:5181',
        featureProjection: 'EPSG:3857',
      });
      areaGeomRef.current = geom;
      boundarySource.addFeature(new Feature({ geometry: geom }));

      const tryFit = () => {
        if (cancelled) return;
        updateOutsideMask(map, geom, maskSource);
        if (fittedWktRef.current === wkt5181 && didFitContentRef.current) return;
        if (fitAreaWhenReady(map, geom)) {
          didFitContentRef.current = true;
          fittedWktRef.current = wkt5181;
          updateOutsideMask(map, geom, maskSource);
          return;
        }
        if (attempts++ >= 40) return;
        retryTimer = setTimeout(tryFit, 120);
      };
      tryFit();
    } catch {
      areaGeomRef.current = null;
      fittedWktRef.current = null;
      didFitContentRef.current = false;
    }

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [wkt5181]);

  useEffect(() => {
    const source = featSourceRef.current;
    source.clear();
    let compareRows = buildCompareFeatures(asOfFeatures, dayDiffFeatures);

    // asOf 는 있는데 비교 목록이 비면(정규화·키 누락 등) 변경 후로라도 표시
    if (compareRows.length === 0 && asOfFeatures.length > 0 && showAfter) {
      asOfFeatures.forEach((f, index) => {
        const table = String(f.tableName ?? '').trim();
        const key = String(f.keyValue ?? '').trim();
        const geom = normalizeGeoJsonGeometry(f.geom);
        if (!geom?.type) return;
        compareRows.push({
          tableName: table || 'unknown',
          keyField: f.keyField,
          // length 기반 fallback은 push로 length가 바뀌며 충돌·불안정 — 원본 인덱스로 고정
          keyValue: key || `__noid:${index}`,
          side: 'after',
          geom,
        });
      });
    }

    const tables = [...new Set(compareRows.map((r) => r.tableName).filter(Boolean))];
    void prefetchCompareStyles(tables).then(() => {
      featLayerRef.current?.changed();
    });

    for (const row of compareRows) {
      if (row.side === 'before' && !showBefore) continue;
      if (row.side === 'after' && !showAfter) continue;
      const geom = normalizeGeoJsonGeometry(row.geom) ?? row.geom;
      const g = readGeom5181To3857(geom);
      if (!g) continue;
      const f = new Feature({ geometry: g });
      f.setId(`${row.side}:${row.tableName}:${row.keyValue}`);
      f.set('compareSide', row.side);
      f.set('tableName', row.tableName);
      source.addFeature(f);
    }
  }, [asOfFeatures, dayDiffFeatures, showBefore, showAfter]);

  const zoomBy = (delta: number) => {
    const view = mapRef.current?.getView();
    if (!view) return;
    const z = view.getZoom() ?? 12;
    view.animate({
      zoom: Math.min(VIEW_MAX_ZOOM, Math.max(VIEW_MIN_ZOOM, z + delta)),
      duration: 150,
    });
  };

  /** 분석 영역만 맞춤 — 시점 도형 미포함 */
  const fitToArea = () => {
    const map = mapRef.current;
    if (!map) return;
    const geom = areaGeomRef.current;
    if (!geom) return;
    const extent = geom.getExtent();
    if (isEmpty(extent)) return;
    map.getView().fit(extent, {
      padding: MAP_FIT_PADDING,
      maxZoom: MAP_FIT_MAX_ZOOM,
      duration: 250,
    });
  };
  const canFitArea = Boolean(wkt5181?.trim());

  const orthoYear = orthoBackgroundMapId
    ? (() => {
        const m = /(?:satellite_|aerial-|high-res-)(\d{4})/i.exec(orthoBackgroundMapId);
        return m?.[1] ?? null;
      })()
    : null;
  const statusLine = formatChangeHistoryBackgroundLabel(!isBasemapFallback, orthoYear);
  return (
    <div
      className={
        className ??
        'relative min-h-[320px] flex-1 overflow-hidden rounded-md border border-border bg-[#1a1a1a]'
      }
    >
      <div ref={rootRef} className="absolute inset-0" />
      <div className="absolute left-2.5 top-2.5 z-[1] flex flex-col gap-1.5 rounded-md border border-border/60 bg-background/95 px-2.5 py-2 shadow-sm">
        <label className="flex items-center justify-between gap-3 text-[11px] text-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-slate-400" aria-hidden />
            변경 전
          </span>
          <Switch
            checked={showBefore}
            onCheckedChange={setShowBefore}
            title="변경 전 레이어 표시"
            aria-label="변경 전 레이어 표시"
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-[11px] text-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded-sm bg-blue-600" aria-hidden />
            변경 후
          </span>
          <Switch
            checked={showAfter}
            onCheckedChange={setShowAfter}
            title="변경 후 레이어 표시"
            aria-label="변경 후 레이어 표시"
          />
        </label>
      </div>
      <div className="absolute right-2.5 top-2.5 z-[1] flex flex-col gap-1">
        <button
          type="button"
          aria-label="확대"
          title="확대"
          className="flex size-7 items-center justify-center rounded border border-border bg-background/95 text-foreground shadow-sm hover:bg-muted/60"
          onClick={() => zoomBy(1)}
        >
          <Plus className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="축소"
          title="축소"
          className="flex size-7 items-center justify-center rounded border border-border bg-background/95 text-foreground shadow-sm hover:bg-muted/60"
          onClick={() => zoomBy(-1)}
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="분석 영역으로 이동"
          title="분석 영역으로"
          disabled={!canFitArea}
          className="flex size-7 items-center justify-center rounded border border-border bg-background/95 text-foreground shadow-sm hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={fitToArea}
        >
          <Scan className="size-3.5" />
        </button>
      </div>
      <div className="pointer-events-none absolute bottom-2.5 right-2.5 z-[1]">
        <div className="rounded bg-black/70 px-2 py-1 text-[11px] text-white/85">{statusLine}</div>
      </div>
      {mapLoading ? (
        <div
          className="absolute inset-0 z-[2] flex items-center justify-center bg-black/45"
          role="status"
          aria-live="polite"
          aria-label="지도 불러오는 중"
        >
          <div className="flex flex-col items-center gap-2 rounded-md bg-background/95 px-4 py-3 shadow-sm">
            <div
              className="size-8 animate-spin rounded-full border-2 border-border border-t-primary"
              aria-hidden
            />
            <span className="text-[12px] text-foreground">불러오는 중…</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
