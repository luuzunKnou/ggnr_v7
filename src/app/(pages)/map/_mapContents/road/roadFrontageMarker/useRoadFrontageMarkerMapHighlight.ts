'use client';

import { useEffect, useRef } from 'react';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import { useMapContext } from '../../../_mapComponents/MapContext';
import { lonLatTo3857, type RoadFrontageMarkerItem } from './roadFrontageMarkerMock';

const LAYER_KEY = 'roadFrontageMarkerHighlight';

function markerStyle(selected: boolean): Style {
  return new Style({
    image: new CircleStyle({
      radius: selected ? 8 : 6,
      fill: new Fill({ color: selected ? 'rgba(220, 38, 38, 0.95)' : 'rgba(37, 99, 235, 0.9)' }),
      stroke: new Stroke({ color: '#ffffff', width: selected ? 2.5 : 2 }),
    }),
    zIndex: selected ? 2 : 1,
  });
}

/** 선택한 노선의 표주 점을 지도에 표시. 고른 점은 더 크게 강조 */
export function useRoadFrontageMarkerMapHighlight(
  markers: RoadFrontageMarkerItem[],
  selectedMarkerId: string | null,
  active: boolean
) {
  const mapContext = useMapContext();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) return;

    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      zIndex: 920,
    });
    layer.set(LAYER_KEY, true);
    map.addLayer(layer);
    layerRef.current = layer;

    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
    };
  }, [mapContext?.mapInstanceRef]);

  useEffect(() => {
    const source = layerRef.current?.getSource();
    if (!source) return;
    source.clear();
    if (!active || markers.length === 0) return;

    for (const item of markers) {
      const [x, y] = lonLatTo3857(item.mockLonLat.lon, item.mockLonLat.lat);
      const feature = new Feature({ geometry: new Point([x, y]) });
      feature.setId(item.id);
      feature.setStyle(markerStyle(item.id === selectedMarkerId));
      source.addFeature(feature);
    }
  }, [active, markers, selectedMarkerId]);
}
