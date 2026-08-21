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
import type { SafetyFacFacilityRow } from './safetyFacSymbols';

const GEOM_KEY_CANDIDATES = ['geom', 'geometry', 'the_geom', 'wkb_geometry', 'shape'];

function looksLikeGeoJsonGeometry(v: unknown): v is Record<string, unknown> & { type: unknown } {
  if (!v || typeof v !== 'object' || !('type' in v)) return false;
  const t = (v as { type?: unknown }).type;
  if (typeof t !== 'string') return false;
  if (t === 'GeometryCollection') return 'geometries' in v;
  return 'coordinates' in v;
}

export function getSafetyFacGeomJson(row: Record<string, unknown> | null | undefined): unknown {
  if (!row) return null;
  const keys = Object.keys(row);
  const byName = keys.find((k) => GEOM_KEY_CANDIDATES.includes(k.toLowerCase()));
  const key = byName ?? keys.find((k) => looksLikeGeoJsonGeometry(row[k]));
  if (!key) return null;
  const g = row[key];
  if (g == null) return null;
  let geom: unknown = g;
  if (typeof g === 'string') {
    try {
      geom = JSON.parse(g) as unknown;
    } catch {
      return null;
    }
  }
  if (!looksLikeGeoJsonGeometry(geom)) return null;
  return geom;
}

function geomFromFacility(f: SafetyFacFacilityRow | null): unknown {
  if (!f) return null;
  if (f.geomJson != null) {
    if (typeof f.geomJson === 'string') {
      try {
        const parsed = JSON.parse(f.geomJson) as unknown;
        return looksLikeGeoJsonGeometry(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    return looksLikeGeoJsonGeometry(f.geomJson) ? f.geomJson : null;
  }
  return getSafetyFacGeomJson(f.detailAttrs);
}

/**
 * 재난대응시설 선택 행 — 시설관리와 동일한 붉은 펄스 강조. 이동·확대는 목록 클릭의 이동만 사용.
 */
export function useSafetyFacMapHighlight(mapReady: boolean, selected: SafetyFacFacilityRow | null) {
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
    layer.set('safetyFacHighlight', true);
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

    const geomJson = geomFromFacility(selected);
    if (!geomJson) return;

    const viewProj = map.getView().getProjection()?.getCode() || 'EPSG:3857';
    const geojson = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: geomJson as Record<string, unknown>,
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
