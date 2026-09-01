'use client';

import { useEffect, useRef } from 'react';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import type { Map as OlMap } from 'ol';
import { lonLatTo3857, type RoadFrontageMarkerItem } from './roadFrontageMarkerMock';

const LAYER_KEY = 'roadFrontageMarkerHighlight';

const styleNormal = new Style({
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: 'rgba(37, 99, 235, 0.85)' }),
    stroke: new Stroke({ color: '#fff', width: 2 }),
  }),
});

const styleSelected = new Style({
  image: new CircleStyle({
    radius: 8,
    fill: new Fill({ color: 'rgba(220, 38, 38, 0.9)' }),
    stroke: new Stroke({ color: '#fff', width: 2 }),
  }),
});

function findMarkerLayer(map: OlMap): VectorLayer<VectorSource> | null {
  for (const layer of map.getLayers().getArray()) {
    if (layer.get(LAYER_KEY)) return layer as VectorLayer<VectorSource>;
  }
  return null;
}

function ensureMarkerLayer(map: OlMap): VectorLayer<VectorSource> {
  const existing = findMarkerLayer(map);
  if (existing) return existing;
  const layer = new VectorLayer({
    source: new VectorSource(),
    zIndex: 50,
    properties: { [LAYER_KEY]: true },
  });
  map.addLayer(layer);
  return layer;
}

/**
 * 표주 점을 지도 벡터 레이어에 표시.
 * 목록·상세가 같은 레이어를 공유한다. 메뉴(목록) 언마운트 시에만 제거.
 * enabled=false 이면 레이어 내용을 건드리지 않는다(상세가 소유할 때).
 */
export function useRoadFrontageMarkerMapHighlight(
  map: OlMap | null | undefined,
  markers: RoadFrontageMarkerItem[],
  selectedId: string | null,
  options?: { removeOnUnmount?: boolean; enabled?: boolean }
) {
  const removeOnUnmount = options?.removeOnUnmount ?? false;
  const enabled = options?.enabled ?? true;
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);

  useEffect(() => {
    if (!map || !enabled) return;

    const layer = ensureMarkerLayer(map);
    layerRef.current = layer;
    const source = layer.getSource();
    if (!source) return;
    source.clear();

    for (const m of markers) {
      const lon = m.lon;
      const lat = m.lat;
      if (lon == null || lat == null || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const [x, y] = lonLatTo3857(lon, lat);
      const feature = new Feature({ geometry: new Point([x, y]) });
      feature.setId(m.id);
      feature.setStyle(m.id === selectedId ? styleSelected : styleNormal);
      source.addFeature(feature);
    }
  }, [map, markers, selectedId, enabled]);

  useEffect(() => {
    if (!removeOnUnmount) return;
    return () => {
      if (!map) return;
      const layer = findMarkerLayer(map) ?? layerRef.current;
      if (layer) {
        map.removeLayer(layer);
        layerRef.current = null;
      }
    };
  }, [map, removeOnUnmount]);
}

export function fitMapToMarkerPoints(
  map: OlMap | null | undefined,
  markers: RoadFrontageMarkerItem[],
  padding = 80
) {
  if (!map) return;
  const coords: [number, number][] = [];
  for (const m of markers) {
    if (m.lon == null || m.lat == null) continue;
    if (!Number.isFinite(m.lon) || !Number.isFinite(m.lat)) continue;
    coords.push(lonLatTo3857(m.lon, m.lat));
  }
  if (coords.length === 0) return;
  if (coords.length === 1) {
    map.getView().animate({
      center: coords[0],
      zoom: Math.max(map.getView().getZoom() ?? 14, 16),
      duration: 250,
    });
    return;
  }
  let minX = coords[0]![0];
  let minY = coords[0]![1];
  let maxX = minX;
  let maxY = minY;
  for (const [x, y] of coords) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  map.getView().fit([minX, minY, maxX, maxY], {
    padding: [padding, padding, padding, padding],
    duration: 250,
    maxZoom: 17,
  });
}

export function flyToMarker(map: OlMap | null | undefined, item: RoadFrontageMarkerItem) {
  if (!map || item.lon == null || item.lat == null) return;
  if (!Number.isFinite(item.lon) || !Number.isFinite(item.lat)) return;
  const center = lonLatTo3857(item.lon, item.lat);
  map.getView().animate({
    center,
    zoom: Math.max(map.getView().getZoom() ?? 15, 17),
    duration: 250,
  });
}
