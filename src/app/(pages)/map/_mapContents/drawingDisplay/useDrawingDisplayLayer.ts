'use client';

import { useEffect, useRef, useState } from 'react';
import type Feature from 'ol/Feature';
import type { Geometry } from 'ol/geom';
import LineString from 'ol/geom/LineString';
import type { Extent } from 'ol/extent';
import type { Map as OLMap } from 'ol';
import { createEmpty, extend, isEmpty } from 'ol/extent';
import ImageLayer from 'ol/layer/Image';
import VectorImageLayer from 'ol/layer/VectorImage';
import { transform } from 'ol/proj';
import ImageStatic from 'ol/source/ImageStatic';
import VectorSource from 'ol/source/Vector';
import { Circle as CircleStyle, Fill, Stroke, Style, Text as OlText } from 'ol/style';
import { GEOM_STACK_UI_ZINDEX_MIN } from '@/lib/mapLayerGeometryOrder';
import {
  DXF_FILL,
  DXF_LABEL,
  DXF_LAYER,
  DXF_LENGTH,
  DXF_ROTATION,
  DXF_STROKE,
  DXF_STROKE_WIDTH,
  DXF_TEXT_ALIGN,
  DXF_TEXT_BASELINE,
  DXF_TEXT_HEIGHT,
} from '@/lib/dxfToOpenLayers';
import { useMapContext } from '../../_mapComponents/MapContext';
import '../../_mapComponents/config/projections';
import {
  DRAWING_LARGE_FEATURE_THRESHOLD,
  DRAWING_LOD_LEVELS,
  type DrawingCrsCode,
} from './drawingDisplayConfig';
import { bakeDrawingOverviewCanvas, revokeOverviewUrl, type BakedOverview } from './bakeDrawingOverviewCanvas';
import {
  DXF_STABLE_IDX,
  paintFeaturesProgressive,
  pickLodFeatures,
  replaceFeaturesAtomic,
  viewStillCovered,
  type PaintController,
} from './drawingLodPaint';

const LAYER_KEY = 'drawing-display-overlay';
const IMAGE_KEY = 'drawing-display-overview';

const KOREA_EXTENT_4326: [number, number, number, number] = [124, 33, 132, 39];

const FONT_STACK =
  '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Nanum Gothic", Gulim, sans-serif';

const styleCache = new Map<string, Style>();

function cachedLineStyle(strokeCss: string, width: number, fillRgba?: string): Style {
  const key = `L|${strokeCss}|${width}|${fillRgba ?? ''}`;
  let s = styleCache.get(key);
  if (!s) {
    s = new Style({
      stroke: new Stroke({ color: strokeCss, width }),
      fill: fillRgba ? new Fill({ color: fillRgba }) : undefined,
    });
    styleCache.set(key, s);
  }
  return s;
}

function geometryLength(g: Geometry): number {
  const t = g.getType();
  if (t === 'LineString') return (g as LineString).getLength();
  if (t === 'MultiLineString') {
    let s = 0;
    for (const line of (g as import('ol/geom').MultiLineString).getLineStrings()) s += line.getLength();
    return s;
  }
  if (t === 'Polygon') {
    const ring = (g as import('ol/geom').Polygon).getLinearRing(0);
    return ring ? new LineString(ring.getCoordinates()).getLength() : 0;
  }
  const e = g.getExtent();
  return Math.hypot(e[2] - e[0], e[3] - e[1]);
}

