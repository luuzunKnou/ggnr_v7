'use client';

import { useEffect } from 'react';
import type Map from 'ol/Map';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import Draw, { createBox } from 'ol/interaction/Draw';
import { fromCircle } from 'ol/geom/Polygon';
import WKT from 'ol/format/WKT';
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder';

export type SpatialDrawRequest = {
  type: 'rectangle' | 'polygon' | 'circle';
  onComplete: (wkt5181: string) => void;
} | null;

/**
 * 공간 검색·도형 그리기 — 맵마다 독립 Interaction.
 * 좌·우 분할 지도 모두에서 동일 요청으로 그릴 수 있다.
 */
export function useSpatialDrawOnMap(
  map: Map | null,
  enabled: boolean,
  spatialDrawRequest: SpatialDrawRequest,
  setSpatialDrawRequest: ((next: SpatialDrawRequest) => void) | null | undefined,
  blocked: boolean
) {
  useEffect(() => {
    if (!enabled || !map || !spatialDrawRequest || !setSpatialDrawRequest) return;
    if (blocked) return;

    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      visible: true,
      renderOrder: compareFeaturesByGeometryStackOrder,
    });
    layer.set('spatialDrawLayer', true);
    layer.set('mapSplitNoMirror', true);

    const { type, onComplete } = spatialDrawRequest;
    const draw =
      type === 'rectangle'
        ? new Draw({ source, type: 'Circle', geometryFunction: createBox(), stopClick: true })
        : type === 'polygon'
          ? new Draw({ source, type: 'Polygon', stopClick: true })
          : new Draw({ source, type: 'Circle', stopClick: true });

    const onDrawEnd = (e: unknown) => {
      const evt = e as { feature: { getGeometry(): import('ol/geom').Geometry } };
      const rawGeom = evt.feature.getGeometry();
      if (!rawGeom) return;
      try {
        const geom =
          rawGeom.getType() === 'Circle'
            ? fromCircle(rawGeom as import('ol/geom/Circle').default)
            : rawGeom;
        const cloned = geom.clone();
        cloned.transform('EPSG:3857', 'EPSG:5181');
        const wkt = new WKT().writeGeometry(cloned);
        onComplete(wkt);
      } catch (err) {
        console.error('[SpatialDraw] WKT write failed', err);
      }
      setSpatialDrawRequest(null);
      map.removeInteraction(draw);
      map.removeLayer(layer);
    };

    draw.on('drawend', onDrawEnd);
    map.addLayer(layer);
    map.addInteraction(draw);

    return () => {
      map.removeInteraction(draw);
      map.removeLayer(layer);
    };
  }, [enabled, map, spatialDrawRequest, setSpatialDrawRequest, blocked]);
}
