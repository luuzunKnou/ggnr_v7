import { useEffect } from 'react';
import ImageLayer from 'ol/layer/Image';
import ImageWMS from 'ol/source/ImageWMS';
import type { Map } from 'ol';
import { WORKSPACE } from './serviceLayerFactory';
import { getGeoServerBase } from '@/lib/geoserverUrl';

const BASIC_SECTION_LAYERS: {
  tableName: string;
  layerName: string;
  minZoom: number;
  maxZoom: number;
}[] = [
  { tableName: 'tl_sprd_intrvl', layerName: '기초구간', minZoom: 8, maxZoom: 30 },
];

/**
 * 기초구간 관련 GeoServer WMS 레이어
 */
export function createBasicSectionLayers(): ImageLayer<ImageWMS>[] {
  const geoServerBase = getGeoServerBase();
  const wmsUrl = `${geoServerBase}/${WORKSPACE}/wms`;

  return BASIC_SECTION_LAYERS.map(
    ({ tableName, layerName, minZoom, maxZoom }) => {
      const layer = new ImageLayer({
        minZoom,
        maxZoom,
        visible: false,
        source: new ImageWMS({
          url: wmsUrl,
          params: {
            LAYERS: `${WORKSPACE}:${tableName}`,
            STYLES: tableName,
          },
          serverType: 'geoserver',
          ratio: 1.5,
        }),
      });
      layer.set('name', layerName);
      layer.set('basicSectionLayer', true);
      layer.set('layerTableName', tableName);
      return layer;
    }
  );
}

/**
 * activeControls에 'basic-section'이 포함되어 있으면 기초구간 레이어를 표시하는 훅.
 */
export function useBasicSectionLayerSync(
  map: Map | null,
  mapReady: boolean,
  activeControls: string[],
) {
  useEffect(() => {
    if (!mapReady || !map) return;
    const visible = activeControls.includes('basic-section');
    map.getLayers().getArray().forEach((l) => {
      if (l.get('basicSectionLayer')) l.setVisible(visible);
    });
  }, [map, mapReady, activeControls]);
}
