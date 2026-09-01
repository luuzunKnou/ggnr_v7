'use client';

import { useEffect, useRef, useState } from 'react';
import '../../../_mapComponents/config/projections';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import GeoJSONFormat from 'ol/format/GeoJSON';
import { useMapContext } from '../../../_mapComponents/MapContext';
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder';
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
  insertLayerBelowServiceLayer,
} from '@/lib/mapDataQueryMapHighlight';
import type { RadiationShelterListItem } from '@/service/radiationShelterService';

function looksLikeGeoJsonGeometry(v: unknown): v is Record<string, unknown> & { type: unknown } {
  if (!v || typeof v !== 'object' || !('type' in v)) return false;
  const t = (v as { type?: unknown }).type;
  if (typeof t !== 'string') return false;
  if (t === 'GeometryCollection') return 'geometries' in v;
  return 'coordinates' in v;
}

function geomFromRow(row: RadiationShelterListItem | null): unknown {
  if (!row) return null;
  const g = row.geomJson;
  if (g == null) return null;
  if (typeof g === 'string') {
    try {
      const parsed = JSON.parse(g) as unknown;
      return looksLikeGeoJsonGeometry(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return looksLikeGeoJsonGeometry(g) ? g : null;
}

/** 방사선 대피소 선택 행 — 지도 강조 */
export function useRadiationShelterMapHighlight(
  mapReady: boolean,
  selected: RadiationShelterListItem | null
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
    layer.set('radiationShelterHighlight', true);
    insertLayerBelowServiceLayer(map, layer);
    layerRef.current = layer;

    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
      sourceRef.current = null;
    };
  }, [mapContext?.mapInstanceRef, mapReady]);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    const source = sourceRef.current;
    if (!source) return;
    source.clear();
    setRadarActive(false);

    const geom = geomFromRow(selected);
    if (!geom || !map) return;

    const viewProj = map.getView().getProjection()?.getCode() || 'EPSG:3857';
    const geojson = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: geom as Record<string, unknown>,
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
  }, [selected, mapContext?.mapInstanceRef]);
}
