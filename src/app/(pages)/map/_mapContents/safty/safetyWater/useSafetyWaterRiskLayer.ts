'use client';

import { useEffect, useRef } from 'react';
import type Map from 'ol/Map';
import Feature from 'ol/Feature';
import Polygon from 'ol/geom/Polygon';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { fromLonLat } from 'ol/proj';
import { Style, Fill, Stroke } from 'ol/style';
import { riskFillRgba, riskStrokeRgba } from './safetyWaterDummyRisk';
import type { SafetyWaterRiskArea } from './safetyWaterTypes';

function riskStyle(riskLevelOrProximity: number | string) {
  return new Style({
    fill: new Fill({ color: riskFillRgba(riskLevelOrProximity) }),
    stroke: new Stroke({ color: riskStrokeRgba(riskLevelOrProximity), width: 1.4 }),
  });
}

export function useSafetyWaterRiskLayer(
  mapReady: boolean,
  map: Map | null,
  active: boolean,
  areas: SafetyWaterRiskArea[]
) {
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);

  useEffect(() => {
    if (!mapReady || !map || !active) return;

    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      zIndex: 110,
      properties: { id: 'safetyWaterFloodRisk' },
      style: (feature) => {
        const f = feature as Feature;
        const riskLevel = String(f.get('riskLevel') ?? '');
        if (riskLevel) return riskStyle(riskLevel);
        const p = Number(f.get('proximity') ?? 0.5);
        return riskStyle(Number.isFinite(p) ? p : 0.5);
      },
    });
    layer.set('safetyWaterFloodRiskLayer', true);
    map.addLayer(layer);
    layerRef.current = layer;

    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
    };
  }, [mapReady, map, active]);

  useEffect(() => {
    if (!active) return;
    const layer = layerRef.current;
    if (!layer) return;
    const source = layer.getSource();
    if (!source) return;
    source.clear();
    for (const area of areas) {
      const coords = area.ring.map(([lon, lat]) => fromLonLat([lon, lat]));
      const f = new Feature({
        geometry: new Polygon([coords]),
        riskId: area.id,
        proximity: area.proximity,
        name: area.name,
        riskLevel: area.riskLevel,
      });
      source.addFeature(f);
    }
    layer.changed();
  }, [active, areas]);
}
