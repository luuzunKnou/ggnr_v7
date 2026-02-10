import TileLayer from 'ol/layer/Tile';
import TileWMS from 'ol/source/TileWMS';

const WORKSPACE = 'ggnr';

function getGeoServerBase(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8080/geoserver`;
  }
  return 'http://localhost:8080/geoserver';
}

/**
 * 단일 GeoServer WMS TileLayer 생성.
 * LAYERS/STYLES는 빈 문자열로 두고, bar에서 visibleLayerNames 기준으로 콤마 연결해 갱신.
 */
export function createServiceLayer(): TileLayer<TileWMS> {
  const geoServerBase = getGeoServerBase();
  const wmsUrl = `${geoServerBase}/${WORKSPACE}/wms`;

  const layer = new TileLayer({
    visible: false,
    source: new TileWMS({
      url: wmsUrl,
      params: {
        LAYERS: '',
        STYLES: '',
        TILED: true,
        EXCEPTIONS: 'application/vnd.ogc.se_inimage',
      },
      serverType: 'geoserver',
      transition: 0,
    }),
  });

  layer.set('serviceLayer', true);
  return layer;
}

export { WORKSPACE };
