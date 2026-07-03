'use client';

import { useEffect, useRef } from 'react';
import Feature from 'ol/Feature';
import WKT from 'ol/format/WKT';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style } from 'ol/style';
import { useMapContext } from '../../_mapComponents/MapContext';
import { scheduleFitMapToExtent3857 } from '../../_mapComponents/config/mapAutoNavigation';
import { MAP_AUTO_NAV_MAX_ZOOM } from '../../_mapComponents/config/mapDefaults';

/** 시군구 경계(850) 위에 확정 영역을 강조 */
const AREA_LAYER_Z = 860;

const areaStyle = new Style({
  stroke: new Stroke({ color: 'rgba(37, 99, 235, 1)', width: 2.5 }),
  fill: new Fill({ color: 'rgba(37, 99, 235, 0.18)' }),
});

/**
 * 확정된 분석 영역(도형·행정경계 WKT)을 지도에 강조 표시하고 해당 영역으로 화면을 맞춘다.
 * fit 시 좌측 패널 폭을 view.padding에 반영해 패널 열림과 이동을 한 번에 처리한다.
 */
export function useParcelAnalysisAreaLayer(active: boolean, wkt5181: string | null) {
  const mapContext = useMapContext();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);

  useEffect(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!map || !active || !wkt5181) return;

    let geom;
    try {
      geom = new WKT().readGeometry(wkt5181, {
        dataProjection: 'EPSG:5181',
        featureProjection: 'EPSG:3857',
      });
    } catch {
      return;
    }

    const source = new VectorSource({ features: [new Feature(geom)] });
    const layer = new VectorLayer({ source, style: areaStyle, zIndex: AREA_LAYER_Z });
    layer.set('parcelAnalysisArea', true);
    map.addLayer(layer);
    layerRef.current = layer;

    scheduleFitMapToExtent3857(map, geom.getExtent(), {
      maxZoom: MAP_AUTO_NAV_MAX_ZOOM,
      applyMapViewPadding: () => mapContext?.applyMapViewPaddingRef?.current?.(),
    });

    return () => {
      map.removeLayer(layer);
      if (layerRef.current === layer) layerRef.current = null;
    };
  }, [active, wkt5181, mapContext?.mapInstanceRef, mapContext?.applyMapViewPaddingRef]);
}
