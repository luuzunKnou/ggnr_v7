'use client';

import { useEffect, useRef } from 'react';
import type Map from 'ol/Map';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { fromLonLat } from 'ol/proj';
import { Style, Fill, Stroke, Text, Icon, Circle as CircleStyle } from 'ol/style';
import { WATER_STATUS_HEX, type WaterStatusLevel } from './safetyWaterStatus';
import type { SafetyWaterStation, SafetyWaterStationKind } from './safetyWaterTypes';

const WATER_STATION_ICON = '/symbol/cus_waves_ps.svg';
const RAIN_STATION_ICON = '/symbol/cus_rainfall_ps.svg';
const STATION_ICON_PX = 18;

/** OL displacement: 양수 = 오른쪽·위쪽. 심볼 우측 상단에 상태 점 배치 */
function statusDotDisplacement(selected: boolean): [number, number] {
  const scale = selected ? 1.15 : 1;
  const half = (STATION_ICON_PX * scale) / 2;
  const dotR = selected ? 4.5 : 4;
  const offset = half + dotR * 0.35;
  const nudge = 1.5;
  return [offset - nudge, offset - nudge];
}

function stationStyle(
  selectedId: string | null,
  featureId: string,
  kind: SafetyWaterStationKind | string,
  name: string,
  statusColor: string | null
): Style[] {
  const selected = selectedId != null && selectedId === featureId;
  const isRain = kind === 'rain';
  const labelColor = isRain ? '#00897B' : '#0B65C6';

  const image = new Icon({
    src: isRain ? RAIN_STATION_ICON : WATER_STATION_ICON,
    scale: selected ? 1.15 : 1,
    anchor: [0.5, 0.5],
  });

  const styles: Style[] = [
    new Style({
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
      zIndex: 1,
    }),
  ];

  if (!isRain && statusColor) {
    const [dx, dy] = statusDotDisplacement(selected);
    styles.push(
      new Style({
        image: new CircleStyle({
          radius: selected ? 4.5 : 4,
          fill: new Fill({ color: statusColor }),
          stroke: new Stroke({ color: '#ffffff', width: 1.5 }),
          displacement: [dx, dy],
        }),
        zIndex: 2,
      })
    );
  }

  return styles;
}

export function useSafetyWaterMapLayer(
  mapReady: boolean,
  map: Map | null,
  active: boolean,
  stations: SafetyWaterStation[],
  selectedId: string | null,
  waterStatusById: Record<string, WaterStatusLevel>,
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
        const level = waterStatusById[k];
        const statusColor = level ? WATER_STATUS_HEX[level] : null;
        return stationStyle(selectedId, k, kind, name, statusColor);
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
      const level = waterStatusById[k];
      const statusColor = level ? WATER_STATUS_HEX[level] : null;
      return stationStyle(selectedId, k, kind, name, statusColor);
    });
    layer.changed();
  }, [active, selectedId, waterStatusById]);
}
