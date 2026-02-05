import VectorTileLayer from 'ol/layer/VectorTile';
import VectorTileSource from 'ol/source/VectorTile';
import MVT from 'ol/format/MVT';
import Style from 'ol/style/Style';
import Stroke from 'ol/style/Stroke';
import Fill from 'ol/style/Fill';
import Circle from 'ol/style/Circle';
import type { StyleLike } from 'ol/style/Style';

const STROKE_COLOR = '#64748b';
const FILL_COLOR = 'rgba(100, 116, 139, 0.15)';
const POINT_RADIUS = 4;
const LINE_WIDTH = 1.5;

const TILESERV_BASE = 'http://192.168.120.82:7800';
const SERVICE_LAYER_VIEW_ID = 'public_layer.serviceLayerView';
/** pg_tileserv 타일당 feature 수 제한 상향 (기본 50000). 낮은 줌에서 도형이 잘리면 이 값을 올리거나 URL의 limit 파라미터로 조정 */
const TILE_FEATURE_LIMIT = 10000000;

/** pg_tileserv index.json 항목 */
type IndexEntry = {
  type?: string;
  id?: string;
  name?: string;
  schema?: string;
  [key: string]: unknown;
};

type IndexJson = Record<string, IndexEntry>;

/** Point: 원형 심볼 */
const pointStyle = new Style({
  image: new Circle({
    radius: POINT_RADIUS,
    fill: new Fill({ color: FILL_COLOR }),
    stroke: new Stroke({ color: STROKE_COLOR, width: 1 }),
  }),
});

/** Line: 선만 */
const lineStyle = new Style({
  stroke: new Stroke({ color: STROKE_COLOR, width: LINE_WIDTH }),
});

/** Polygon: 테두리 + 채우기 */
const polygonStyle = new Style({
  stroke: new Stroke({ color: STROKE_COLOR, width: 1 }),
  fill: new Fill({ color: FILL_COLOR }),
});

function createGeometryStyle(): StyleLike {
  return (feature, resolution) => {
    const type = feature.getGeometry()?.getType?.() ?? '';
    switch (type) {
      case 'Point':
      case 'MultiPoint':
        return pointStyle;
      case 'LineString':
      case 'MultiLineString':
        return lineStyle;
      case 'Polygon':
      case 'MultiPolygon':
      default:
        return polygonStyle;
    }
  };
}

/** layer_name에 'wtl'이 포함된 피처만 스타일 적용(표시), 나머지는 미표시 */
function createServiceLayerViewStyle(): StyleLike {
  const geometryStyle = createGeometryStyle();
  if (typeof geometryStyle !== 'function') return geometryStyle;
  return (feature, resolution) => {
    const layerName = String(feature.get('layer_name') ?? '');
    if (!layerName.includes('wtl')) return undefined;
    return geometryStyle(feature, resolution);
  };
}

/**
 * serviceLayerView 뷰 하나를 사용하는 VectorTileLayer 생성.
 * 거리뷰 버튼으로 on/off 할 레이어.
 * 스타일: layer_name에 'wtl'이 포함된 레이어만 표시.
 */
export function createServiceLayerViewLayer(): VectorTileLayer<VectorTileSource> {
  const url = `${TILESERV_BASE}/${SERVICE_LAYER_VIEW_ID}/{z}/{x}/{y}.pbf?limit=${TILE_FEATURE_LIMIT}`;
  const layer = new VectorTileLayer({
    declutter: true,
    source: new VectorTileSource({
      format: new MVT(),
      url,
      tileSize: 2048,
    }),
    style: createServiceLayerViewStyle(),
  });
  layer.set('name', '거리뷰(서비스레이어)');
  layer.set('serviceLayerViewLayer', true);
  layer.setVisible(false);
  return layer;
}

/**
 * pg_tileserv index.json 기준으로 type이 table인 모든 레이어를 VectorTileLayer로 생성.
 * serviceList.config 없이 이 파일 안에서만 레이어 목록을 처리.
 */
export async function createIndexLayers(): Promise<VectorTileLayer<VectorTileSource>[]> {
  const res = await fetch(`${TILESERV_BASE}/index.json`);
  const index = (await res.json()) as IndexJson;
  const layers: VectorTileLayer<VectorTileSource>[] = [];

  for (const [layerId, entry] of Object.entries(index)) {
    if (entry?.type !== 'table') continue;

    const name = (entry.name && String(entry.name).trim()) || layerId;
    const url = `${TILESERV_BASE}/${layerId}/{z}/{x}/{y}.pbf`;

    const layer = new VectorTileLayer({
      declutter: true,
      source: new VectorTileSource({
        format: new MVT(),
        url,
        tileSize: 2048,
      }),
      style: createGeometryStyle(),
    });

    layer.set('name', name);
    layer.set('serviceLayer', true);
    layer.set('layerId', layerId);
    layer.setVisible(false);
    layers.push(layer);
  }

  // 생성된 레이어 개수 (개발 시 확인용)
  if (typeof console !== 'undefined' && console.info) {
    console.info(`[indexLayerFactory] 총 ${layers.length}개 레이어 생성`);
  }
  return layers;
}
