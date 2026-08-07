'use client';

import { useEffect, useRef, useState } from 'react';
import '../config/projections';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import GeoJSONFormat from 'ol/format/GeoJSON';
import { useMapContext } from '../MapContext';
import { fitMapToExtent3857, prepareMapForPanelAwareNavigation } from '../config/mapAutoNavigation';
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder';
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
} from '@/lib/mapDataQueryMapHighlight';
import { MAP_AUTO_NAV_MAX_ZOOM } from '../config/mapDefaults';

const FIT_PADDING = [80, 80, 80, 80] as const;
const FIT_MAX_ZOOM = Math.min(16, MAP_AUTO_NAV_MAX_ZOOM);

/**
 * 도로망도 선택 행 geom — 데이터조회와 동일한 벡터 강조(펄스).
 * 도로대장 강조와 별도 레이어.
 */
export function useRoadNetworkMapHighlight(mapReady: boolean) {
  const mapContext = useMapContext();
  const row =
    mapContext?.roadNetworkRows?.find((r) => r.id === mapContext?.roadNetworkSelectedId) ?? null;

  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const pulsePhaseRef = useRef(0);
  const lastFittedIdRef = useRef<string | null>(null);
  const [radarActive, setRadarActive] = useState(false);

  useEffect(() => {
    if (!radarActive) return;
    let rafId: number;
    const loop = () => {
      pulsePhaseRef.current += DATA_QUERY_SELECTION_PULSE_STEP;
      sourceRef.current?.changed();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [radarActive]);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!mapReady || !map) return;

    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({
      source,
      renderOrder: compareFeaturesByGeometryStackOrder,
      style: createDataQuerySelectionRowHighlightStyle(() => pulsePhaseRef.current),
      zIndex: 1101,
    });
    layer.set('roadNetworkHighlight', true);
    map.getLayers().push(layer);
    layerRef.current = layer;

    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
      sourceRef.current = null;
      setRadarActive(false);
    };
  }, [mapReady, mapContext?.mapInstanceRef]);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    const source = sourceRef.current;
    if (!map || !source) return;

    source.clear();
    setRadarActive(false);
    if (!row?.geom) {
      lastFittedIdRef.current = row ? row.id : null;
      return;
    }

    const viewProj = map.getView().getProjection()?.getCode() || 'EPSG:3857';
    const geojson = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: row.geom,
          properties: {},
        },
      ],
    };
    const format = new GeoJSONFormat();
    const features = format.readFeatures(geojson, {
      dataProjection: 'EPSG:4326',
      featureProjection: viewProj,
    });
    if (features.length === 0) return;

    source.addFeatures(features);
    setRadarActive(true);

    const ext = source.getExtent();
    if (!ext.every((v) => Number.isFinite(v))) return;

    const alreadyFitted = lastFittedIdRef.current === row.id;
    lastFittedIdRef.current = row.id;
    if (alreadyFitted) return;

    const runFit = () => {
      if (!map.getTargetElement()) return;
      prepareMapForPanelAwareNavigation(map, () => mapContext?.applyMapViewPaddingRef?.current?.());
      fitMapToExtent3857(map, ext as [number, number, number, number], {
        fitPadding: [...FIT_PADDING],
        maxZoom: FIT_MAX_ZOOM,
      });
    };

    queueMicrotask(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(runFit);
      });
    });
  }, [row, mapReady, mapContext?.applyMapViewPaddingRef, mapContext?.mapInstanceRef, mapContext?.roadNetworkSelectedId, mapContext?.roadNetworkRows]);
}
