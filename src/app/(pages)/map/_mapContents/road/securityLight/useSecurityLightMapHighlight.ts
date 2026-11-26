'use client';

import { useEffect, useRef } from 'react';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import type { Map as OlMap } from 'ol';
import type { MapBrowserEvent } from 'ol';
import { unByKey } from 'ol/Observable';
import {
  lonLatTo3857,
  type SecurityLightListItem,
} from './securityLightTypes';

const LAYER_KEY = 'securityLightHighlight';
/** 포인터 근접만 — 너무 넓으면 먼 점까지 목록에 섞임 */
const HIT_RADIUS_MAX_PX = 22;
const HIT_RADIUS_MIN_PX = 12;
const HIT_LIST_CAP = 40;

/** 축소 시에만 살짝 넓히고, 기본은 포인터 근처만 */
function hitRadiusPx(zoom: number | undefined): number {
  const z = Number.isFinite(zoom) ? (zoom as number) : 15;
  if (z <= 12) return HIT_RADIUS_MAX_PX;
  if (z <= 14) return 18;
  if (z <= 16) return 14;
  return HIT_RADIUS_MIN_PX;
}

const styleSupply = new Style({
  zIndex: 1,
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: 'rgba(37, 99, 235, 0.85)' }),
    stroke: new Stroke({ color: '#fff', width: 2 }),
  }),
});

const stylePublic = new Style({
  zIndex: 1,
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: 'rgba(16, 185, 129, 0.85)' }),
    stroke: new Stroke({ color: '#fff', width: 2 }),
  }),
});

/** 선택 강조 — 겹친 점 위로 올려 빨간 채움이 가려지지 않게 */
const styleSelected = new Style({
  zIndex: 20,
  image: new CircleStyle({
    radius: 10,
    fill: new Fill({ color: 'rgba(220, 38, 38, 1)' }),
    stroke: new Stroke({ color: '#fff', width: 3 }),
  }),
});

export type SecurityLightMapHit = {
  key: string;
  label: string;
};

export type SecurityLightMapHitEvent = {
  hits: SecurityLightMapHit[];
  /** 지도 Overlay 위치 (EPSG:3857) */
  coordinate: [number, number];
};

function findLayer(map: OlMap): VectorLayer<VectorSource> | null {
  for (const layer of map.getLayers().getArray()) {
    if (layer.get(LAYER_KEY)) return layer as VectorLayer<VectorSource>;
  }
  return null;
}

function ensureLayer(map: OlMap): VectorLayer<VectorSource> {
  const existing = findLayer(map);
  if (existing) return existing;
  const layer = new VectorLayer({
    source: new VectorSource(),
    zIndex: 55,
    properties: { [LAYER_KEY]: true },
  });
  map.addLayer(layer);
  return layer;
}

function hitLabel(item: SecurityLightListItem): string {
  const loc = item.location.trim() && item.location !== '-' ? item.location : '(위치 없음)';
  const no = item.manageNo.trim() || item.id;
  return `[${item.sourceLabel}] ${loc} · ${no}`;
}

export function useSecurityLightMapHighlight(
  map: OlMap | null | undefined,
  items: SecurityLightListItem[],
  selectedKey: string | null,
  options?: {
    removeOnUnmount?: boolean;
    /** 클릭 건(1건 이상). 겹치면 여러 건 + 클릭 좌표 */
    onMapHits?: (evt: SecurityLightMapHitEvent) => void;
  }
) {
  const removeOnUnmount = options?.removeOnUnmount ?? true;
  const onMapHits = options?.onMapHits;
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const onMapHitsRef = useRef(onMapHits);
  onMapHitsRef.current = onMapHits;
  const itemsByKeyRef = useRef(new Map<string, SecurityLightListItem>());
  itemsByKeyRef.current = new Map(items.map((it) => [it.key, it]));

  useEffect(() => {
    if (!map) return;
    const layer = ensureLayer(map);
    layerRef.current = layer;
    const source = layer.getSource();
    if (!source) return;
    source.clear();

    // 선택 건을 마지막에 넣어 겹침 시에도 위에 그리기
    const ordered = selectedKey
      ? [...items.filter((it) => it.key !== selectedKey), ...items.filter((it) => it.key === selectedKey)]
      : items;
    for (const item of ordered) {
      if (item.lon == null || item.lat == null) continue;
      if (!Number.isFinite(item.lon) || !Number.isFinite(item.lat)) continue;
      const [x, y] = lonLatTo3857(item.lon, item.lat);
      const feature = new Feature({ geometry: new Point([x, y]) });
      feature.setId(item.key);
      feature.set('securityLightKey', item.key);
      feature.set('hitLabel', hitLabel(item));
      const selected = item.key === selectedKey;
      feature.setStyle(
        selected
          ? styleSelected
          : item.source === 'public'
            ? stylePublic
            : styleSupply
      );
      source.addFeature(feature);
    }
  }, [map, items, selectedKey]);

  useEffect(() => {
    if (!map || !onMapHits) return;
    const handleClick = (evt: MapBrowserEvent<PointerEvent>) => {
      const layer = findLayer(map) ?? layerRef.current;
      const source = layer?.getSource();
      if (!source) return;

      const [px, py] = evt.pixel;
      const radius = hitRadiusPx(map.getView().getZoom());
      const radiusSq = radius * radius;
      const ranked: Array<SecurityLightMapHit & { distSq: number }> = [];
      const seen = new Set<string>();

      for (const feature of source.getFeatures()) {
        const geom = feature.getGeometry();
        if (!(geom instanceof Point)) continue;
        const featurePixel = map.getPixelFromCoordinate(geom.getCoordinates());
        if (!featurePixel) continue;
        const dx = featurePixel[0] - px;
        const dy = featurePixel[1] - py;
        const distSq = dx * dx + dy * dy;
        if (distSq > radiusSq) continue;

        const key = String(feature.get('securityLightKey') ?? feature.getId() ?? '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const item = itemsByKeyRef.current.get(key);
        const label =
          String(feature.get('hitLabel') ?? '').trim() ||
          (item ? hitLabel(item) : key);
        ranked.push({ key, label, distSq });
      }

      if (ranked.length === 0) return;
      ranked.sort((a, b) => a.distSq - b.distSq);
      const hits: SecurityLightMapHit[] = ranked
        .slice(0, HIT_LIST_CAP)
        .map(({ key, label }) => ({ key, label }));
      evt.stopPropagation();
      onMapHitsRef.current?.({
        hits,
        coordinate: evt.coordinate as [number, number],
      });
    };
    const key = map.on('singleclick', handleClick as never);
    return () => {
      if (key) unByKey(key);
    };
  }, [map, onMapHits]);

  useEffect(() => {
    if (!removeOnUnmount) return;
    return () => {
      if (!map) return;
      const layer = findLayer(map) ?? layerRef.current;
      if (layer) {
        map.removeLayer(layer);
        layerRef.current = null;
      }
    };
  }, [map, removeOnUnmount]);
}

export function flyToSecurityLight(
  map: OlMap | null | undefined,
  item: Pick<SecurityLightListItem, 'lon' | 'lat'> | null,
  options?: { minZoom?: number; duration?: number }
) {
  if (!map || !item || item.lon == null || item.lat == null) return;
  if (!Number.isFinite(item.lon) || !Number.isFinite(item.lat)) return;
  const minZoom = options?.minZoom ?? 17;
  const duration = options?.duration ?? 250;
  const center = lonLatTo3857(item.lon, item.lat);
  const current = map.getView().getZoom() ?? minZoom;
  map.getView().animate({
    center,
    zoom: Math.max(current, minZoom),
    duration,
  });
}
