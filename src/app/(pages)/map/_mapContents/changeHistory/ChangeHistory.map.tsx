'use client';

/**
 * 변동이력 결과 — 살아 있는 OpenLayers 지도.
 * - 배경: 디스크 등록 자체 정사(선택일 이하 최근 연도) · 없으면 VWorld 항공
 * - 영역 WKT(5181) + sync_log as-of 시점 도형 + 당일 전·후(old/new) 겹침
 * - 운영 WMS(최신본)는 쓰지 않음 — 이력 벡터만 (빈 날이면 빈 지도)
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
  formatChangeHistoryBackgroundLabel,
} from './changeHistory.ortho';
import { Switch } from '@/app/shadcnComponents/ui/switch';

const EMPTY_ASOF: ChangeHistoryAsOfFeature[] = [];
const EMPTY_DAY_DIFF: ChangeHistoryDayDiffFeature[] = [];

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
    fill: new Fill({ color: 'rgba(203, 213, 225, 0.85)' }),
    stroke: new Stroke({ color: '#111111', width: 2.5 }),
  }),
});
const EMERGENCY_LINE_AFTER = new Style({
  zIndex: 2,
  stroke: new Stroke({ color: 'rgba(37, 99, 235, 0.95)', width: 3 }),
});
const EMERGENCY_LINE_BEFORE = new Style({
  zIndex: 1,
  stroke: new Stroke({ color: 'rgba(17, 17, 17, 1)', width: 4, lineDash: [8, 6] }),
});
const EMERGENCY_POLY_AFTER = new Style({
  zIndex: 2,
  fill: new Fill({ color: 'rgba(37, 99, 235, 0.25)' }),
  stroke: new Stroke({ color: 'rgba(37, 99, 235, 0.95)', width: 2 }),
});
const EMERGENCY_POLY_BEFORE = new Style({
  zIndex: 1,
  fill: new Fill({ color: 'rgba(203, 213, 225, 0.5)' }),
  stroke: new Stroke({ color: 'rgba(17, 17, 17, 1)', width: 3.5, lineDash: [6, 5] }),
});

/** 읍면·리 행정경계 — 면 채우면 분석 영역을 덮어 건물 등이 안 보임. 테두리만. */
const ADMIN_OUTLINE_AFTER = new Style({
  zIndex: 3,
  fill: new Fill({ color: 'rgba(0,0,0,0)' }),
  stroke: new Stroke({ color: 'rgba(37, 99, 235, 0.95)', width: 2.5 }),
});
const ADMIN_OUTLINE_BEFORE = new Style({
  zIndex: 2,
  fill: new Fill({ color: 'rgba(0,0,0,0)' }),
  stroke: new Stroke({ color: 'rgba(17, 17, 17, 1)', width: 3.5, lineDash: [6, 4] }),
});

function isAdminSectionTable(tableName: string): boolean {
  const t = tableName.trim().toLowerCase();
  return t.startsWith('lsmd_adm_sect') || /adm_sect_(umd|ri|sgg|sid)/.test(t);
}

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

/** 레이어 생성 없이 배경이 항공 폴백인지 여부만 */
function isBasemapFallbackId(orthoMapId: string | null): boolean {
  if (!orthoMapId || !isLocalOrthoBackgroundId(orthoMapId)) return true;
  if (isDynamicOrthoBackgroundId(orthoMapId)) return false;
  // 비동적 자체 정사 id면 정사로 간주 (실제 레이어 생성 실패는 pick 쪽에서 폴백)
  return false;
}

