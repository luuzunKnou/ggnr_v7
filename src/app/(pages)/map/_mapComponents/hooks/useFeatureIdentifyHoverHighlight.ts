import { useCallback, useEffect, useRef } from 'react';
import type { Map } from 'ol';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder';
import {
  createDataQueryIdentifyHoverStyle,
  insertLayerBelowServiceLayer,
} from '@/lib/mapDataQueryMapHighlight';

const GEOM_KEYS = ['geom', 'wkb_geometry', 'shape', 'the_geom'];

function pickRowGeom(row: Record<string, unknown>): unknown {
  for (const k of GEOM_KEYS) {
    if (row[k] != null) return row[k];
  }
  for (const [k, v] of Object.entries(row)) {
    if (v != null && GEOM_KEYS.includes(k.toLowerCase())) return v;
  }
  return null;
}

/**
 * 지도 위 데이터 목록 hover → 해당 도형만 색 강조. 이동·줌 없음.
 */
export function useFeatureIdentifyHoverHighlight(map: Map | null, mapReady: boolean) {
  const sourceRef = useRef<VectorSource | null>(null);

  useEffect(() => {
    if (!mapReady || !map) return;
    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      renderOrder: compareFeaturesByGeometryStackOrder,
      style: createDataQueryIdentifyHoverStyle(),
    });
    layer.set('identifyHoverLayer', true);
    insertLayerBelowServiceLayer(map, layer);
    sourceRef.current = source;
    return () => {
      map.removeLayer(layer);
      sourceRef.current = null;
    };
  }, [map, mapReady]);

  const setHoverFeature = useCallback(
    (row: Record<string, unknown> | null) => {
      const source = sourceRef.current;
      if (!source || !map) return;
      source.clear();
      if (!row) return;
      const g = pickRowGeom(row);
      if (g == null) return;
      const geom = typeof g === 'string' ? (JSON.parse(g) as unknown) : g;
      if (!geom || typeof geom !== 'object' || !('type' in geom) || !('coordinates' in geom)) return;
      const geojson = {
        type: 'FeatureCollection' as const,
        features: [{ type: 'Feature' as const, geometry: geom, properties: {} }],
      };
      const format = new GeoJSON();
      const viewProj = map.getView().getProjection()?.getCode() || 'EPSG:3857';
      const features = format.readFeatures(geojson, {
        dataProjection: 'EPSG:4326',
        featureProjection: viewProj,
      });
      if (features.length === 0) return;
      source.addFeatures(features);
    },
    [map],
  );

  return setHoverFeature;
}
