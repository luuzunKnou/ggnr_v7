'use client';

import { useEffect, useRef } from 'react';
import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { fromLonLat } from 'ol/proj';
import { Style, Icon } from 'ol/style';
import type { ItsCctvItem } from './itsCctvTypes';

const CCTV_ICON = '/symbol/cus_cctv_ps.svg';

function cctvStyle(selectedKey: string | null, featureKey: string) {
  const selected = selectedKey === featureKey;
  return new Style({
    image: new Icon({
      src: CCTV_ICON,
      scale: selected ? 1.15 : 1,
      anchor: [0.5, 0.5],
    }),
  });
}

export function useRoadCctvMapLayer(
  mapReady: boolean,
  map: OlMap | null,
  active: boolean,
  items: ItsCctvItem[],
  selectedKey: string | null,
  onSelectKey: (key: string) => void
) {
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const onSelectKeyRef = useRef(onSelectKey);
  onSelectKeyRef.current = onSelectKey;

  useEffect(() => {
    if (!mapReady || !map || !active) return;

    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      zIndex: 120,
      properties: { id: 'roadCctvOverlay' },
      style: (feature) => {
        const k = String((feature as Feature).get('cctvKey') ?? '');
        return cctvStyle(selectedKey, k);
      },
    });
    layer.set('roadCctvLayer', true);
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
    for (const it of items) {
      const f = new Feature({
        geometry: new Point(fromLonLat([it.coordx, it.coordy])),
        cctvKey: it.key,
        cctvname: it.cctvname,
      });
      source.addFeature(f);
    }
    layer.changed();
  }, [active, items]);

  useEffect(() => {
    if (!active) return;
    const layer = layerRef.current;
    if (!layer) return;
    layer.setStyle((feature) => {
      const k = String((feature as Feature).get('cctvKey') ?? '');
      return cctvStyle(selectedKey, k);
    });
    layer.changed();
  }, [active, selectedKey]);
}