function styleFeature(
  feat: Feature<Geometry>,
  resolution: number | undefined,
  hidden: ReadonlySet<string>,
  showLabelsRef: { current: boolean }
): Style | undefined {
  const showLabels = showLabelsRef.current;
  const layerName = String(feat.get(DXF_LAYER) ?? '0');
  if (hidden.has(layerName)) return undefined;

  const g = feat.getGeometry();
  if (!g) return undefined;
  void resolution;
  const t = g.getType();
  const label = feat.get(DXF_LABEL) as string | undefined;
  const strokeCss = feat.get(DXF_STROKE) as string | undefined;
  const fillRgba = feat.get(DXF_FILL) as string | undefined;
  const lineW = feat.get(DXF_STROKE_WIDTH) as number | undefined;

  if (label != null && (t === 'Point' || t === 'MultiPoint')) {
    if (!showLabels) return undefined;
    // 화면 기준 고정 크기 — CAD 문자높이/해상도 비율이 너무 작아져 전부 사라지던 문제 방지
    const fontPx = 10;
    const rot = (feat.get(DXF_ROTATION) as number) ?? 0;
    const textAlign = (feat.get(DXF_TEXT_ALIGN) as CanvasTextAlign) ?? 'left';
    const textBaseline = (feat.get(DXF_TEXT_BASELINE) as CanvasTextBaseline) ?? 'alphabetic';
    const fillColor = strokeCss ?? 'rgb(15, 23, 42)';
    const raw = String(label).trim();
    if (!raw) return undefined;
    const text = raw.length > 16 ? `${raw.slice(0, 15)}…` : raw;
    return new Style({
      text: new OlText({
        text,
        font: `500 ${fontPx}px ${FONT_STACK}`,
        fill: new Fill({ color: fillColor }),
        stroke: new Stroke({ color: 'rgba(255,255,255,0.92)', width: 3 }),
        rotation: rot,
        textAlign,
        textBaseline,
        overflow: false,
        padding: [1, 2, 1, 2],
      }),
    });
  }
  if (t === 'Point' || t === 'MultiPoint') {
    const dot = strokeCss ?? 'rgb(37, 99, 235)';
    const key = `P|${dot}`;
    let s = styleCache.get(key);
    if (!s) {
      s = new Style({
        image: new CircleStyle({
          radius: 2.5,
          fill: new Fill({ color: dot }),
          stroke: new Stroke({ color: 'rgba(255,255,255,0.7)', width: 1 }),
        }),
      });
      styleCache.set(key, s);
    }
    return s;
  }
  const sc = strokeCss ?? 'rgb(37, 99, 235)';
  const w = lineW ?? 1.1;
  if (t === 'Polygon' || t === 'MultiPolygon') {
    return cachedLineStyle(sc, w, fillRgba ?? 'rgba(0,0,0,0)');
  }
  return cachedLineStyle(sc, w);
}

export type DrawingDisplayMode = 'idle' | 'preparing' | 'lod' | 'vector';

export type DrawingLayerStatus = {
  drawn: number;
  visible: number;
  /** 이번 단계 목표 도형 수 (그리는 중이면 visible < target) */
  target: number;
  failed: number;
  outOfKorea: boolean;
  mode: DrawingDisplayMode;
  /** LOD 단계 0…n-1 (대량일 때) */
  lodIndex: number;
  lodLabel: string;
  lodTotal: number;
  painting: boolean;
};

const EMPTY_STATUS: DrawingLayerStatus = {
  drawn: 0,
  visible: 0,
  target: 0,
  failed: 0,
  outOfKorea: false,
  mode: 'idle',
  lodIndex: 0,
  lodLabel: '',
  lodTotal: DRAWING_LOD_LEVELS.length,
  painting: false,
};

type PreparedBundle = {
  features: Feature<Geometry>[];
  extent: Extent;
  outOfKorea: boolean;
  failed: number;
  large: boolean;
};

/**
 * 원본 → 지도 투영. 경위도 검사는 전체 extent 모서리만 (15만건 이중 transform 방지).
 */
