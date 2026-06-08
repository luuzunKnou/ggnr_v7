'use client';

import { useEffect, useRef } from 'react';
import type Map from 'ol/Map';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import { transformExtent } from 'ol/proj';
import type { RoadCctvExtentWgs84 } from '../../../_mapComponents/MapContext';

/**
 * 실시간 통행(5분) 타일 — CCTV 화상자료와 동일한 WGS84 bbox를
 * `/api/its/traffic-tile` 쿼리(z,x,y,minX,maxX,minY,maxY)로 전달합니다.
 * emd 범위가 없으면 레이어를 붙이지 않습니다.
 */
export function useItsTrafficTileLayer(
  mapReady: boolean,
  map: Map | null,
  active: boolean,
  extentWgs84: RoadCctvExtentWgs84 | null
) {
  const layerRef = useRef<TileLayer<XYZ> | null>(null);

  useEffect(() => {
    if (!mapReady || !map) {
      return;
    }

    if (!active || !extentWgs84) {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      return;
    }

    const { minX, maxX, minY, maxY } = extentWgs84;

    const source = new XYZ({
      minZoom: 7,
      maxZoom: 15,
      crossOrigin: 'anonymous',
      tileUrlFunction: (tileCoord) => {
        const z = tileCoord[0];
        const x = tileCoord[1];
        const y = tileCoord[2];
        const q = new URLSearchParams({
          z: String(z),
          x: String(x),
          y: String(y),
          minX: String(minX),
          maxX: String(maxX),
          minY: String(minY),
          maxY: String(maxY),
        });
        return `/api/its/traffic-tile?${q.toString()}`;
      },
    });

    const extent3857 = transformExtent(
      [minX, minY, maxX, maxY],
      'EPSG:4326',
      'EPSG:3857'
    );

    const layer = new TileLayer({
      source,
      opacity: 0.72,
      zIndex: 98,
      extent: extent3857,
      properties: { id: 'itsTrafficRealtime' },
    });
    layer.set('itsTrafficTile', true);

    map.addLayer(layer);
    layerRef.current = layer;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [mapReady, map, active, extentWgs84]);
}
