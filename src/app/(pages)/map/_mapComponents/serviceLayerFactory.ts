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
const TILESERV_SCHEMA = 'layer';

type SerConfigItem = {
  ser_eng?: string | null;
  ser_kor?: string | null;
  ser_type?: string | null;
  ser_menu?: string | null;
  ser_cat?: string | null;
  [key: string]: unknown;
};

/** index.json 레이어 항목 (pg_tileserv 형식) */
type IndexLayerEntry = {
  name?: string;
  schema?: string;
  type?: string;
  id?: string;
  [key: string]: unknown;
};

type IndexJson = Record<string, IndexLayerEntry>;

/** Point: 원형 심볼 (Circle) */
const pointStyle = new Style({
  image: new Circle({
    radius: POINT_RADIUS,
    fill: new Fill({ color: FILL_COLOR }),
    stroke: new Stroke({ color: STROKE_COLOR, width: 1 }),
  }),
});

/** Line: 선만 (Stroke) */
const lineStyle = new Style({
  stroke: new Stroke({ color: STROKE_COLOR, width: LINE_WIDTH }),
});

/** Polygon: 테두리 + 채우기 (Stroke + Fill) */
const polygonStyle = new Style({
  stroke: new Stroke({ color: STROKE_COLOR, width: 1 }),
  fill: new Fill({ color: FILL_COLOR }),
});

/**
 * 지오메트리 타입별 스타일 (Point / Line / Polygon)
 * - Point, MultiPoint → 원형
 * - LineString, MultiLineString → 선
 * - Polygon, MultiPolygon → 폴리곤
 */
function createGeometryStyle(): StyleLike {
  return (feature, resolution) => {
    const geom = feature.getGeometry();
    const type = geom?.getType?.() ?? '';

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

/**
 * serviceList.config에서 type이 layer인 항목 중
 * http://192.168.120.82:7800/index.json 에 존재하는 레이어만 VectorTileLayer로 생성
 */
export async function createServiceLayers(): Promise<VectorTileLayer<VectorTileSource>[]> {
  const [serviceListRes, indexRes] = await Promise.all([
    fetch('/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'configService',
        action: 'getServiceList',
        params: {},
      }),
    }).then((r) => r.json()),
    fetch(`${TILESERV_BASE}/index.json`).then((r) => r.json() as Promise<IndexJson>),
  ]);

  const list: SerConfigItem[] = serviceListRes?.data?.ser ?? [];
  const index: IndexJson = indexRes ?? {};
  const indexKeys = new Set(Object.keys(index));

  const layerItems = list.filter((s) => s.ser_type === 'layer' && (s.ser_eng ?? '').trim() !== '');
  const layers: VectorTileLayer<VectorTileSource>[] = [];

  for (const item of layerItems) {
    const serEng = (item.ser_eng ?? '').trim();
    const layerId = `${TILESERV_SCHEMA}.${serEng}`;
    
    if (!indexKeys.has(layerId)) continue;

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

    layer.set('name', item.ser_kor ?? serEng);
    layer.set('serviceLayer', true);
    layer.set('ser_eng', serEng);
    layer.set('ser_menu', item.ser_menu ?? null);
    layer.set('ser_cat', item.ser_cat ?? null);
    layer.setVisible(false);
    layers.push(layer);
  }

  return layers;
}
