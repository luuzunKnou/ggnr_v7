import { useEffect, useRef, useState, type RefObject } from 'react';
import { Map, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import { defaults } from 'ol/control';
import { getTransform } from 'ol/proj';
import '../config/projections'; // 좌표계 등록
import { DEFAULT_CENTER_LON, DEFAULT_CENTER_LAT, DEFAULT_ZOOM_2D, RESOLUTIONS_3857 } from '../config/mapDefaults';
import { createCadastralLayers, createBuildingRoadLayers } from '../layerFactory/boundaryLayerFactory';
import { createBasicSectionLayers } from '../layerFactory/basicSectionLayerFactory';
import { createJimokLayers } from '../layerFactory/jimokLayerFactory';
import { createLandownLayers } from '../layerFactory/landownLayerFactory';
import { createSafetydataMapLayers } from '../layerFactory/safetydataMapLayerFactory';
import { createServiceLayer } from '../layerFactory/serviceLayerFactory';
import { loadPersistedMapState } from './useMapStatePersist';

/**
 * OpenLayers 지도 인스턴스 생성 및 관리 훅
 * @param mapRef - 지도가 렌더될 div ref
 * @param externalMapRef - 외부에서 지도 인스턴스를 공유할 ref (예: MapContext)
 * @returns { mapInstanceRef, mapReady } mapReady는 맵 생성 후 true가 되어 줌 등 구독 시점 보장
 */
export function useMapInstance(
  mapRef: RefObject<HTMLDivElement | null>,
  externalMapRef?: RefObject<Map | null> | null,
) {
  const mapInstanceRef = useRef<Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // useEffect는 클라이언트에서만 실행되므로 localStorage 접근 안전
    const persisted = loadPersistedMapState();

    const to3857 = getTransform('EPSG:4326', 'EPSG:3857');
    const defaultCenter = to3857([DEFAULT_CENTER_LON, DEFAULT_CENTER_LAT]);

    const initialCenter = persisted ? [persisted.centerX, persisted.centerY] : defaultCenter;
    const initialZoom = persisted?.zoom ?? DEFAULT_ZOOM_2D;

    const map = new Map({
      target: mapRef.current,
      layers: [
        new TileLayer({
          source: new OSM(),
          properties: { name: 'background' },
        }),
        ...createCadastralLayers(),
        ...createBuildingRoadLayers(),
        ...createBasicSectionLayers(),
        ...createJimokLayers(),
        ...createLandownLayers(),
        ...createSafetydataMapLayers(),
      ],
      view: new View({
        center: initialCenter,
        zoom: initialZoom,
        resolutions: RESOLUTIONS_3857,
        minZoom: 0,
        maxZoom: RESOLUTIONS_3857.length - 1,
        constrainResolution: true,
      }),
      controls: defaults({
        zoom: false,
        attribution: false,
      }),
    });

    mapInstanceRef.current = map;
    if (externalMapRef) externalMapRef.current = map;
    setMapReady(true);

    const serviceLayer = createServiceLayer();
    map.getLayers().push(serviceLayer);

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
