'use client';

import { useEffect, useRef } from 'react';
import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { fromLonLat } from 'ol/proj';
import { Style, Fill, Stroke, Text, Icon } from 'ol/style';
import type { WaterLevelDelta } from './safetyWaterContext';
import type { StationListFilterChip } from './safetyWaterListFilter';
import { stationMatchesListFilter } from './safetyWaterListFilter';
import type { SafetyWaterStation, SafetyWaterStationKind } from './safetyWaterTypes';

/** CCTV < 강수량 관측소 < 수위 관측소 */
export const SAFETY_WATER_LAYER_Z = {
  cctv: 118,
  rainStation: 119,
  waterStation: 120,
} as const;

/** OL 레이어 id = public/symbol 파일 stem */
const WATER_STATION_LAYER_ID = 'cus_waves_ps';
const RAIN_STATION_LAYER_ID = 'cus_rainfall_ps';
const WATER_STATION_ICON = `/symbol/${WATER_STATION_LAYER_ID}.svg`;
const RAIN_STATION_ICON = `/symbol/${RAIN_STATION_LAYER_ID}.svg`;
const STATION_ICON_PX = 18;

/** 토글칩에 안 맞는 관측소 심볼 불투명도 */
const FILTERED_OUT_OPACITY = 0.5;

const DELTA_UP_COLOR = '#DC2626';
const DELTA_DOWN_COLOR = '#0B65C6';

/** 우측 상단 화살표 오프셋 (OL: 양수 = 오른쪽·위) */
function deltaArrowDisplacement(selected: boolean): [number, number] {
  const scale = selected ? 1.15 : 1;
  const half = (STATION_ICON_PX * scale) / 2;
  const nudge = 1.5;
  const offset = half + 2;
  return [offset - nudge, offset - nudge];
}

function arrowDataUri(delta: 'up' | 'down'): string {
  const color = delta === 'up' ? DELTA_UP_COLOR : DELTA_DOWN_COLOR;
  // lucide ArrowUp / ArrowDown 스타일 (12×12) — 흰색 외곽선 + 색 화살표
  const path =
    delta === 'up'
      ? 'M6 10V2M6 2L2.5 5.5M6 2l3.5 3.5'
      : 'M6 2v8M6 10L2.5 6.5M6 10l3.5-3.5';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 12 12" fill="none"><path d="${path}" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><path d="${path}" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function hexToRgba(hex: string, alpha: number) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return `rgba(0,0,0,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function stationStyle(
  selectedId: string | null,
  featureId: string,
  kind: SafetyWaterStationKind | string,
  name: string,
  delta: WaterLevelDelta,
  opacity: number
): Style[] {
  const selected = selectedId != null && selectedId === featureId;
  const isRain = kind === 'rain';
  const labelColor = isRain ? '#E65100' : '#0B65C6';
  const op = selected ? 1 : opacity;

  const image = new Icon({
    src: isRain ? RAIN_STATION_ICON : WATER_STATION_ICON,
    scale: selected ? 1.15 : 1,
    anchor: [0.5, 0.5],
    opacity: op,
  });

  const styles: Style[] = [
    new Style({
      image,
      text: new Text({
        text: name || '',
        font: selected ? '600 12px sans-serif' : '500 11px sans-serif',
        fill: new Fill({ color: hexToRgba(labelColor, op) }),
        stroke: new Stroke({ color: `rgba(255, 255, 255, ${0.95 * op})`, width: 3 }),
        offsetY: selected ? 16 : 14,
        textAlign: 'center',
        textBaseline: 'top',
      }),
      zIndex: 1,
    }),
  ];

  if (!isRain && (delta === 'up' || delta === 'down')) {
    const [dx, dy] = deltaArrowDisplacement(selected);
    styles.push(
      new Style({
        image: new Icon({
          src: arrowDataUri(delta),
          scale: selected ? 1.1 : 1,
          anchor: [0.5, 0.5],
          displacement: [dx, dy],
          opacity: op,
        }),
        zIndex: 2,
      })
    );
  }

  return styles;
}

function createStationLayer(kind: SafetyWaterStationKind, zIndex: number) {
  return new VectorLayer({
    source: new VectorSource(),
    zIndex,
    properties: { id: kind === 'water' ? WATER_STATION_LAYER_ID : RAIN_STATION_LAYER_ID },
  });
}

