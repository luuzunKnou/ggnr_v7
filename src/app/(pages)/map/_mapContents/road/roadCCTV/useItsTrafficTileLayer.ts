'use client';

import { useEffect, useRef } from 'react';
import type Map from 'ol/Map';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import { transformExtent } from 'ol/proj';
import { buildItsTrafficTileUrl } from '@/lib/itsClient';
import type { RoadCctvExtentWgs84 } from '../../../_mapComponents/MapContext';

/**
 * 실시간 통행(5분) 타일 — its.go.kr WMTS를 브라우저에서 직접 로드.
 * CCTV와 동일한 WGS84 bbox로 레이어 extent만 제한합니다.
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
        return buildItsTrafficTileUrl(z, x, y);
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