function prepareFeatures(
  sourceFeatures: Feature<Geometry>[],
  crs: DrawingCrsCode,
  mapProjectionCode: string
): PreparedBundle {
  const sourceProjection = `EPSG:${crs}`;
  const mapExtent = createEmpty();
  const rawExtent = createEmpty();
  const out: Feature<Geometry>[] = [];
  let failed = 0;

  for (const src of sourceFeatures) {
    try {
      const geom = src.getGeometry();
      if (!geom) {
        failed++;
        continue;
      }
      const eRaw = geom.getExtent();
      if (!eRaw.every(Number.isFinite)) {
        failed++;
        continue;
      }
      extend(rawExtent, eRaw);

      const gMap = geom.clone();
      gMap.transform(sourceProjection, mapProjectionCode);
      const eMap = gMap.getExtent();
      if (!eMap.every(Number.isFinite)) {
        failed++;
        continue;
      }
      extend(mapExtent, eMap);

      const f = src.clone();
      f.setGeometry(gMap);
      f.set(DXF_STABLE_IDX, out.length);
      f.set(DXF_LENGTH, geometryLength(gMap));
      out.push(f);
    } catch {
      failed++;
    }
  }

  let outOfKorea = false;
  if (!isEmpty(rawExtent) && crs !== '4326') {
    try {
      const corners: [number, number][] = [
        [rawExtent[0], rawExtent[1]],
        [rawExtent[2], rawExtent[1]],
        [rawExtent[0], rawExtent[3]],
        [rawExtent[2], rawExtent[3]],
      ];
      let minLon = Infinity;
      let minLat = Infinity;
      let maxLon = -Infinity;
      let maxLat = -Infinity;
      for (const [x, y] of corners) {
        const [lon, lat] = transform([x, y], sourceProjection, 'EPSG:4326');
        minLon = Math.min(minLon, lon);
        minLat = Math.min(minLat, lat);
        maxLon = Math.max(maxLon, lon);
        maxLat = Math.max(maxLat, lat);
      }
      const [k0, k1, k2, k3] = KOREA_EXTENT_4326;
      outOfKorea = minLon < k0 || minLat < k1 || maxLon > k2 || maxLat > k3;
    } catch {
      outOfKorea = false;
    }
  } else if (crs === '4326' && !isEmpty(rawExtent)) {
    const [k0, k1, k2, k3] = KOREA_EXTENT_4326;
    outOfKorea =
      rawExtent[0] < k0 || rawExtent[1] < k1 || rawExtent[2] > k2 || rawExtent[3] > k3;
  }

  return {
    features: out,
    extent: isEmpty(mapExtent) ? createEmpty() : mapExtent,
    outOfKorea,
    failed,
    large: out.length >= DRAWING_LARGE_FEATURE_THRESHOLD,
  };
}

/**
 * 도면 표시 — 소수: 전체 벡터 / 대량: 줌 LOD(단계) + 청크 페인트.
 */
