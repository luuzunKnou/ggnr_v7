'use client';

import { useEffect, useMemo, useRef } from 'react';
import type Map from 'ol/Map';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { fromLonLat } from 'ol/proj';
import { Style, Circle as CircleStyle, Fill, Stroke } from 'ol/style';
import type { ItsCctvItem } from '../../road/roadCCTV/itsCctvTypes';

/** 전체=기본 파랑, 관측소 목록=파랑·나머지 흐림, 선택=빨강 */
function cctvStyle(
  selectedKey: string | null,
  listKeys: Set<string>,
  featureKey: string
) {
  const selected = selectedKey != null && selectedKey === featureKey;
  const inList = listKeys.has(featureKey);
  if (selected) {
    return new Style({
      image: new CircleStyle({
        radius: 10,
        fill: new Fill({ color: 'rgba(239, 68, 68, 0.7)' }),
        stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.9)', width: 2 }),
      }),
    });
  }
  if (inList) {
    return new Style({
      image: new CircleStyle({
        radius: 8,
        fill: new Fill({ color: 'rgba(37, 99, 235, 0.75)' }),
        stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.9)', width: 2 }),
      }),
    });
  }
  return new Style({
    image: new CircleStyle({
      radius: 6,
      fill: new Fill({ color: 'rgba(59, 130, 246, 0.28)' }),
      stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.45)', width: 1.5 }),
    }),
  });
}

export function useSafetyWaterNearbyCctvLayer(
  mapReady: boolean,
  map: Map | null,
  active: boolean,
  layerItems: ItsCctvItem[],
  listItems: ItsCctvItem[],
  selectedKey: string | null,
  onSelectKey: (key: string) => void
) {
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const onSelectKeyRef = useRef(onSelectKey);
  onSelectKeyRef.current = onSelectKey;
  const listKeySet = useMemo(() => new Set(listItems.map((x) => x.key)), [listItems]);

  useEffect(() => {
    if (!mapReady || !map || !active) return;

    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      zIndex: 121,
      properties: { id: 'safetyWaterNearbyCctv' },
      style: (feature) => {
        const k = String((feature as Feature).get('cctvKey') ?? '');
        return cctvStyle(selectedKey, listKeySet, k);
      },
    });
    layer.set('safetyWaterNearbyCctvLayer', true);
    map.addLayer(layer);
    layerRef.current = layer;

    const onClick = (evt: { pixel: import('ol/pixel').Pixel }) => {
      const feats = map.getFeaturesAtPixel(evt.pixel, {
        layerFilter: (lyr) => lyr === layer,
        hitTolerance: 10,
      });
      const f = feats[0];
      if (f && typeof (f as Feature).get === 'function') {
        const k = (f as Feature).get('cctvKey');
        if (typeof k === 'string') onSelectKeyRef.current(k);
      }
    };
    map.on('singleclick', onClick);

    return () => {
      map.un('singleclick', onClick);
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
    for (const it of layerItems) {
      const f = new Feature({
        geometry: new Point(fromLonLat([it.coordx, it.coordy])),
        cctvKey: it.key,
        cctvname: it.cctvname,
      });
      source.addFeature(f);
    }
    layer.changed();
  }, [active, layerItems]);

  useEffect(() => {
    if (!active) return;
    const layer = layerRef.current;
    if (!layer) return;
    layer.setStyle((feature) => {
      const k = String((feature as Feature).get('cctvKey') ?? '');
      return cctvStyle(selectedKey, listKeySet, k);
    });
    layer.changed();
  }, [active, selectedKey, listKeySet]);
}
