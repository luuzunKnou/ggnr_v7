import { useEffect, useRef, useState, type RefObject } from 'react';
import { Map, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import { defaults } from 'ol/control';
import '../config/projections'; // 좌표계 등록

/**
 * OpenLayers 지도 인스턴스 생성 및 관리 훅
 * @returns Map 인스턴스의 ref (mapInstanceRef.current로 접근)
 */
export function useMapInstance(mapRef: RefObject<HTMLDivElement | null>) {
  const mapInstanceRef = useRef<Map | null>(null);
  // ref는 값이 바뀌어도 리렌더링을 트리거하지 않기 때문에,
  // map 생성 직후 한 번 리렌더링을 발생시켜서(=null→Map),
  // `useBackgroundLayer(mapInstanceRef.current, ...)` 같은 훅들이
  // "첫 버튼 클릭"이 아니라 "초기 로딩" 시점에 map을 받을 수 있게 합니다.
  const [, forceRerender] = useState(0);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // OpenLayers 지도 생성
    // 서울 중심 좌표 (WGS84): 37.5665, 126.9780
    // EPSG:3857 변환: 약 [14135290, 4515020]
    const map = new Map({
      target: mapRef.current,
      layers: [
        new TileLayer({
          source: new OSM(),
          properties: { name: 'background' },
        }),
      ],
      view: new View({
        center: [14135290, 4515020], // 서울 중심 좌표 (EPSG:3857)
        zoom: 10, // 줌 레벨을 10으로 설정 (서울 전체 보기)
      }),
      controls: defaults({
        zoom: false,
        attribution: false,
      }),
    });

    mapInstanceRef.current = map;
    // map 생성 직후, 상위 컴포넌트(OpenLayersMap)가 mapInstanceRef.current를
    // 다시 읽도록 리렌더링 1회 트리거
    forceRerender((v) => v + 1);

    // 컴포넌트 언마운트 시 지도 정리
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setTarget(undefined);
        mapInstanceRef.current = null;
      }
    };
  }, [mapRef]);

  return mapInstanceRef;
}
