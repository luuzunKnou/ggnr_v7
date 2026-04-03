import { useEffect, useRef } from 'react';
import TileLayer from 'ol/layer/Tile';
import TileWMS from 'ol/source/TileWMS';
import type { Map as OLMap } from 'ol';
import { getTileGrid3857 } from '../config/mapDefaults';
import {
  sortLayerNamesForWmsStack,
  type LayerDbGeometryKind,
} from '@/lib/mapLayerGeometryOrder';

const WORKSPACE = 'ggnr';

function getGeoServerBase(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8080/geoserver`;
  }
  return 'http://localhost:8080/geoserver';
}

/**
 * GeoServer WMS GetLegendGraphic URL — 범례 이미지 요청용
 */
export function getLegendGraphicUrl(layerName: string, styleName?: string): string {
  const base = getGeoServerBase();
  const params = new URLSearchParams({
    REQUEST: 'GetLegendGraphic',
    VERSION: '1.0.0',
    FORMAT: 'image/png',
    LAYER: `${WORKSPACE}:${layerName}`,
    WIDTH: '20',
    HEIGHT: '20',
  });
  if (styleName) params.set('STYLE', styleName);
  return `${base}/wms?${params.toString()}`;
}

export type LayerFilterRow = { field: string; value: string };

function filterRowsToCql(rows: LayerFilterRow[]): string {
  const valid = rows.filter((r) => String(r.field).trim() && String(r.value).trim());
  if (valid.length === 0) return 'INCLUDE';
  return valid.map((r) => {
    const v = String(r.value).replace(/'/g, "''");
    return `${String(r.field).trim()}='${v}'`;
  }).join(' AND ');
}

/**
 * WMS 타일 로드를 POST로 수행 (CQL_FILTER 등으로 URL이 길어져 414 방지)
 */
function tileLoadFunctionPost(
  tile: import('ol/Tile').default,
  src: string
): void {
  const img = (tile as unknown as { getImage(): HTMLImageElement }).getImage();
  try {
    const url = new URL(src);
    const baseUrl = url.origin + url.pathname;
    const body = url.search.startsWith('?') ? url.search.slice(1) : url.search;
    fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.statusText))))
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        img.onload = () => URL.revokeObjectURL(blobUrl);
        img.onerror = () => URL.revokeObjectURL(blobUrl);
        img.src = blobUrl;
      })
      .catch(() => {
        img.src = '';
      });
  } catch {
    img.src = '';
  }
}

/**
 * 단일 GeoServer WMS TileLayer 생성.
 * CQL 등으로 URL이 길어질 수 있어 타일 로드는 POST로 전송.
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
      tileGrid: getTileGrid3857(),
      tileLoadFunction: tileLoadFunctionPost,
    }),
  });

  layer.set('serviceLayer', true);
  return layer;
}

/**
 * visibleLayerNames / layerFilterRows / spatialFilterWkt 변경 시 serviceLayer WMS 파라미터를 자동 동기화하는 훅.
 * spatialFilterWkt(5181 WKT)가 있으면 각 레이어 CQL에 INTERSECTS(geom, wkt)를 추가해 도형 내 데이터만 표시.
 * layerGeometryTypes가 있으면 WMS LAYERS 순서를 면→선→점(아래→위)으로 맞춘다.
 */
export function useServiceLayerSync(
  map: OLMap | null,
  mapReady: boolean,
  visibleLayerNames: Set<string>,
  layerFilterRows?: Map<string, LayerFilterRow[]>,
  spatialFilterWkt?: string | null,
  layerGeometryTypes?: Record<string, LayerDbGeometryKind>,
) {
  const filterRef = useRef(layerFilterRows);
  filterRef.current = layerFilterRows;

  useEffect(() => {
    if (!mapReady || !map) return;

    const serviceLayer = map.getLayers().getArray().find((l) => l.get('serviceLayer')) as
      | { getSource(): { getParams(): Record<string, string | undefined>; changed(): void } | null; setVisible(v: boolean): void }
      | undefined;
    if (!serviceLayer) return;
    const source = serviceLayer.getSource();
    if (!source) return;
    const params = source.getParams();

    if (visibleLayerNames.size === 0) {
      params.LAYERS = '';
      params.STYLES = '';
      delete params.CQL_FILTER;
      serviceLayer.setVisible(false);
    } else {
      const rawNames = Array.from(visibleLayerNames);
      const names =
        layerGeometryTypes && Object.keys(layerGeometryTypes).length > 0
          ? sortLayerNamesForWmsStack(rawNames, layerGeometryTypes)
          : rawNames;
      params.LAYERS = names.map((n) => `${WORKSPACE}:${n}`).join(',');
      params.STYLES = names.join(',');
      const filters = filterRef.current;
      const wkt = typeof spatialFilterWkt === 'string' && spatialFilterWkt.trim() ? spatialFilterWkt.trim() : null;
      const cqlArr = names.map((n) => {
        const base = filterRowsToCql(filters?.get(n) ?? []);
        if (!wkt) return base;
        const spatialCql = `INTERSECTS(geom, ${wkt})`;
        return base === 'INCLUDE' ? spatialCql : `${base} AND ${spatialCql}`;
      });
      params.CQL_FILTER = cqlArr.join(';');
      serviceLayer.setVisible(true);
      source.changed();
    }
  }, [map, mapReady, visibleLayerNames, spatialFilterWkt, layerGeometryTypes]);
}

export { WORKSPACE };