export function useSafetyWaterMapLayer(
  mapReady: boolean,
  map: OlMap | null,
  active: boolean,
  stations: SafetyWaterStation[],
  selectedId: string | null,
  waterDeltaById: Record<string, WaterLevelDelta>,
  listFilterChips: readonly StationListFilterChip[],
  stationIdsWithCctv: Set<string> | undefined,
  listSearchQuery: string,
  onSelectId: (id: string) => void
) {
  const rainLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const waterLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const onSelectIdRef = useRef(onSelectId);
  onSelectIdRef.current = onSelectId;

  const stationById = useRef(new Map<string, SafetyWaterStation>());
  stationById.current = new Map(stations.map((st) => [st.id, st]));

  useEffect(() => {
    if (!mapReady || !map || !active) return;

    const rainLayer = createStationLayer('rain', SAFETY_WATER_LAYER_Z.rainStation);
    const waterLayer = createStationLayer('water', SAFETY_WATER_LAYER_Z.waterStation);
    rainLayer.set('safetyWaterStationLayer', true);
    waterLayer.set('safetyWaterStationLayer', true);
    map.addLayer(rainLayer);
    map.addLayer(waterLayer);
    rainLayerRef.current = rainLayer;
    waterLayerRef.current = waterLayer;

    const onClick = (evt: { pixel: import('ol/pixel').Pixel }) => {
      for (const layer of [waterLayer, rainLayer]) {
        const feats = map.getFeaturesAtPixel(evt.pixel, {
          layerFilter: (lyr) => lyr === layer,
          hitTolerance: 10,
        });
        const f = feats[0];
        if (f && typeof (f as Feature).get === 'function') {
          const id = (f as Feature).get('stationId');
          if (typeof id === 'string') {
            onSelectIdRef.current(id);
            return;
          }
        }
      }
    };
    map.on('singleclick', onClick);

    return () => {
      map.un('singleclick', onClick);
      map.removeLayer(rainLayer);
      map.removeLayer(waterLayer);
      rainLayerRef.current = null;
      waterLayerRef.current = null;
    };
  }, [mapReady, map, active]);

  useEffect(() => {
    if (!active) return;
    const rainLayer = rainLayerRef.current;
    const waterLayer = waterLayerRef.current;
    if (!rainLayer || !waterLayer) return;

    const rainSource = rainLayer.getSource();
    const waterSource = waterLayer.getSource();
    if (!rainSource || !waterSource) return;

    rainSource.clear();
    waterSource.clear();
    for (const st of stations) {
      const f = new Feature({
        geometry: new Point(fromLonLat([st.lon, st.lat])),
        stationId: st.id,
        stationName: st.name,
        stationKind: st.kind,
      });
      if (st.kind === 'rain') rainSource.addFeature(f);
      else waterSource.addFeature(f);
    }
    rainLayer.changed();
    waterLayer.changed();
  }, [active, stations]);

  useEffect(() => {
    if (!active) return;
    const rainLayer = rainLayerRef.current;
    const waterLayer = waterLayerRef.current;
    if (!rainLayer || !waterLayer) return;

    rainLayer.setStyle((feature) => {
      const f = feature as Feature;
      const k = String(f.get('stationId') ?? '');
      const name = String(f.get('stationName') ?? '');
      const st = stationById.current.get(k);
      const matched =
        st != null &&
        stationMatchesListFilter(st, listFilterChips, stationIdsWithCctv, listSearchQuery);
      return stationStyle(selectedId, k, 'rain', name, null, matched ? 1 : FILTERED_OUT_OPACITY);
    });
    waterLayer.setStyle((feature) => {
      const f = feature as Feature;
      const k = String(f.get('stationId') ?? '');
      const name = String(f.get('stationName') ?? '');
      const delta = waterDeltaById[k] ?? null;
      const st = stationById.current.get(k);
      const matched =
        st != null &&
        stationMatchesListFilter(st, listFilterChips, stationIdsWithCctv, listSearchQuery);
      return stationStyle(selectedId, k, 'water', name, delta, matched ? 1 : FILTERED_OUT_OPACITY);
    });
    rainLayer.changed();
    waterLayer.changed();
  }, [active, selectedId, waterDeltaById, listFilterChips, stationIdsWithCctv, listSearchQuery, stations]);
}
