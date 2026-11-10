import { useEffect } from 'react';
import { Map } from 'ol';
import {
  BACKGROUND_LABEL_LAYER_NAME,
  createKakaoHybridLabelLayer,
} from '../layerFactory/backgroundLayerFactory';

/**
 * 배경지도 바로 위에 다음 명칭 타일을 켜고 끈다.
 */
export function useBackgroundLabelLayer(map: Map | null, visible: boolean) {
  useEffect(() => {
    if (!map) return;

    const removeExisting = () => {
      const found = map
        .getLayers()
        .getArray()
        .find((layer) => layer.get('name') === BACKGROUND_LABEL_LAYER_NAME);
      if (found) map.removeLayer(found);
    };

    removeExisting();
    if (!visible) return;

    const layer = createKakaoHybridLabelLayer();
    layer.set('name', BACKGROUND_LABEL_LAYER_NAME);
    const layers = map.getLayers();
    const bgIdx = layers.getArray().findIndex((item) => item.get('name') === 'background');
    layers.insertAt(bgIdx >= 0 ? bgIdx + 1 : 0, layer);

    return () => {
      removeExisting();
    };
  }, [map, visible]);
}
