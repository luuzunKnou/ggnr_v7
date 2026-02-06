import { MVTLayer } from 'deck.gl';

const TILESERV_BASE = process.env.NEXT_PUBLIC_TILESERV_URL || 'http://192.168.120.82:7800';
const VIEW_SCHEMA = 'public_layer';
const VIEW_NAME = 'serviceLayerView';

// 레이어 스타일 (line / point / polygon 색상)
const LINE_COLOR: [number, number, number, number] = [34, 150, 243, 220]; // blue stroke
const POLYGON_FILL: [number, number, number, number] = [66, 165, 245, 140]; // blue fill
const POINT_COLOR: [number, number, number, number] = [255, 138, 101, 220]; // coral point

const LAYER_STYLE = {
  minZoom: 0,
  maxZoom: 12,
  binary: true,
  stroked: true,
  filled: true,
  getLineColor: LINE_COLOR,
  getFillColor: (d: { geometry?: { type?: string } }) =>
    d?.geometry?.type === 'Point' ? POINT_COLOR : POLYGON_FILL,
  getLineWidth: 2,
  lineWidthUnits: 'pixels' as const,
  lineWidthMinPixels: 1,
  getPointRadius: 6,
  pointRadiusUnits: 'pixels' as const,
};

/** pg_tileserv: resolution, buffer, limit (INT_MAX 시 서버 500 에러 발생) */
const TILE_RESOLUTION = 512;
const TILE_BUFFER = 64;
const TILE_LIMIT = 5000000; // pg_tileserv가 처리 가능한 범위 (기본 50000)

/**
 * @param activeLayerNames 현재 표시할 레이어 이름 배열
 */
export function createServiceLayerViewLayer(activeLayerNames: string[]): MVTLayer {
  // 1. 서버 단 필터링: pg_tileserv의 기능을 이용해 필요한 레이어만 쿼리함
  // IN 연산자를 사용하여 DB 수준에서 필터링 후 타일 생성
  const filterQuery = activeLayerNames.length > 0 
    ? `?filter=layer_name IN ('${activeLayerNames.join("','")}')` 
    : '?filter=1=0';
  const tileParams = `&resolution=${TILE_RESOLUTION}&buffer=${TILE_BUFFER}&limit=${TILE_LIMIT}`;

  const dynamicUrl = `${TILESERV_BASE}/${VIEW_SCHEMA}.${VIEW_NAME}/{z}/{x}/{y}.pbf${filterQuery}${tileParams}`;

  return new MVTLayer({
    ...LAYER_STYLE,
    id: 'overlay-serviceLayerView',
    data: [dynamicUrl],
    updateTriggers: { data: activeLayerNames },
    parameters: {
      depthTest: false // 2D 레이어라면 깊이 테스트를 꺼서 GPU 부하 감소
    }
  });
}