export type ChangeHistoryLiveMapProps = {
  wkt5181: string | null;
  selectedDate: string;
  /** 디스크에서 고른 자체 정사 배경 id (없으면 VWorld) */
  orthoBackgroundMapId: string | null;
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
  selectedDate: _selectedDate,
  orthoBackgroundMapId,
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
  const fittedWktRef = useRef<string | null>(null);
  const didFitContentRef = useRef(false);
  const paintGenRef = useRef(0);
  const [showBefore, setShowBefore] = useState(true);
  const [showAfter, setShowAfter] = useState(true);
  /** 스타일 prefetch + 도형 일괄 추가 끝날 때까지 */
  const [paintLoading, setPaintLoading] = useState(false);

  const asOfFeatures = asOfFeaturesProp ?? EMPTY_ASOF;
  const dayDiffFeatures = dayDiffFeaturesProp ?? EMPTY_DAY_DIFF;
  const isBasemapFallback = useMemo(
    () => isBasemapFallbackId(orthoBackgroundMapId),
    [orthoBackgroundMapId]
  );
  void _selectedDate;

  const compareRowsBase = useMemo(() => {
    const rows = buildCompareFeatures(asOfFeatures, dayDiffFeatures);
    if (rows.length === 0 && asOfFeatures.length > 0) {
      asOfFeatures.forEach((f, index) => {
        const table = String(f.tableName ?? '').trim();
        const key = String(f.keyValue ?? '').trim();
        const geom = normalizeGeoJsonGeometry(f.geom);
        if (!geom?.type) return;
        rows.push({
          tableName: table || 'unknown',
          keyField: f.keyField,
          keyValue: key || `__noid:${index}`,
          side: 'after',
          geom,
        });
      });
    }
    return rows;
  }, [asOfFeatures, dayDiffFeatures]);

  const hasBefore = useMemo(
    () => compareRowsBase.some((r) => r.side === 'before'),
    [compareRowsBase]
  );

  useEffect(() => {
    setShowBefore(hasBefore);
  }, [hasBefore]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || mapRef.current) return;

    const boundarySource = boundarySourceRef.current;
    const maskSource = maskSourceRef.current;
    const featSource = featSourceRef.current;

    const boundaryLayer = new VectorLayer({
      source: boundarySource,
      style: BOUNDARY_STYLE,
      zIndex: 21,
    });
    const maskLayer = new VectorLayer({
      source: maskSource,
      style: OUTSIDE_MASK_STYLE,
      zIndex: 20,
    });
    const featLayer = new VectorLayer({
      source: featSource,
      /** 변경 후가 변경 전 위에 그려지도록 */
      renderOrder: (a, b) => {
        const sa = (a.get('compareSide') as string) === 'after' ? 1 : 0;
        const sb = (b.get('compareSide') as string) === 'after' ? 1 : 0;
        return sa - sb;
      },
      style: (f): Style => {
        const side = (f.get('compareSide') as 'before' | 'after' | undefined) ?? 'after';
        const gType = f.getGeometry()?.getType();
        if (f.get('adminOutline')) {
          return side === 'before' ? ADMIN_OUTLINE_BEFORE : ADMIN_OUTLINE_AFTER;
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
        if (gType === 'Point' || gType === 'MultiPoint') {
          return side === 'before' ? EMERGENCY_POINT_BEFORE : EMERGENCY_POINT_AFTER;
        }
        if (gType === 'Polygon' || gType === 'MultiPolygon') {
          return side === 'before' ? EMERGENCY_POLY_BEFORE : EMERGENCY_POLY_AFTER;
        }
        return side === 'before' ? EMERGENCY_LINE_BEFORE : EMERGENCY_LINE_AFTER;
      },
      zIndex: 10,
    });
    featLayerRef.current = featLayer;

    const { layer: bg } = pickChangeHistoryBackground(orthoBackgroundMapId);
    bg.set('name', 'changeHistoryBg');
    bg.setZIndex?.(0);
    bgLayerRef.current = bg;

    const map = new Map({
      target: el,
      layers: [bg, featLayer, maskLayer, boundaryLayer],
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

    const syncMask = () => updateOutsideMask(map, areaGeomRef.current, maskSource);
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
      map.un('moveend', syncMask);
      map.setTarget(undefined);
      mapRef.current = null;
      bgLayerRef.current = null;
      featLayerRef.current = null;
      areaGeomRef.current = null;
      boundarySource.clear();
      maskSource.clear();
      featSource.clear();
      fittedWktRef.current = null;
      didFitContentRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const { layer: next } = pickChangeHistoryBackground(orthoBackgroundMapId);
    next.set('name', 'changeHistoryBg');
    next.setZIndex?.(0);
    const layers = map.getLayers();
    const prev = bgLayerRef.current;
    if (prev) layers.remove(prev);
    layers.insertAt(0, next);
    bgLayerRef.current = next;
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
    let cancelled = false;
    const gen = ++paintGenRef.current;

    void (async () => {
      await Promise.resolve();
      if (cancelled) return;

      source.clear();

      if (mapLoading) {
        setPaintLoading(false);
        return;
      }

      const visibleRows = compareRowsBase.filter((row) => {
        if (row.side === 'before' && (!hasBefore || !showBefore)) return false;
        if (row.side === 'after' && !showAfter) return false;
        return true;
      });

      if (visibleRows.length === 0) {
        setPaintLoading(false);
        return;
      }

      setPaintLoading(true);
      const tables = [...new Set(visibleRows.map((r) => r.tableName).filter(Boolean))];

      try {
        await prefetchCompareStyles(tables);
      } catch {
        /* 스타일 실패해도 emergency 스타일로 일괄 표시 */
      }
      if (cancelled || gen !== paintGenRef.current) return;

      for (const row of visibleRows) {
        const geom = normalizeGeoJsonGeometry(row.geom) ?? row.geom;
        const g = readGeom5181To3857(geom);
        if (!g) continue;
        const f = new Feature({ geometry: g });
        f.setId(`${row.side}:${row.tableName}:${row.keyValue}`);
        f.set('compareSide', row.side);
        f.set('tableName', row.tableName);
        if (isAdminSectionTable(row.tableName)) f.set('adminOutline', true);
        source.addFeature(f);
      }
      featLayerRef.current?.changed();
      if (gen === paintGenRef.current) setPaintLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [compareRowsBase, hasBefore, showBefore, showAfter, mapLoading]);

  const overlayLoading = mapLoading || paintLoading;

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
        <label
          className={
            hasBefore
              ? 'flex items-center justify-between gap-3 text-[11px] text-foreground'
              : 'flex items-center justify-between gap-3 text-[11px] text-muted-foreground'
          }
        >
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-neutral-900" aria-hidden />
            변경 전
          </span>
          <Switch
            checked={hasBefore && showBefore}
            onCheckedChange={setShowBefore}
            disabled={!hasBefore}
            title={hasBefore ? '변경 전 레이어 표시' : '최초 등록만 있어 변경 전 도형이 없습니다'}
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
      {overlayLoading ? (
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
