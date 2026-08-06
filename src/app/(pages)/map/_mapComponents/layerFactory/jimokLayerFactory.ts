import { useEffect } from 'react';
import ImageLayer from 'ol/layer/Image';
import ImageWMS from 'ol/source/ImageWMS';
import type { Map } from 'ol';
import { WORKSPACE } from './serviceLayerFactory';

function getGeoServerBase(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8080/geoserver`;
  }
  return 'http://localhost:8080/geoserver';
}

/** 지목 (답·대·제방·공장용지 등) — 패널 목록·동기화용 export */
export const JIMOK_LAYERS: { tableName: string; layerName: string; minZoom: number; maxZoom: number }[] = [
  { tableName: 'landown_dab', layerName: '답', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_dea', layerName: '대', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_embank', layerName: '제방', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_factory', layerName: '공장용지', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_fishfarm', layerName: '양어장', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_forest', layerName: '임야', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_fruitfarm', layerName: '과수원', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_gasstation', layerName: '주유소용지', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_graveyard', layerName: '묘지', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_gutter', layerName: '구거', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_historic', layerName: '사적지', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_jeon', layerName: '전', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_misc', layerName: '잡종지', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_park', layerName: '공원', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_parking', layerName: '주차장', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_pond', layerName: '유지', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_railroad', layerName: '철도용지', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_ranch', layerName: '목장용지', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_recreation', layerName: '유원지', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_religi', layerName: '종교용지', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_river', layerName: '하천', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_road', layerName: '도로', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_saltfarm', layerName: '염전', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_school', layerName: '학교용지', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_sports', layerName: '체육용지', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_springwater', layerName: '광천지', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_warehouse', layerName: '창고용지', minZoom: 8, maxZoom: 30 },
  { tableName: 'landown_waterworks', layerName: '수도용지', minZoom: 8, maxZoom: 30 },
];

export function createJimokLayers(): ImageLayer<ImageWMS>[] {
  const geoServerBase = getGeoServerBase();
  const wmsUrl = `${geoServerBase}/${WORKSPACE}/wms`;

  return JIMOK_LAYERS.map(({ tableName, layerName, minZoom, maxZoom }) => {
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
    layer.set('jimokLayer', true);
    layer.set('layerTableName', tableName);
    return layer;
  });
}

export function useJimokLayerSync(
  map: Map | null,
  mapReady: boolean,
  activeControls: string[],
  /** null = 전체 표시, 빈 Set = 전체 숨김, 비어 있지 않은 Set = 선택된 것만 */
  visibleTableNames?: Set<string> | null,
  /**
   * DB·정의 기준 가용 테이블명. null/undefined = 아직 미조회(전부 끔).
   * Set이면 그 안의 레이어만 켤 수 있음.
   */
  availableTableNames?: Set<string> | null
) {
  useEffect(() => {
    if (!mapReady || !map) return;
    const groupOn = activeControls.includes('land-category');
    const catalogReady = availableTableNames != null;
    const showAll = visibleTableNames == null;
    map.getLayers().getArray().forEach((l) => {
      if (!l.get('jimokLayer')) return;
      const tableName = l.get('layerTableName') as string | undefined;
      const inCatalog =
        catalogReady && tableName != null && availableTableNames.has(tableName);
      const selected =
        showAll || (tableName != null && (visibleTableNames?.has(tableName) ?? false));
      l.setVisible(groupOn && inCatalog && selected);
    });
  }, [map, mapReady, activeControls, visibleTableNames, availableTableNames]);
}
