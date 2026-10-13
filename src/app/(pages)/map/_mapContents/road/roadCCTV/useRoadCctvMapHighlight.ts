'use client';

import { useEffect, useRef, useState } from 'react';
import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { fromLonLat } from 'ol/proj';
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder';
import {
  createDataQuerySelectionRowHighlightStyle,
  DATA_QUERY_SELECTION_PULSE_STEP,
  insertLayerBelowServiceLayer,
} from '@/lib/mapDataQueryMapHighlight';
import type { ItsCctvItem } from './itsCctvTypes';

/**
 * 교통정보 CCTV 선택 — 데이터조회와 동일한 붉은 펄스 강조 오버레이.
 * 서비스(기존) WMS 아래에 두어 기본 레이어·라벨이 위에 보이게 한다.
 */
export function useRoadCctvMapHighlight(
  mapReady: boolean,
  map: OlMap | null,
  active: boolean,
  items: ItsCctvItem[],
  selectedKey: string | null
) {
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
    if (!mapReady || !map) return;
    if (!active) {
      sourceRef.current?.clear();
      setRadarActive(false);
      return;
    }

    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({
      source,
      renderOrder: compareFeaturesByGeometryStackOrder,
      style: createDataQuerySelectionRowHighlightStyle(() => pulsePhaseRef.current),
    });
    layer.set('roadCctvHighlight', true);
    insertLayerBelowServiceLayer(map, layer);

    return () => {
      map.removeLayer(layer);
      sourceRef.current = null;
      setRadarActive(false);
    };
  }, [mapReady, map, active]);

  useEffect(() => {
    const source = sourceRef.current;
    if (!source) return;

    source.clear();
    setRadarActive(false);

    if (!active || !selectedKey) return;
    const it = items.find((x) => x.key === selectedKey);
    if (!it) return;

    const lon = Number(it.coordx);
    const lat = Number(it.coordy);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

    const feature = new Feature({
      geometry: new Point(fromLonLat([lon, lat])),
      cctvKey: it.key,
    });
    feature.set('isRadarPoint', true);
    source.addFeature(feature);
    setRadarActive(true);
  }, [active, items, selectedKey]);
}
