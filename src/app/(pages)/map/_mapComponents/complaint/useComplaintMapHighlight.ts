'use client';

import { useEffect, useRef, useState } from 'react';
import '../config/projections';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import GeoJSONFormat from 'ol/format/GeoJSON';
import { useMapContext } from '../MapContext';
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder';
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
  insertLayerBelowServiceLayer,
} from '@/lib/mapDataQueryMapHighlight';

function looksLikeGeoJsonGeometry(v: unknown): v is Record<string, unknown> & { type: unknown } {
  if (!v || typeof v !== 'object' || !('type' in v)) return false;
  const t = (v as { type?: unknown }).type;
  if (typeof t !== 'string') return false;
  if (t === 'GeometryCollection') return 'geometries' in v;
  return 'coordinates' in v;
}

/**
 * 민원 선택 — 데이터조회/재난대응시설과 동일한 붉은 펄스·동심원 강조.
 */
export function useComplaintMapHighlight(
  mapReady: boolean,
  geomGeoJson4326: Record<string, unknown> | null | undefined
) {
  const mapContext = useMapContext();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const pulsePhaseRef = useRef(0);
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
    });
    layer.set('complaintHighlight', true);
    insertLayerBelowServiceLayer(map, layer);
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

    if (!looksLikeGeoJsonGeometry(geomGeoJson4326)) return;

    const viewProj = map.getView().getProjection()?.getCode() || 'EPSG:3857';
    const geojson = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: geomGeoJson4326,
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

    const geomType = features[0].getGeometry()?.getType();
    if (geomType === 'Point' || geomType === 'MultiPoint') {
      features[0].set('isRadarPoint', true);
    }
    source.addFeatures(features);
    setRadarActive(true);
  }, [geomGeoJson4326, mapContext?.mapInstanceRef]);
}