export function useDrawingDisplayLayer(
  enabled: boolean,
  sourceFeatures: Feature<Geometry>[] | null,
  crs: DrawingCrsCode | '',
  hiddenLayers: ReadonlySet<string>
): DrawingLayerStatus {
  const mapContext = useMapContext();
  const vectorSourceRef = useRef(new VectorSource({ useSpatialIndex: true }));
  /** 지도에 올리지 않는 공간 인덱스 — 상세 모드 뷰포트 조회용 */
  const indexSourceRef = useRef(new VectorSource({ useSpatialIndex: true }));
  const vectorLayerRef = useRef<VectorImageLayer<VectorSource> | null>(null);
  const imageLayerRef = useRef<ImageLayer<ImageStatic> | null>(null);
  const preparedRef = useRef<PreparedBundle | null>(null);
  const bakedRef = useRef<BakedOverview | null>(null);
  const overviewActiveRef = useRef(false);
  const hiddenRef = useRef(hiddenLayers);
  hiddenRef.current = hiddenLayers;
  const showLabelsRef = useRef(true);
  const paintCtlRef = useRef<PaintController | null>(null);
  const lastLodIndexRef = useRef(-1);
  const loadedExtentRef = useRef<Extent | null>(null);
  const modeRef = useRef<DrawingDisplayMode>('idle');
  const refreshRef = useRef<(map: OLMap) => void>(() => {});
  const [status, setStatus] = useState<DrawingLayerStatus>(EMPTY_STATUS);

  const mapRef = mapContext?.mapInstanceRef;

  useEffect(() => {
    const map = mapRef?.current;
    if (!map) return;

    if (!vectorLayerRef.current) {
      vectorLayerRef.current = new VectorImageLayer({
        source: vectorSourceRef.current,
        style: (feat, resolution) =>
          styleFeature(feat as Feature<Geometry>, resolution, hiddenRef.current, showLabelsRef),
        zIndex: GEOM_STACK_UI_ZINDEX_MIN + 6,
        imageRatio: 1.25,
        properties: { id: LAYER_KEY, geomStackSkip: true },
      });
    }

    const vLayer = vectorLayerRef.current;
    if (!enabled) {
      if (map.getLayers().getArray().includes(vLayer)) map.removeLayer(vLayer);
      if (imageLayerRef.current && map.getLayers().getArray().includes(imageLayerRef.current)) {
        map.removeLayer(imageLayerRef.current);
      }
      paintCtlRef.current?.cancel();
      paintCtlRef.current = null;
      vectorSourceRef.current.clear();
      indexSourceRef.current.clear();
      revokeOverviewUrl(bakedRef.current);
      bakedRef.current = null;
      preparedRef.current = null;
      overviewActiveRef.current = false;
      lastLodIndexRef.current = -1;
      loadedExtentRef.current = null;
      modeRef.current = 'idle';
      setStatus(EMPTY_STATUS);
      return;
    }

    if (!map.getLayers().getArray().includes(vLayer)) map.addLayer(vLayer);

    return () => {
      map.removeLayer(vLayer);
      if (imageLayerRef.current) map.removeLayer(imageLayerRef.current);
      vectorSourceRef.current.clear();
    };
  }, [mapRef, enabled]);

  /** 좌표계·원본 변경 시 투영·개요 베이크 */
  useEffect(() => {
    const map = mapRef?.current;
    const vSource = vectorSourceRef.current;
    vSource.clear();

    revokeOverviewUrl(bakedRef.current);
    bakedRef.current = null;
    preparedRef.current = null;

    if (imageLayerRef.current && map) {
      map.removeLayer(imageLayerRef.current);
      imageLayerRef.current = null;
    }

    if (!map || !enabled || !sourceFeatures?.length || !crs) {
      modeRef.current = 'idle';
      setStatus(EMPTY_STATUS);
      return;
    }

    modeRef.current = 'preparing';
    setStatus({ ...EMPTY_STATUS, mode: 'preparing' });

    let cancelled = false;
    const mapProjectionCode = map.getView().getProjection().getCode();

    // 다음 프레임에 투영 — UI 멈춤 완화
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const prepared = prepareFeatures(sourceFeatures, crs, mapProjectionCode);
      if (cancelled) return;
      preparedRef.current = prepared;
      indexSourceRef.current.clear(true);
      indexSourceRef.current.addFeatures(prepared.features);

      if (prepared.large && !isEmpty(prepared.extent)) {
        bakedRef.current = bakeDrawingOverviewCanvas(
          prepared.features,
          prepared.extent,
          hiddenRef.current
        );
      }

      if (cancelled) return;

      if (!prepared.outOfKorea && !isEmpty(prepared.extent)) {
        map.getView().fit(prepared.extent, { padding: [80, 80, 80, 80], maxZoom: 18, duration: 400 });
      }

      // fit 직후 extent 반영을 위해 한 틱 뒤 표시 갱신
      window.setTimeout(() => {
        if (cancelled) return;
        refreshRef.current(map);
      }, 450);
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mapRef, enabled, sourceFeatures, crs]);

  /** 숨김 레이어 변경 — 개요 재베이크 + 리프레시 */
  useEffect(() => {
    const map = mapRef?.current;
    const prepared = preparedRef.current;
    if (!map || !enabled || !prepared) {
      vectorLayerRef.current?.changed();
      return;
    }
    if (prepared.large && !isEmpty(prepared.extent)) {
      revokeOverviewUrl(bakedRef.current);
      bakedRef.current = bakeDrawingOverviewCanvas(
        prepared.features,
        prepared.extent,
        hiddenLayers
      );
      overviewActiveRef.current = false; // 이미지 교체 강제
      loadedExtentRef.current = null;
      lastLodIndexRef.current = -1;
    }
    refreshRef.current(map);
  }, [hiddenLayers, enabled, mapRef]);

  refreshRef.current = (map: OLMap) => {
    const prepared = preparedRef.current;
    const vSource = vectorSourceRef.current;
    const vLayer = vectorLayerRef.current;

    const removeOverview = () => {
      if (imageLayerRef.current) {
        map.removeLayer(imageLayerRef.current);
        imageLayerRef.current = null;
      }
      overviewActiveRef.current = false;
    };

    /** 1단계(전체)만 개요 이미지 — 반투명 오버레이로 흐려지지 않게 */
    const ensureOverview = (baked: BakedOverview | null, overviewOnly: boolean) => {
      if (!overviewOnly || !baked) {
        removeOverview();
        return;
      }
      if (overviewActiveRef.current && imageLayerRef.current) {
        imageLayerRef.current.setOpacity(1);
        return;
      }
      removeOverview();
      const src = new ImageStatic({
        url: baked.blobUrl,
        imageExtent: baked.imageExtent,
        projection: map.getView().getProjection(),
      });
      imageLayerRef.current = new ImageLayer({
        source: src,
        zIndex: GEOM_STACK_UI_ZINDEX_MIN + 5,
        properties: { id: IMAGE_KEY, geomStackSkip: true },
        opacity: 1,
      });
      map.addLayer(imageLayerRef.current);
      overviewActiveRef.current = true;
    };

    if (!prepared || !prepared.features.length) {
      paintCtlRef.current?.cancel();
      paintCtlRef.current = null;
      vSource.clear();
      removeOverview();
      modeRef.current = 'idle';
      setStatus(EMPTY_STATUS);
      return;
    }

    const viewExtent = map.getView().calculateExtent(map.getSize());
    const full = prepared.extent;

    if (!prepared.large) {
      paintCtlRef.current?.cancel();
      paintCtlRef.current = null;
      removeOverview();
      showLabelsRef.current = true;
      modeRef.current = 'vector';
      if (vSource.getFeatures().length !== prepared.features.length) {
        vSource.clear(true);
        vSource.addFeatures(prepared.features);
      }
      vLayer?.changed();
      setStatus({
        ...EMPTY_STATUS,
        drawn: prepared.features.length,
        visible: prepared.features.length,
        target: prepared.features.length,
        failed: prepared.failed,
        outOfKorea: prepared.outOfKorea,
        mode: 'vector',
      });
      return;
    }

    const pick = pickLodFeatures(indexSourceRef.current, viewExtent, full, hiddenRef.current);
    showLabelsRef.current = pick.level.showLabels;
    modeRef.current = 'lod';

    ensureOverview(bakedRef.current, pick.level.overviewOnly);

    const lodChanged = lastLodIndexRef.current !== pick.levelIndex;
    const stillCovered =
      !lodChanged && viewStillCovered(loadedExtentRef.current, viewExtent);

    // 같은 LOD·이미 불러온 범위 안이면 재로드하지 않음 (팬 깜빡임 방지)
    if (stillCovered) {
      setStatus((prev) => ({
        ...prev,
        mode: 'lod',
        lodIndex: pick.levelIndex,
        lodLabel: pick.level.label,
        lodTotal: DRAWING_LOD_LEVELS.length,
      }));
      vLayer?.changed();
      return;
    }

    loadedExtentRef.current = pick.loadedExtent;
    const prevLod = lastLodIndexRef.current;
    lastLodIndexRef.current = pick.levelIndex;

    paintCtlRef.current?.cancel();
    paintCtlRef.current = null;

    const pushStatus = (visible: number, total: number, painting: boolean) => {
      setStatus({
        drawn: prepared.features.length,
        visible,
        target: total,
        failed: prepared.failed,
        outOfKorea: prepared.outOfKorea,
        mode: 'lod',
        lodIndex: pick.levelIndex,
        lodLabel: pick.level.label,
        lodTotal: DRAWING_LOD_LEVELS.length,
        painting,
      });
      vLayer?.changed();
    };

    // 1단계: 이미지만 / 그 외: 벡터
    if (pick.level.overviewOnly) {
      replaceFeaturesAtomic(vSource, [], () => pushStatus(0, 0, false));
      return;
    }

    // LOD가 올라갈 때만 조금씩 추가 / 팬·축소·단계 하락은 한 번에 교체
    if (lodChanged && pick.levelIndex > prevLod && pick.candidates.length > 0) {
      paintCtlRef.current = paintFeaturesProgressive(vSource, pick.candidates, (visible, total) => {
        pushStatus(visible, total, visible < total);
      });
    } else {
      replaceFeaturesAtomic(vSource, pick.candidates, (n) => pushStatus(n, n, false));
    }
  };

  /** 이동·줌 종료 시에만 갱신 — resolution 연속 이벤트가 깜빡임의 주원인 */
  useEffect(() => {
    const map = mapRef?.current;
    if (!map || !enabled) return;

    let debounce: number | undefined;
    const schedule = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        if (preparedRef.current) refreshRef.current(map);
      }, 80);
    };
    map.on('moveend', schedule);
    return () => {
      map.un('moveend', schedule);
      window.clearTimeout(debounce);
    };
  }, [mapRef, enabled, sourceFeatures, crs]);

  return status;
}
