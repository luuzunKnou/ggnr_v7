import { useEffect, useRef } from 'react';
import ImageLayer from 'ol/layer/Image';
import ImageWMS from 'ol/source/ImageWMS';
import ImageWrapper from 'ol/Image';
import type { Map as OLMap } from 'ol';
import {
  sortLayerNamesForWmsStack,
  type LayerDbGeometryKind,
} from '@/lib/mapLayerGeometryOrder';

const WORKSPACE = 'ggnr';

/** 뷰포트 bbox 대비 GetMap 요청 여유 (1 = 화면과 동일, 1.5 = 가장자리 라벨·선 잘림 완화) */
const WMS_VIEWPORT_IMAGE_RATIO = 1.5;

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
 * WMS GetMap 로드를 POST로 수행 (CQL_FILTER 등으로 URL이 길어져 414 방지)
 */
function imageLoadFunctionPost(image: ImageWrapper, src: string): void {
  const img = image.getImage() as HTMLImageElement;
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
 * 단일 GeoServer WMS ImageLayer — 화면(뷰포트) 전체를 GetMap 1회로 요청.
 * CQL 등으로 URL이 길어질 수 있어 이미지 로드는 POST로 전송.
 */
export function createServiceLayer(): ImageLayer<ImageWMS> {
  const geoServerBase = getGeoServerBase();
  const wmsUrl = `${geoServerBase}/${WORKSPACE}/wms`;

  const layer = new ImageLayer({
    visible: false,
    source: new ImageWMS({
      url: wmsUrl,
      params: {
        LAYERS: '',
        STYLES: '',
        EXCEPTIONS: 'application/vnd.ogc.se_inimage',
      },
      serverType: 'geoserver',
      ratio: WMS_VIEWPORT_IMAGE_RATIO,
      imageLoadFunction: imageLoadFunctionPost,
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
  const lastSyncKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!mapReady || !map) return;

    const serviceLayer = map.getLayers().getArray().find((l) => l.get('serviceLayer')) as
      | {
          getVisible(): boolean;
          getSource(): { getParams(): Record<string, string | undefined>; changed(): void } | null;
          setVisible(v: boolean): void;
        }
      | undefined;
    if (!serviceLayer) return;
    const source = serviceLayer.getSource();
    if (!source) return;
    const params = source.getParams();

    if (visibleLayerNames.size === 0) {
      const syncKey = 'empty';
      if (lastSyncKeyRef.current === syncKey && !serviceLayer.getVisible()) return;
      lastSyncKeyRef.current = syncKey;
      params.LAYERS = '';
      params.STYLES = '';
      delete params.CQL_FILTER;
      serviceLayer.setVisible(false);
      return;
    }

    const rawNames = Array.from(visibleLayerNames);
    const names =
      layerGeometryTypes && Object.keys(layerGeometryTypes).length > 0
        ? sortLayerNamesForWmsStack(rawNames, layerGeometryTypes)
        : rawNames;
    const layersParam = names.map((n) => `${WORKSPACE}:${n}`).join(',');
    const stylesParam = names.join(',');
    const filters = filterRef.current;
    const wkt = typeof spatialFilterWkt === 'string' && spatialFilterWkt.trim() ? spatialFilterWkt.trim() : null;
    const cqlArr = names.map((n) => {
      const base = filterRowsToCql(filters?.get(n) ?? []);
      if (!wkt) return base;
      const spatialCql = `INTERSECTS(geom, ${wkt})`;
      return base === 'INCLUDE' ? spatialCql : `${base} AND ${spatialCql}`;
    });
    const cqlParam = cqlArr.join(';');
    const syncKey = `${layersParam}|${stylesParam}|${cqlParam}`;

    if (
      lastSyncKeyRef.current === syncKey &&
      params.LAYERS === layersParam &&
      params.STYLES === stylesParam &&
      (params.CQL_FILTER ?? '') === cqlParam &&
      serviceLayer.getVisible()
    ) {
      return;
    }
    lastSyncKeyRef.current = syncKey;

    params.LAYERS = layersParam;
    params.STYLES = stylesParam;
    params.CQL_FILTER = cqlParam;
    serviceLayer.setVisible(true);
    source.changed();
  }, [map, mapReady, visibleLayerNames, spatialFilterWkt, layerGeometryTypes]);
}

export { WORKSPACE };
