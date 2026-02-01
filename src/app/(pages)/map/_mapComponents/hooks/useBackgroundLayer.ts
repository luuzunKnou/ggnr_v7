import { useEffect } from 'react';
import { Map } from 'ol';
import { updateViewProjection } from '../services/coordinateService';
import { createBackgroundLayerById, getProviderFromId } from '../backgroundLayerFactory';

/**
 * 배경지도 레이어 관리 훅
 * 배경지도 변경 시 레이어를 교체하고 좌표계를 조정
 */
export function useBackgroundLayer(
  map: Map | null,
  selectedBackgroundMap: string
) {
  useEffect(() => {
    if (!map) return;

    const view = map.getView();
    const layers = map.getLayers();
    const backgroundLayer = layers
      .getArray()
      .find((layer) => layer.get('name') === 'background');

    // 기존 배경 레이어 제거
    if (backgroundLayer) {
      map.removeLayer(backgroundLayer);
    }

    // 새로운 배경 레이어 생성 및 추가
    const newLayer = createBackgroundLayerById(selectedBackgroundMap);
    const provider = getProviderFromId(selectedBackgroundMap);

    if (newLayer) {
      newLayer.set('name', 'background');
      map.addLayer(newLayer);

      // 좌표계 변경 (카카오맵인 경우 EPSG:5181, 그 외는 EPSG:3857)
      if (provider === 'kakao') {
        updateViewProjection(map, 'EPSG:5181');
      } else {
        updateViewProjection(map, 'EPSG:3857');
      }

      // 레이어 순서 재정렬: 배경 레이어를 맨 아래로
      const allLayers = map.getLayers().getArray();
      const bgIndex = allLayers.indexOf(newLayer);
      if (bgIndex > 0) {
        allLayers.forEach((layer, index) => {
          if (layer !== newLayer && index < bgIndex) {
            map.removeLayer(layer);
            map.addLayer(layer);
          }
        });
      }
    }

    return () => {
      if (newLayer) {
        map.removeLayer(newLayer);
      }
    };
  }, [map, selectedBackgroundMap]);
}
