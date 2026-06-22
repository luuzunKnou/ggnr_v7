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

/** 건물·도로 레이어 목록 — 상세 패널·동기화용 export */
export const BUILDING_ROAD_LAYERS: {
  tableName: string;
  layerName: string;
  minZoom: number;
  maxZoom: number;
}[] = [
  { tableName: 'tl_sgco_rnadr_mst', layerName: '건물군', minZoom: 8, maxZoom: 30 },
  { tableName: 'tl_spbd_entrc', layerName: '건물군 출입구', minZoom: 8, maxZoom: 30 },
  { tableName: 'tl_sgco_rnadr_dong', layerName: '건물', minZoom: 8, maxZoom: 30 },
  { tableName: 'tl_spbd_entrc_dong', layerName: '건물 출입구', minZoom: 8, maxZoom: 30 },
  { tableName: 'tl_sprd_rw', layerName: '실폭도로', minZoom: 8, maxZoom: 30 },
  { tableName: 'tl_sprd_manage', layerName: '도로구간', minZoom: 8, maxZoom: 30 },
];

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
 * visibleTableNames null = 전체, 빈 Set = 전체 숨김, 비어 있지 않으면 선택된 것만.
 */
export function useCadastralLayerSync(
  map: Map | null,
  mapReady: boolean,
  activeControls: string[],
  visibleTableNames?: Set<string> | null,
) {
  useEffect(() => {
    if (!mapReady || !map) return;
    const groupOn = activeControls.includes('cadastral');
    const showAll = visibleTableNames == null;
    map.getLayers().getArray().forEach((l) => {
      if (!l.get('cadastralLayer')) return;
      const tableName = l.get('layerTableName') as string | undefined;
      const allowed =
        showAll || (tableName != null && (visibleTableNames?.has(tableName) ?? false));
      l.setVisible(groupOn && allowed);
    });
  }, [map, mapReady, activeControls, visibleTableNames]);
}

/**
 * activeControls + visibleTableNames 기준으로 건물·도로 레이어 표시.
 */
export function useBuildingRoadLayerSync(
  map: Map | null,
  mapReady: boolean,
  activeControls: string[],
  visibleTableNames?: Set<string> | null,
) {
  useEffect(() => {
    if (!mapReady || !map) return;
    const groupOn = activeControls.includes('building-road');
    const showAll = visibleTableNames == null;
    map.getLayers().getArray().forEach((l) => {
      if (!l.get('buildingRoadLayer')) return;
      const tableName = l.get('layerTableName') as string | undefined;
      const allowed =
        showAll || (tableName != null && (visibleTableNames?.has(tableName) ?? false));
      l.setVisible(groupOn && allowed);
    });
  }, [map, mapReady, activeControls, visibleTableNames]);
}
