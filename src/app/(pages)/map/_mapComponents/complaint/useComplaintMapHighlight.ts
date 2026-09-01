'use client';

import { useEffect, useRef, useState } from 'react';
import type { Feature } from 'ol';
import type { Map as OLMap } from 'ol';
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
import {
  COMPLAINT_FLY_MS,
  subscribeComplaintFlyComplete,
} from './useComplaintMapClick';

/** 비행이 시작되지 않을 때(좌표 없음) 강조를 너무 오래 숨기지 않기 위한 대기 */
const HIGHLIGHT_FALLBACK_MS = COMPLAINT_FLY_MS + 120;

function looksLikeGeoJsonGeometry(v: unknown): v is Record<string, unknown> & { type: unknown } {
  if (!v || typeof v !== 'object' || !('type' in v)) return false;
  const t = (v as { type?: unknown }).type;
  if (typeof t !== 'string') return false;
  if (t === 'GeometryCollection') return 'geometries' in v;
  return 'coordinates' in v;
}

function featuresFromGeom(
  map: OLMap,
  geomGeoJson4326: Record<string, unknown>
): Feature[] {
  const viewProj = map.getView().getProjection()?.getCode() || 'EPSG:3857';
  const format = new GeoJSONFormat();
  const features = format.readFeatures(
    {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: geomGeoJson4326,
          properties: {},
        },
      ],
    },
    {
      dataProjection: 'EPSG:4326',
      featureProjection: viewProj,
    }
  );
  if (features.length === 0) return [];
  const geomType = features[0].getGeometry()?.getType();
  if (geomType === 'Point' || geomType === 'MultiPoint') {
    features[0].set('isRadarPoint', true);
  }
  return features;
}

/**
 * 민원 선택 — 데이터조회/재난대응시설과 동일한 붉은 펄스·동심원 강조.
 * 새 항목은 지도 확대가 끝난 뒤에만 그려서, 축소 화면에서 범위색이 화면을 덮지 않게 한다.
 */
export function useComplaintMapHighlight(
  mapReady: boolean,
  geomGeoJson4326: Record<string, unknown> | null | undefined,
  selectionKey: number | string | null = null
) {
  const mapContext = useMapContext();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const pulsePhaseRef = useRef(0);
  const shownKeyRef = useRef<number | string | null>(null);
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
      shownKeyRef.current = null;
      setRadarActive(false);
    };
  }, [mapReady, mapContext?.mapInstanceRef]);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    const source = sourceRef.current;
    const layer = layerRef.current;
    if (!map || !source) return;

    const hide = () => {
      source.clear();
      layer?.setVisible(false);
      setRadarActive(false);
    };

    if (!looksLikeGeoJsonGeometry(geomGeoJson4326) || selectionKey == null) {
      hide();
      shownKeyRef.current = null;
      return;
    }

    let cancelled = false;
    let revealed = false;

    const reveal = () => {
      if (cancelled || revealed) return;
      revealed = true;
      const features = featuresFromGeom(map, geomGeoJson4326);
      source.clear();
      if (features.length === 0) {
        layer?.setVisible(false);
        setRadarActive(false);
        shownKeyRef.current = null;
        return;
      }
      source.addFeatures(features);
      layer?.setVisible(true);
      setRadarActive(true);
      shownKeyRef.current = selectionKey;
    };

    if (shownKeyRef.current === selectionKey) {
      reveal();
      return;
    }

    hide();
    shownKeyRef.current = null;

    const unsub = subscribeComplaintFlyComplete(reveal);
    const fallback = window.setTimeout(reveal, HIGHLIGHT_FALLBACK_MS);
    return () => {
      cancelled = true;
      unsub();
      window.clearTimeout(fallback);
    };
  }, [geomGeoJson4326, selectionKey, mapContext?.mapInstanceRef]);
}
