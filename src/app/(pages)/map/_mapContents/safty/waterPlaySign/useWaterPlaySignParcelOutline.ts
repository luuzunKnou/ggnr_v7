'use client';

import { useEffect, useRef, useState } from 'react';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import GeoJSONFormat from 'ol/format/GeoJSON';
import { useMapContext } from '../../../_mapComponents/MapContext';
import { LAYER_ROW_NEW_ID } from '../../../_mapComponents/layerRowEdit';
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder';
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
} from '@/lib/mapDataQueryMapHighlight';
import type { WaterPlaySignListItem } from '@/service/waterPlaySignService';

/** 구조함(131)·표지판(132)·관리지역(130) WMS보다 아래 — 점은 필지 강조 위에 그린다 */
const PARCEL_OUTLINE_Z = 129;

function looksLikeGeoJsonGeometry(v: unknown): v is Record<string, unknown> & { type: unknown } {
  if (!v || typeof v !== 'object' || !('type' in v)) return false;
  const t = (v as { type?: unknown }).type;
  if (typeof t !== 'string') return false;
  if (t === 'GeometryCollection') return 'geometries' in v;
  return 'coordinates' in v;
}

function geomJsonFromRow(row: WaterPlaySignListItem | null): unknown {
  const raw = row?.geomJson;
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return looksLikeGeoJsonGeometry(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return looksLikeGeoJsonGeometry(raw) ? raw : null;
}

/**
 * 상세가 열린 목록 행의 부모 필지(면)를 민원·데이터조회와 같은 붉은 펄스 강조로 표시한다.
 */
export function useWaterPlaySignParcelOutline(
  mapReady: boolean,
  selected: WaterPlaySignListItem | null,
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
      zIndex: PARCEL_OUTLINE_Z,
    });
    layer.set('waterPlaySignParcelOutline', true);
    map.addLayer(layer);
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

    if (!selected || selected.id === LAYER_ROW_NEW_ID) return;

    const geomJson = geomJsonFromRow(selected);
    if (!geomJson) return;

    const viewProj = map.getView().getProjection()?.getCode() || 'EPSG:3857';
    const features = new GeoJSONFormat().readFeatures(
      {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            geometry: geomJson as Record<string, unknown>,
            properties: {},
          },
        ],
      },
      {
        dataProjection: 'EPSG:4326',
        featureProjection: viewProj,
      }
    );
    if (features.length === 0) return;

    const geomType = features[0].getGeometry()?.getType();
    if (geomType === 'Point' || geomType === 'MultiPoint') return;

    source.addFeatures(features);
    setRadarActive(true);
  }, [mapReady, selected, mapContext?.mapInstanceRef]);
}
