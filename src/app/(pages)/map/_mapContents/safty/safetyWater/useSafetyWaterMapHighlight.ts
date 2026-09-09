'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { fromLonLat } from 'ol/proj';
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
} from '@/lib/mapDataQueryMapHighlight';
import { SAFETY_WATER_LAYER_Z } from './useSafetyWaterMapLayer';
import type { SafetyWaterStation } from './safetyWaterTypes';

/** 침수현황 선택 관측소 — 타 메뉴와 동일한 빨간 펄스(레이더) 강조 */
export function useSafetyWaterMapHighlight(
  mapReady: boolean,
  map: OlMap | null,
  active: boolean,
  selectedStation: SafetyWaterStation | null
) {
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const pulsePhaseRef = useRef(0);
  const [radarActive, setRadarActive] = useState(false);

  const selectedKey = useMemo(() => {
    if (!selectedStation) return '';
    return `${selectedStation.id}:${selectedStation.lon},${selectedStation.lat}`;
  }, [selectedStation]);

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
    if (!mapReady || !map || !active) return;

    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({
      source,
      style: createDataQuerySelectionRowHighlightStyle(() => pulsePhaseRef.current),
      zIndex: SAFETY_WATER_LAYER_Z.highlight,
    });
    layer.set('safetyWaterStationHighlight', true);
    map.addLayer(layer);
    layerRef.current = layer;

    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
      sourceRef.current = null;
      setRadarActive(false);
    };
  }, [mapReady, map, active]);

  useEffect(() => {
    const source = sourceRef.current;
    if (!source) return;
    source.clear();
    setRadarActive(false);

    if (!selectedStation) return;
    const lon = selectedStation.lon;
    const lat = selectedStation.lat;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

    const f = new Feature({
      geometry: new Point(fromLonLat([lon, lat])),
    });
    f.set('isRadarPoint', true);
    source.addFeature(f);
    setRadarActive(true);
  }, [selectedKey, selectedStation]);
}
