import TileLayer from 'ol/layer/Tile';
import TileWMS from 'ol/source/TileWMS';
import { WORKSPACE } from './serviceLayerFactory';

const WMS_EXCEPTIONS = 'application/vnd.ogc.se_inimage';

function getGeoServerBase(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8080/geoserver`;
  }
  return 'http://localhost:8080/geoserver';
}

const CADASTRAL_LAYERS: {
  tableName: string;
  layerName: string;
  minZoom: number;
  maxZoom: number;
}[] = [
  { tableName: 'jijuk', layerName: '지적', minZoom: 16, maxZoom: 30 },
  { tableName: 'ri', layerName: '리', minZoom: 11, maxZoom: 18 },
  { tableName: 'emd', layerName: '읍면동', minZoom: 8, maxZoom: 18 },
];

/**
 * 지적도 관련 GeoServer WMS 레이어 (jijuk, emd, ri).
 * 스타일은 GeoServer 레이어 default style 사용.
 */
export function createInitialPgTileservLayers(): TileLayer<TileWMS>[] {
  const geoServerBase = getGeoServerBase();
  const wmsUrl = `${geoServerBase}/${WORKSPACE}/wms`;

  return CADASTRAL_LAYERS.map(({ tableName, layerName, minZoom, maxZoom }) => {
    const layer = new TileLayer({
      visible: false,
      minZoom,
      maxZoom,
      source: new TileWMS({
        url: wmsUrl,
        params: {
          LAYERS: `${WORKSPACE}:${tableName}`,
          TILED: true,
          EXCEPTIONS: WMS_EXCEPTIONS,
        },
        serverType: 'geoserver',
        transition: 0,
      }),
    });

    layer.set('name', layerName);
    layer.set('cadastralLayer', true);
    return layer;
  });
}
