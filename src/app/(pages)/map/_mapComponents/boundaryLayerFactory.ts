import VectorTileLayer from 'ol/layer/VectorTile';
import VectorTileSource from 'ol/source/VectorTile';
import MVT from 'ol/format/MVT';
import Style from 'ol/style/Style';
import Stroke from 'ol/style/Stroke';
import Fill from 'ol/style/Fill';
import Text from 'ol/style/Text';
import type { StyleLike } from 'ol/style/Style';

const PG_TILESERV_BASE = 'http://192.168.120.82:7800';
const PG_TILESERV_SCHEMA = 'public_layer';

const CADASTRAL_LAYERS: {
  tableName: string;
  layerName: string;
  strokeColor: string;
  strokeWidth: number;
  labelField: string;
  minZoom: number;
  maxZoom: number;
}[] = [
  { tableName: 'jijuk', layerName: '지적', strokeColor: '#dc2626', strokeWidth: 1, labelField: 'jibun', minZoom: 16, maxZoom: 30 },
  { tableName: 'ri', layerName: '리', strokeColor: '#22c55e', strokeWidth: 2, labelField: 'ri_nm', minZoom: 11, maxZoom: 18 },
  { tableName: 'emd', layerName: '읍면동', strokeColor: '#2563eb', strokeWidth: 2, labelField: 'emd_nm', minZoom: 8, maxZoom: 18 },
];

function createCadastralStyle(
  tableName: string,
  strokeColor: string,
  strokeWidth: number,
  labelField: string
): StyleLike {
  const isRiOrEmd = tableName === 'ri' || tableName === 'emd';
  return (feature) => {
    const label = String(feature.get(labelField) ?? '').trim();
    return new Style({
      stroke: new Stroke({ color: strokeColor, width: strokeWidth }),
      text: label
        ? new Text({
            text: label,
            font: isRiOrEmd ? '18px Inter, sans-serif' : '12px Inter, sans-serif',
            fill: new Fill({ color: isRiOrEmd ? strokeColor : '#000' }),
            stroke: new Stroke({ color: '#fff', width: isRiOrEmd ? 4 : 2 }),
            overflow: true,
          })
        : undefined,
    });
  };
}

/**
 * 지적도 관련 pg_tileserv MVT 레이어 (jijuk, emd, ri)
 */
export function createInitialPgTileservLayers(): VectorTileLayer<VectorTileSource>[] {
  return CADASTRAL_LAYERS.map(
    ({ tableName, layerName, strokeColor, strokeWidth, labelField, minZoom, maxZoom }) => {
      const url = `${PG_TILESERV_BASE}/${PG_TILESERV_SCHEMA}.${tableName}/{z}/{x}/{y}.pbf`;
      const layer = new VectorTileLayer({
        declutter: true,
        minZoom,
        maxZoom,
        source: new VectorTileSource({
          format: new MVT(),
          url,
          tileSize: 2048,
        }),
        style: createCadastralStyle(tableName, strokeColor, strokeWidth, labelField),
      });
      layer.set('name', layerName);
      layer.set('cadastralLayer', true);
      layer.setVisible(false);
      return layer;
    }
  );
}
