import { useEffect, useRef, useState, type RefObject } from 'react';
import { Map, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import { defaults } from 'ol/control';
import { getTransform } from 'ol/proj';
import '../config/projections'; // 좌표계 등록
import { createInitialPgTileservLayers } from '../boundaryLayerFactory';
import { createIndexLayers, createServiceLayerViewLayer } from '../indexLayerFactory';

// 안동 중심 (경도, 위도 WGS84)
const ANDONG_LON = 128.7229;
const ANDONG_LAT = 36.5664;

/**
 * OpenLayers 지도 인스턴스 생성 및 관리 훅
 * @param mapRef - 지도가 렌더될 div ref
 * @param externalMapRef - 외부에서 지도 인스턴스를 공유할 ref (예: MapContext)
 * @returns { mapInstanceRef, mapReady } mapReady는 맵 생성 후 true가 되어 줌 등 구독 시점 보장
 */
export function useMapInstance(
  mapRef: RefObject<HTMLDivElement | null>,
  externalMapRef?: RefObject<Map | null> | null
) {
  const mapInstanceRef = useRef<Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // OpenLayers 지도 생성 (기본 위치: 안동)
    const to3857 = getTransform('EPSG:4326', 'EPSG:3857');
    const center3857 = to3857([ANDONG_LON, ANDONG_LAT]);

    const map = new Map({
      target: mapRef.current,
      layers: [
        new TileLayer({
          source: new OSM(),
          properties: { name: 'background' },
        }),
        ...createInitialPgTileservLayers(),
        createServiceLayerViewLayer(),
      ],
      view: new View({
        center: center3857,
        zoom: 10,
      }),
      controls: defaults({
        zoom: false,
        attribution: false,
      }),
    });

    mapInstanceRef.current = map;
    if (externalMapRef) externalMapRef.current = map;
    setMapReady(true);

    createIndexLayers()
      .then((indexLayers) => {
        indexLayers.forEach((layer) => map.getLayers().push(layer));
      })
      .catch(() => {});

    // 컴포넌트 언마운트 시 지도 정리
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setTarget(undefined);
        mapInstanceRef.current = null;
      }
      if (externalMapRef) externalMapRef.current = null;
      setMapReady(false);
    };
  }, [mapRef, externalMapRef]);

  return { mapInstanceRef, mapReady };
}
