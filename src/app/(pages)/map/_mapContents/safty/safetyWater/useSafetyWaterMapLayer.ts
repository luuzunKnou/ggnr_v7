'use client';

import { useEffect, useRef } from 'react';
import type Map from 'ol/Map';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { fromLonLat } from 'ol/proj';
import { Style, Circle as CircleStyle, Fill, Stroke, Text, Icon } from 'ol/style';
import type { SafetyWaterStation, SafetyWaterStationKind } from './safetyWaterTypes';

/** 구조물도(교량)와 동일 SVG */
const WATER_STATION_ICON = '/symbol/river_plan_gd_ps_gr.svg';

function stationStyle(
  selectedId: string | null,
  featureId: string,
  kind: SafetyWaterStationKind | string,
  name: string
) {
  const selected = selectedId != null && selectedId === featureId;
  const isRain = kind === 'rain';
  const labelColor = isRain ? '#15803d' : '#DE7979';

  const image = isRain
    ? new CircleStyle({
        radius: selected ? 10 : 7,
        fill: new Fill({
          color: selected ? 'rgba(22, 163, 74, 0.9)' : 'rgba(34, 197, 94, 0.75)',
        }),
        stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.85)', width: 2 }),
      })
    : new Icon({
        src: WATER_STATION_ICON,
        scale: selected ? 1.15 : 1,
        anchor: [0.5, 0.5],
      });

  return new Style({
    image,
    text: new Text({
      text: name || '',
      font: selected ? '600 12px sans-serif' : '500 11px sans-serif',
      fill: new Fill({ color: labelColor }),
      stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.95)', width: 3 }),
      offsetY: selected ? 16 : 14,
      textAlign: 'center',
      textBaseline: 'top',
    }),
  });
}

export function useSafetyWaterMapLayer(
  mapReady: boolean,
  map: Map | null,
  active: boolean,
  stations: SafetyWaterStation[],
  selectedId: string | null,
  onSelectId: (id: string) => void
) {
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const onSelectIdRef = useRef(onSelectId);
  onSelectIdRef.current = onSelectId;

  useEffect(() => {
    if (!mapReady || !map || !active) return;

    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      zIndex: 120,
      properties: { id: 'safetyWaterStationOverlay' },
      style: (feature) => {
        const f = feature as Feature;
        const k = String(f.get('stationId') ?? '');
        const kind = String(f.get('stationKind') ?? 'water');
        const name = String(f.get('stationName') ?? '');
        return stationStyle(selectedId, k, kind, name);
      },
    });
    layer.set('safetyWaterStationLayer', true);
    map.addLayer(layer);
    layerRef.current = layer;

    const onClick = (evt: { pixel: import('ol/pixel').Pixel }) => {
      const feats = map.getFeaturesAtPixel(evt.pixel, {
        layerFilter: (lyr) => lyr === layer,
        hitTolerance: 10,
      });
      const f = feats[0];
      if (f && typeof (f as Feature).get === 'function') {
        const id = (f as Feature).get('stationId');
        if (typeof id === 'string') onSelectIdRef.current(id);
      }
    };
    map.on('singleclick', onClick);

    return () => {
      map.un('singleclick', onClick);
      map.removeLayer(layer);
      layerRef.current = null;
    };
    // selectedId는 스타일 effect에서 갱신
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 레이어 수명은 mapReady/map/active만
  }, [mapReady, map, active]);

  useEffect(() => {
    if (!active) return;
    const layer = layerRef.current;
    if (!layer) return;
    const source = layer.getSource();
    if (!source) return;
    source.clear();
    for (const st of stations) {
      const f = new Feature({
        geometry: new Point(fromLonLat([st.lon, st.lat])),
        stationId: st.id,
        stationName: st.name,
        stationKind: st.kind,
      });
      source.addFeature(f);
    }
    layer.changed();
  }, [active, stations]);

  useEffect(() => {
    if (!active) return;
    const layer = layerRef.current;
    if (!layer) return;
    layer.setStyle((feature) => {
      const f = feature as Feature;
      const k = String(f.get('stationId') ?? '');
      const kind = String(f.get('stationKind') ?? 'water');
      const name = String(f.get('stationName') ?? '');
      return stationStyle(selectedId, k, kind, name);
    });
    layer.changed();
  }, [active, selectedId]);
}
