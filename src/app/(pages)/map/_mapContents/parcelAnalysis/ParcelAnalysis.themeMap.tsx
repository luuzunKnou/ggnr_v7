'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import dynamic from 'next/dynamic';
import Feature from 'ol/Feature';
import GeoJSON from 'ol/format/GeoJSON';
import WKT from 'ol/format/WKT';
import { Map as OlMap, View } from 'ol';
import type { Geometry } from 'ol/geom';
import Polygon from 'ol/geom/Polygon';
import TileLayer from 'ol/layer/Tile';
import type BaseLayer from 'ol/layer/Base';
import VectorImageLayer from 'ol/layer/VectorImage';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style } from 'ol/style';
import '@/app/(pages)/map/_mapComponents/config/projections';
import { getLegendGraphicUrl } from '@/app/(pages)/map/_mapComponents/layerFactory/serviceLayerFactory';
import { call } from '@/lib/api';
import {
  buildThemeCategoriesFromParcels,
  PARCEL_THEME_MAP_TOP_CATEGORY_COUNT,
  resolveThemeColor,
  resolveThemeFeatureCategory,
  themeNoParcelSwatchStyle,
  themeOtherSwatchStyle,
  themeSwatchStyle,
  type ParcelThemeMapCategory,
  type ParcelThemeMapKind,
  type ParcelThemeMapPayload,
  type ThemeMapParcelInput,
} from '@/lib/parcelAnalysisTheme';
import {
  applyThemeMapHomeView,
  buildThemeMapStyleLookup,
  createParcelAnalysisBasemapSource,
  createParcelAnalysisMaskOuterRing,
  createParcelAnalysisStaticMapOptions,
  createThemeMapAreaBaseFillStyle,
  getParcelAnalysisExteriorRings,
  PARCEL_ANALYSIS_BOUNDARY_STROKE,
  PARCEL_ANALYSIS_BOUNDARY_STROKE_WIDTH,
  PARCEL_ANALYSIS_OUTSIDE_MASK_FILL,
  PARCEL_ANALYSIS_VWORLD_BASE_URL,
  resolveThemeMapFeatureStyle,
  toCaptureDisplayGeometry,
} from './parcelAnalysis.mapStyle';

/** «분석 중» 안내 모달 전용 — 원형 유지, 기존 36px 대비 가로·세로 +10px */
export const PARCEL_ANALYSIS_ANALYZING_SPINNER =
  'size-[46px] shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600';

type GeomType = 'POINT' | 'LINE' | 'POLYGON';

type Props = {
  layerKey: string;
  geomType?: GeomType;
};

function FacilityLegendFallback({ geomType }: { geomType: GeomType }) {
  if (geomType === 'LINE') {
    return (
      <svg viewBox="0 0 12 12" className="h-full w-full" aria-hidden>
        <line x1="1" y1="11" x2="11" y2="1" stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (geomType === 'POINT') {
    return (
      <svg viewBox="0 0 12 12" className="h-full w-full" aria-hidden>
        <circle cx="6" cy="6" r="4" fill="#3b82f6" stroke="#1d4ed8" strokeWidth="1.2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 12 12" className="h-full w-full" aria-hidden>
      <rect x="1.5" y="1.5" width="9" height="9" fill="#93c5fd" stroke="#3b82f6" strokeWidth="1.5" />
    </svg>
  );
}

/** 시설목록 표 구분 열 — 데이터조회 AttributeQueryUI와 동일 GetLegendGraphic */
export function FacilityLayerLegendIcon({ layerKey, geomType = 'POLYGON' }: Props) {
  const wmsKey = layerKey.toLowerCase();
  const [useFallback, setUseFallback] = useState(false);
  const onLegendError = useCallback(() => setUseFallback(true), []);

  if (useFallback) {
    return (
      <span
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-slate-300 bg-slate-200"
        aria-hidden
      >
        <FacilityLegendFallback geomType={geomType} />
      </span>
    );
  }

  return (
    <span
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-slate-200 bg-white"
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        src={getLegendGraphicUrl(wmsKey, wmsKey)}
        className="h-[150%] w-[150%] max-w-none object-cover"
        onError={onLegendError}
      />
    </span>
  );
}

const SWATCH_CLASS = 'inline-block h-3 w-3 shrink-0 rounded-sm border';

type ThemeLegendProps = {
  theme: ParcelThemeMapKind;
  categories: ParcelThemeMapCategory[];
};

export function ParcelAnalysisThemeLegend({ theme, categories }: ThemeLegendProps) {
  const onMap = categories.filter((cat) => cat.onMap);
  const tableOnly = categories.filter((cat) => !cat.onMap);
  const combineTableOnly =
    categories.length > PARCEL_THEME_MAP_TOP_CATEGORY_COUNT && tableOnly.length > 0;

  if (!categories.length) return null;

  const tableOnlyTitle = tableOnly
    .map((cat) => `${cat.label}(${cat.count.toLocaleString('ko-KR')}필지)`)
    .join(', ');

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-slate-700">
      {onMap.map((cat) => {
        const strokeColor = resolveThemeColor(theme, cat.label);
        const swatch = themeSwatchStyle(strokeColor);
        return (
          <span key={cat.label} className="inline-flex items-center gap-1.5">
            <span
              className={SWATCH_CLASS}
              style={{
                backgroundColor: swatch.backgroundColor,
                borderColor: swatch.borderColor,
              }}
              aria-hidden
            />
            {cat.label}
          </span>
        );
      })}
      {combineTableOnly ? (
        <span
          className="inline-flex items-center gap-1.5 text-slate-500"
          title={tableOnlyTitle}
        >
          <span
            className={SWATCH_CLASS}
            style={themeOtherSwatchStyle()}
            aria-hidden
          />
          그 외 {tableOnly.length}구분
        </span>
      ) : tableOnly.length > 0 ? (
        <span className="text-[10px] text-slate-500">표만: {tableOnlyTitle}</span>
      ) : null}
      <span className="inline-flex items-center gap-1.5 text-slate-500">
        <span
          className={SWATCH_CLASS}
          style={themeNoParcelSwatchStyle()}
          aria-hidden
        />
        필지 없음(도로 등)
      </span>
    </div>
  );
}

type ThemeMapProps = {
  wkt5181: string;
  theme: ParcelThemeMapKind;
  /** 토지현황 보강 결과 — 소유구분/지목 (없으면 도형만 «미상») */
  parcels?: ThemeMapParcelInput[];
};

const MAP_HEIGHT_PX = 320;

function createVworldTileSource() {
  return createParcelAnalysisBasemapSource(PARCEL_ANALYSIS_VWORLD_BASE_URL);
}

function useThemeMapWhenVisible(rootRef: RefObject<HTMLDivElement | null>) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || visible) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisible(true);
      },
      { rootMargin: '120px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootRef, visible]);

  return visible;
}

