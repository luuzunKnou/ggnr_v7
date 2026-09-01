'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Feature from 'ol/Feature';
import type { FeatureLike } from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import type { Map as OLMap } from 'ol';
import { Fill, Stroke, Style, Circle as CircleStyle } from 'ol/style';
import type { StyleFunction } from 'ol/style/Style';
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder';
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
} from '@/lib/mapDataQueryMapHighlight';
import { useMapContext } from '../../../_mapComponents/MapContext';
import { scheduleFitMapToExtent3857 } from '../../../_mapComponents/config/mapAutoNavigation';
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../../_mapComponents/config/mapDefaults';
import { lonLatTo3857, type RoadFrontageBuildingLedger } from './roadFrontageBuildingMock';

const LAYER_PROP = 'roadFrontageBuildingHighlight';

function createHighlightStyle(getPulsePhase: () => number): StyleFunction {
  const radarStyleFn = createDataQuerySelectionRowHighlightStyle(getPulsePhase);
  return (feature: FeatureLike, resolution: number) => {
    const radar = radarStyleFn(feature, resolution);
    const center = new Style({
      image: new CircleStyle({
        radius: 7,
        fill: new Fill({ color: 'rgba(220, 38, 38, 0.95)' }),
        stroke: new Stroke({ color: '#ffffff', width: 2 }),
      }),
      zIndex: 2,
    });
    if (!radar) return center;
    if (Array.isArray(radar)) return [...radar, center];
    return [radar, center];
  };
}

let sharedMap: OLMap | null = null;
let sharedSource: VectorSource | null = null;
let sharedLayer: VectorLayer<VectorSource> | null = null;
let sharedMountCount = 0;
let sharedPulsePhase = 0;
let sharedRadarRaf: number | null = null;
let sharedRadarConsumers = 0;

function startSharedRadar() {
  sharedRadarConsumers += 1;
  if (sharedRadarRaf != null) return;
  const loop = () => {
    sharedPulsePhase += DATA_QUERY_SELECTION_PULSE_STEP;
    sharedSource?.changed();
    sharedRadarRaf = requestAnimationFrame(loop);
  };
  sharedRadarRaf = requestAnimationFrame(loop);
}

function stopSharedRadar() {
  sharedRadarConsumers = Math.max(0, sharedRadarConsumers - 1);
  if (sharedRadarConsumers > 0) return;
  if (sharedRadarRaf != null) {
    cancelAnimationFrame(sharedRadarRaf);
    sharedRadarRaf = null;
  }
  sharedPulsePhase = 0;
}

function ensureSharedLayer(map: OLMap): VectorSource {
  if (sharedSource && sharedLayer && sharedMap === map) return sharedSource;

  if (sharedLayer && sharedMap) {
    sharedMap.removeLayer(sharedLayer);
  }

  const source = new VectorSource();
  const layer = new VectorLayer({
    source,
    renderOrder: compareFeaturesByGeometryStackOrder,
    style: createHighlightStyle(() => sharedPulsePhase),
    zIndex: 9600,
  });
  layer.set(LAYER_PROP, true);
  map.addLayer(layer);

  sharedMap = map;
  sharedSource = source;
  sharedLayer = layer;
  return source;
}

function disposeSharedLayerIfUnused() {
  if (sharedMountCount > 0) return;
  if (sharedRadarRaf != null) {
    cancelAnimationFrame(sharedRadarRaf);
    sharedRadarRaf = null;
  }
  sharedRadarConsumers = 0;
  sharedPulsePhase = 0;
  if (sharedMap && sharedLayer) sharedMap.removeLayer(sharedLayer);
  sharedMap = null;
  sharedSource = null;
  sharedLayer = null;
}

function hasValidLonLat(lon: number, lat: number): boolean {
  return Number.isFinite(lon) && Number.isFinite(lat) && !(lon === 0 && lat === 0);
}

type HighlightOptions = { fit?: boolean };

/**
 * 접도구역 건축물 선택 행 — 데이터조회·지하수허가와 동일한 포인트 레이더 + 지도 이동
 */
export function useRoadFrontageBuildingMapHighlight() {
  const mapContext = useMapContext();
  const activeKeyRef = useRef<string | null>(null);
  const [radarActive, setRadarActive] = useState(false);

  useEffect(() => {
    sharedMountCount += 1;
    const map = mapContext?.mapInstanceRef?.current;
    if (map) ensureSharedLayer(map);
    return () => {
      sharedMountCount -= 1;
      disposeSharedLayerIfUnused();
    };
  }, [mapContext?.mapInstanceRef]);

  useEffect(() => {
    if (!radarActive) return;
    startSharedRadar();
    return () => stopSharedRadar();
  }, [radarActive]);

  const clearHighlight = useCallback(() => {
    activeKeyRef.current = null;
    sharedSource?.clear();
    setRadarActive(false);
  }, []);

  const highlightAt = useCallback(
    (lon: number, lat: number, key: string, options?: HighlightOptions) => {
      const map = mapContext?.mapInstanceRef?.current;
      const id = String(key ?? '').trim();
      if (!map || !id || !hasValidLonLat(lon, lat)) {
        clearHighlight();
        return;
      }

      const source = ensureSharedLayer(map);
      const fit = options?.fit !== false;
      activeKeyRef.current = id;

      const [x, y] = lonLatTo3857(lon, lat);
      source.clear();
      setRadarActive(false);

      const feature = new Feature({ geometry: new Point([x, y]), ftrIdn: id });
      feature.set('isRadarPoint', true);
      source.addFeature(feature);
      setRadarActive(true);

      if (fit) {
        const pad = 40;
        scheduleFitMapToExtent3857(map, [x - pad, y - pad, x + pad, y + pad], {
          maxZoom: Math.min(16, MAP_AUTO_NAV_MAX_ZOOM),
          pointZoom: Math.min(16, MAP_AUTO_NAV_MAX_ZOOM),
          applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
        });
      }
    },
    [clearHighlight, mapContext?.applyMapViewPaddingRef, mapContext?.mapInstanceRef]
  );

  const highlightLedger = useCallback(
    (
      ledger: Pick<RoadFrontageBuildingLedger, 'ftrIdn' | 'id' | 'mockLonLat'>,
      options?: HighlightOptions
    ) => {
      const lon = Number(ledger.mockLonLat?.lon);
      const lat = Number(ledger.mockLonLat?.lat);
      const key = String(ledger.ftrIdn || ledger.id || '').trim();
      highlightAt(lon, lat, key, options);
    },
    [highlightAt]
  );

  return { highlightAt, highlightLedger, clearHighlight };
}
