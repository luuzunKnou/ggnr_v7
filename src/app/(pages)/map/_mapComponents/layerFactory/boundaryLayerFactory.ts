import { useEffect } from 'react';
import ImageLayer from 'ol/layer/Image';
import ImageWMS from 'ol/source/ImageWMS';
import type { Map } from 'ol';
import tables from '@/config/defineLayer/tables.json';
import { WORKSPACE } from './serviceLayerFactory';
import { BUILDING_ROAD_LAYER_DEFS } from './buildingRoadLayerConfig';

export { BUILDING_ROAD_LAYER_DEFS } from './buildingRoadLayerConfig';

function getGeoServerBase(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8080/geoserver`;
  }
  return 'http://localhost:8080/geoserver';
}

/** defineLayer tables.json 에 등록된 테이블명 (소문자) */
const DEFINE_TABLE_NAMES_LOWER = new Set(
  (tables as Array<{ define_table_name?: string }>)
    .map((t) => String(t.define_table_name ?? '').trim().toLowerCase())
    .filter(Boolean)
);

function isDefinedTable(tableName: string): boolean {
  return DEFINE_TABLE_NAMES_LOWER.has(tableName.trim().toLowerCase());
}

/** GeoServer jijuk.sld — 지번 TextSymbolizer MaxScaleDenominator (이 축척 이하에서만 지번 표시) */
export const JIJUK_JIBUN_LABEL_MAX_SCALE_DENOMINATOR = 2000;

/** GeoServer SLD scale (0.28mm 픽셀) 기준 — 지번 라벨이 보이는 줌/해상도인지 */
export function isJijukJibunLabelVisible(resolution: number): boolean {
  if (!Number.isFinite(resolution) || resolution <= 0) return false;
  return resolution / 0.00028 <= JIJUK_JIBUN_LABEL_MAX_SCALE_DENOMINATOR;
}

/** 지적도 레이어 목록 — 상세 패널·동기화용 export */
export const CADASTRAL_LAYERS: {
  tableName: string;
  layerName: string;
  minZoom: number;
  maxZoom: number;
}[] = [
  { tableName: 'jijuk', layerName: '지적', minZoom: 16, maxZoom: 30 },
  { tableName: 'ri', layerName: '리', minZoom: 11, maxZoom: 18 },
  { tableName: 'emd', layerName: '읍면동', minZoom: 8, maxZoom: 18 },
];

/** 건물·도로 레이어 목록 — tables.json 에 있는 항목만 (패널 후보) */
export const BUILDING_ROAD_LAYERS = BUILDING_ROAD_LAYER_DEFS.filter((l) =>
  isDefinedTable(l.tableName)
);

/** tables.json 기준 건물·도로 가용 테이블명 */
export const BUILDING_ROAD_DEFINED_TABLE_NAMES = new Set(
  BUILDING_ROAD_LAYERS.map((l) => l.tableName)
);

/**
 * 지적도 관련 GeoServer WMS 레이어 (jijuk, ri, emd)
 */
export function createCadastralLayers(): ImageLayer<ImageWMS>[] {
  const geoServerBase = getGeoServerBase();
  const wmsUrl = `${geoServerBase}/${WORKSPACE}/wms`;

  return CADASTRAL_LAYERS.map(
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
      layer.set('cadastralLayer', true);
      layer.set('layerTableName', tableName);
      return layer;
    }
  );
}

/**
 * 건물·도로 관련 GeoServer WMS 레이어 (건물군, 건물, 실폭도로 등)
 */
export function createBuildingRoadLayers(): ImageLayer<ImageWMS>[] {
  const geoServerBase = getGeoServerBase();
  const wmsUrl = `${geoServerBase}/${WORKSPACE}/wms`;

  return BUILDING_ROAD_LAYERS.map(
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
      layer.set('buildingRoadLayer', true);
      layer.set('layerTableName', tableName);
      return layer;
    }
  );
}

/**
 * activeControls + visibleTableNames 기준으로 지적도 레이어 표시.
 * availableTableNames 미전달(undefined) = 카탈로그 필터 없음(인쇄 등).
 * null = 카탈로그 로딩 중(전부 끔). Set이면 그 안의 레이어만 가능.
 * visibleTableNames null = 가용분(또는 전체) 표시 후보, 빈 Set = 전체 숨김.
 */
export function useCadastralLayerSync(
  map: Map | null,
  mapReady: boolean,
  activeControls: string[],
  visibleTableNames?: Set<string> | null,
  availableTableNames?: Set<string> | null,
) {
  useEffect(() => {
    if (!mapReady || !map) return;
    const groupOn = activeControls.includes('cadastral');
    const showAll = visibleTableNames == null;
    map.getLayers().getArray().forEach((l) => {
      if (!l.get('cadastralLayer')) return;
      const tableName = l.get('layerTableName') as string | undefined;
      const selected =
        showAll || (tableName != null && (visibleTableNames?.has(tableName) ?? false));
      if (availableTableNames === undefined) {
        l.setVisible(groupOn && selected);
        return;
      }
      const inCatalog =
        availableTableNames != null &&
        tableName != null &&
        availableTableNames.has(tableName);
      l.setVisible(groupOn && inCatalog && selected);
    });
  }, [map, mapReady, activeControls, visibleTableNames, availableTableNames]);
}

/**
 * activeControls + visibleTableNames 기준으로 건물·도로 레이어 표시.
 * availableTableNames null = 카탈로그 미조회(전부 끔). Set이면 그 안의 레이어만 가능.
 */
export function useBuildingRoadLayerSync(
  map: Map | null,
  mapReady: boolean,
  activeControls: string[],
  visibleTableNames?: Set<string> | null,
  availableTableNames?: Set<string> | null,
) {
  useEffect(() => {
    if (!mapReady || !map) return;
    const groupOn = activeControls.includes('building-road');
    const catalogReady = availableTableNames != null;
    const showAll = visibleTableNames == null;
    map.getLayers().getArray().forEach((l) => {
      if (!l.get('buildingRoadLayer')) return;
      const tableName = l.get('layerTableName') as string | undefined;
      const inCatalog =
        catalogReady && tableName != null && availableTableNames.has(tableName);
      const selected =
        showAll || (tableName != null && (visibleTableNames?.has(tableName) ?? false));
      l.setVisible(groupOn && inCatalog && selected);
    });
  }, [map, mapReady, activeControls, visibleTableNames, availableTableNames]);
}