function ParcelAnalysisThemeMapInner({ wkt5181, theme, parcels = [] }: ThemeMapProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mapTargetRef = useRef<HTMLDivElement>(null);
  const visible = useThemeMapWhenVisible(rootRef);
  const [loading, setLoading] = useState(false);
  const [mapRendering, setMapRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geomPayload, setGeomPayload] = useState<ParcelThemeMapPayload | null>(null);

  const painted = useMemo(() => {
    if (!geomPayload?.ok || !geomPayload.features?.length) return null;
    const { categories, onMapLabels, mapCategoryLimitApplied } = buildThemeCategoriesFromParcels(
      parcels,
      geomPayload.parcelCount
    );
    const catByPnu = new Map(
      parcels.map((p) => [String(p.pnu).trim(), String(p.category ?? '').trim() || '미상'])
    );
    const features = geomPayload.features.map((f) => {
      const pnu = String(f.pnu ?? '').trim();
      const raw = (pnu && catByPnu.get(pnu)) || f.category || '미상';
      return {
        ...f,
        category: resolveThemeFeatureCategory(raw, onMapLabels),
      };
    });
    return {
      ok: true as const,
      theme,
      parcelCount: geomPayload.parcelCount,
      mapCategoryLimitApplied,
      categories:
        categories.length > 0
          ? categories
          : [{ label: '미상', count: features.length, areaSqm: 0, onMap: true }],
      features,
    };
  }, [geomPayload, parcels, theme]);

  useEffect(() => {
    if (!visible || !wkt5181.trim()) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const res = await call('', 'POST', {
          service: 'mapAnalyseService',
          action: 'listAnalyzeThemeMapFeatures',
          params: { wkt5181, theme },
        });
        const data = (res?.data ?? res) as ParcelThemeMapPayload | undefined;
        if (cancelled) return;
        if (!data?.ok) {
          setGeomPayload(null);
          setError(data?.error ?? '테마 지도를 불러오지 못했습니다.');
          return;
        }
        setGeomPayload(data);
      } catch {
        if (!cancelled) {
          setGeomPayload(null);
          setError('테마 지도 요청 중 오류가 발생했습니다.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, wkt5181, theme]);

  useEffect(() => {
    const targetEl = mapTargetRef.current;
    if (!visible || !targetEl || !wkt5181.trim() || !painted?.ok) return;

    let map: OlMap | null = null;
    let cancelled = false;
    setMapRendering(true);

    try {
      const rawBoundaryGeom = new WKT().readGeometry(wkt5181, {
        dataProjection: 'EPSG:5181',
        featureProjection: 'EPSG:5181',
      });
      const boundaryGeom = toCaptureDisplayGeometry(rawBoundaryGeom);
      const analysisExtent = boundaryGeom.getExtent();
      const mapSize: [number, number] = [targetEl.clientWidth || 640, MAP_HEIGHT_PX];
      const view = new View({ projection: 'EPSG:5181' });
      const homeView = applyThemeMapHomeView(view, analysisExtent, mapSize);

      const geoJson = new GeoJSON();
      const parcelFeatures: Feature<Geometry>[] = [];
      for (const row of painted.features ?? []) {
        if (!row.geometry) continue;
        const feature = geoJson.readFeature(
          { type: 'Feature', geometry: row.geometry, properties: {} },
          { dataProjection: 'EPSG:5181', featureProjection: 'EPSG:5181' }
        ) as Feature<Geometry>;
        feature.set('category', row.category);
        parcelFeatures.push(feature);
      }

      const onMapLabels = new Set(
        (painted.categories ?? []).filter((cat) => cat.onMap).map((cat) => cat.label)
      );
      const styleLookup = buildThemeMapStyleLookup(theme, onMapLabels);

      const parcelLayer = new VectorImageLayer({
        source: new VectorSource({ features: parcelFeatures }),
        zIndex: 2,
        style: (feature) =>
          resolveThemeMapFeatureStyle(
            String(feature.get('category') ?? '미상'),
            onMapLabels,
            styleLookup
          ),
      });

      const areaBaseFeature = new Feature({ geometry: boundaryGeom });

      const layers: BaseLayer[] = [
        new TileLayer({ source: createVworldTileSource(), zIndex: 0 }),
        new VectorImageLayer({
          source: new VectorSource({ features: [areaBaseFeature] }),
          zIndex: 1,
          style: createThemeMapAreaBaseFillStyle(),
        }),
        parcelLayer,
      ];

      const holes = getParcelAnalysisExteriorRings(boundaryGeom);
      if (holes.length) {
        const outerRing = createParcelAnalysisMaskOuterRing(
          homeView.areaCenter,
          homeView.minResolution,
          mapSize,
          2
        );
        const maskFeature = new Feature({
          geometry: new Polygon([outerRing, ...holes]),
        });
        maskFeature.setStyle(new Style({ fill: new Fill({ color: PARCEL_ANALYSIS_OUTSIDE_MASK_FILL }) }));
        layers.push(
          new VectorLayer({
            source: new VectorSource({ features: [maskFeature] }),
            zIndex: 1.5,
          })
        );
      }

      const boundaryFeature = new Feature({ geometry: boundaryGeom });
      boundaryFeature.setStyle(
        new Style({
          stroke: new Stroke({
            color: PARCEL_ANALYSIS_BOUNDARY_STROKE,
            width: PARCEL_ANALYSIS_BOUNDARY_STROKE_WIDTH,
          }),
        })
      );
      layers.push(
        new VectorLayer({
          source: new VectorSource({ features: [boundaryFeature] }),
          zIndex: 3,
        })
      );

      map = new OlMap({
        target: targetEl,
        layers,
        view,
        ...createParcelAnalysisStaticMapOptions(),
      });

      const finishRendering = () => {
        if (!cancelled) setMapRendering(false);
      };
      map.once('rendercomplete', finishRendering);
      window.setTimeout(finishRendering, 8000);
    } catch {
      if (!cancelled) {
        setMapRendering(false);
        setError('테마 지도를 그리지 못했습니다.');
      }
    }

    return () => {
      cancelled = true;
      setMapRendering(false);
      if (map) {
        map.setTarget(undefined);
        map = null;
      }
    };
  }, [visible, wkt5181, theme, painted]);

  const showMapOverlay = !visible || loading || mapRendering;
  const overlayMessage = !visible
    ? '테마 지도 준비 중…'
    : loading
      ? '필지 도형을 불러오는 중…'
      : '지도를 그리는 중…';

  return (
    <div ref={rootRef} className="my-2 space-y-2">
      <div
        className="relative w-full overflow-hidden rounded border border-slate-200 bg-slate-100"
        style={{ height: MAP_HEIGHT_PX }}
      >
        <div
          ref={mapTargetRef}
          className="absolute inset-0 touch-none"
          aria-label={theme === 'owner' ? '소유구분 테마 지도' : '지목별 테마 지도'}
        />
        {showMapOverlay ? (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-slate-100/85"
            aria-busy="true"
            aria-live="polite"
          >
            <div className="flex flex-col items-center gap-2 px-4 text-center">
              <div className={PARCEL_ANALYSIS_ANALYZING_SPINNER} aria-hidden />
              <p className="text-[11px] text-slate-500">{overlayMessage}</p>
            </div>
          </div>
        ) : null}
      </div>
      {error ? <p className="text-[11px] text-amber-700">{error}</p> : null}
      {painted?.ok && painted.categories?.length && !showMapOverlay ? (
        <ParcelAnalysisThemeLegend theme={theme} categories={painted.categories} />
      ) : null}
    </div>
  );
}

export const ParcelAnalysisThemeMap = dynamic(
  () => Promise.resolve({ default: ParcelAnalysisThemeMapInner }),
  { ssr: false }
);
