'use client';

import { useEffect, useMemo, useRef } from 'react';
import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { fromLonLat } from 'ol/proj';
import { Style, Icon } from 'ol/style';
import type { ItsCctvItem } from '../../road/roadCCTV/itsCctvTypes';
import { SAFETY_WATER_LAYER_Z } from './useSafetyWaterMapLayer';

/** OL 레이어 id = public/symbol 파일 stem (선택 테두리는 별도 파일) */
const CCTV_LAYER_ID = 'cus_cctv_ps';
const CCTV_ICON = `/symbol/${CCTV_LAYER_ID}.svg`;
/** 침수/홍수 현황 전용 — 선택 시 바깥쪽 빨간 테두리(22px 캔버스) */
const CCTV_ICON_SELECTED = `/symbol/${CCTV_LAYER_ID}_selected.svg`;
const CCTV_BASE_PX = 18;
const CCTV_SELECTED_PX = 22;
/** 토글칩·목록에 안 맞는 CCTV 심볼 불투명도 */
const FILTERED_OUT_OPACITY = 0.5;

/** 전체=기본, 관측소 목록=선명·나머지 흐림, 선택=확대+바깥 빨간 테두리 */
function cctvStyle(
  selectedKey: string | null,
  listKeys: Set<string>,
  featureKey: string
) {
  const selected = selectedKey != null && selectedKey === featureKey;
  const inList = listKeys.has(featureKey);
  const baseScale = selected ? (CCTV_BASE_PX * 1.15) / CCTV_SELECTED_PX : 1;
  return new Style({
    image: new Icon({
      src: selected ? CCTV_ICON_SELECTED : CCTV_ICON,
      scale: baseScale,
      anchor: [0.5, 0.5],
      opacity: inList ? 1 : FILTERED_OUT_OPACITY,
    }),
  });
}

export function useSafetyWaterNearbyCctvLayer(
  mapReady: boolean,
  map: OlMap | null,
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
      zIndex: SAFETY_WATER_LAYER_Z.cctv,
      properties: { id: CCTV_LAYER_ID },
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
