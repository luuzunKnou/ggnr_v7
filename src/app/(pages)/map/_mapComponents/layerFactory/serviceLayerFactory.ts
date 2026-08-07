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

/** 편집 중 WMS 원본 숨김 — 레이어 PK 컬럼 기준 제외 CQL */
export type HiddenWmsFeatureKey = { keyField: string; keyValue: string };

function escapeCqlString(value: string): string {
  return value.replace(/'/g, "''");
}

export function buildExcludeFeatureKeysCql(items: HiddenWmsFeatureKey[]): string | null {
  if (items.length === 0) return null;
  const byField = new Map<string, string[]>();
  for (const { keyField, keyValue } of items) {
    const field = String(keyField).trim();
    const val = String(keyValue).trim();
    if (!field || !val) continue;
    const list = byField.get(field) ?? [];
    list.push(val);
    byField.set(field, list);
  }

  const clauses: string[] = [];
  for (const [field, values] of byField) {
    const unique = [...new Set(values)];
    if (unique.length === 0) continue;
    const allNumeric = unique.every((v) => /^-?\d+(\.\d+)?$/.test(v));
    if (allNumeric) {
      if (unique.length === 1) clauses.push(`${field} <> ${unique[0]}`);
      else clauses.push(`${field} NOT IN (${unique.join(',')})`);
    } else if (unique.length === 1) {
      clauses.push(`${field} <> '${escapeCqlString(unique[0]!)}'`);
    } else {
      const list = unique.map((v) => `'${escapeCqlString(v)}'`).join(',');
      clauses.push(`${field} NOT IN (${list})`);
    }
  }
  if (clauses.length === 0) return null;
  return clauses.join(' AND ');
}

/** @deprecated ogc_fid 전용 — buildExcludeFeatureKeysCql 사용 */
export function buildExcludeOgcFidsCql(fids: string[]): string | null {
  return buildExcludeFeatureKeysCql(
    fids.map((f) => ({ keyField: 'ogc_fid', keyValue: String(f).trim() })).filter((k) => k.keyValue)
  );
}

function mergeCqlParts(...parts: Array<string | null | undefined>): string {
  const clauses = parts.filter((p): p is string => !!p && p !== 'INCLUDE');
  if (clauses.length === 0) return 'INCLUDE';
  return clauses.join(' AND ');
}

/** 이 길이 초과 시에만 POST (CQL 등으로 414 방지). 그 외는 GET — GeoServer가 POST body의 REQUEST를 못 읽는 환경 회피 */
const WMS_GET_URL_MAX_LEN = 1800;

/**
 * WMS GetMap 로드.
 * - 기본: GET (img.src) — `MissingParameterValue request` 방지
 * - URL이 길 때만 POST. AdvancedDispatchFilter 대응으로 SERVICE/REQUEST는 쿼리에 유지
 * - 응답이 이미지인지 확인 (ServiceExceptionReport XML을 이미지로 넣지 않음)
 */
function imageLoadFunctionPost(image: ImageWrapper, src: string): void {
  const img = image.getImage() as HTMLImageElement;
  try {
    if (!src || src.length <= WMS_GET_URL_MAX_LEN) {
      img.src = src;
      return;
    }

    const url = new URL(src);
    const body = url.search.startsWith('?') ? url.search.slice(1) : url.search;
    if (!body) {
      img.src = src;
      return;
    }

    const params = new URLSearchParams(body);
    const service = params.get('SERVICE') ?? params.get('service') ?? 'WMS';
    const request = params.get('REQUEST') ?? params.get('request') ?? 'GetMap';
    const baseUrl =
      `${url.origin}${url.pathname}` +
      `?SERVICE=${encodeURIComponent(service)}&REQUEST=${encodeURIComponent(request)}`;

    fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
      .then(async (r) => {
        const ct = (r.headers.get('content-type') ?? '').toLowerCase();
        if (!r.ok || ct.includes('xml') || ct.includes('text/')) {
          throw new Error(r.statusText || 'WMS error');
        }
        const blob = await r.blob();
        const blobType = (blob.type || ct).toLowerCase();
        if (blobType && !blobType.startsWith('image/') && blobType !== 'application/octet-stream') {
          throw new Error(`unexpected WMS content-type: ${blobType}`);
        }
        return blob;
      })
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
        // 미설정 시 GeoServer가 흰 배경 이미지를 내려 배경지도·타일을 통째로 가림
        TRANSPARENT: true,
        // inimage 예외는 오류 시에도 뷰포트 전체를 덮는 이미지가 됨 → XML로 두고 콘솔/네트워크에서 확인
        EXCEPTIONS: 'application/vnd.ogc.se_xml',
      },
      serverType: 'geoserver',
      ratio: WMS_VIEWPORT_IMAGE_RATIO,
      imageLoadFunction: imageLoadFunctionPost,
    }),
  });

  layer.set('serviceLayer', true);
  return layer;
}

/** DB 저장·삭제 후 WMS 뷰포트 이미지 캐시 갱신 */
export function refreshServiceWmsLayer(map: OLMap | null | undefined): void {
  if (!map) return;
  const serviceLayer = map.getLayers().getArray().find((l) => l.get('serviceLayer')) as
    | {
        changed?(): void;
        getSource(): {
          getParams(): Record<string, string | undefined>;
          updateParams?(p: Record<string, string | undefined>): void;
          changed(): void;
        } | null;
      }
    | undefined;
  const source = serviceLayer?.getSource();
  if (!source) return;
  const stamp = String(Date.now());
  if (typeof source.updateParams === 'function') {
    source.updateParams({ ...source.getParams(), _dc: stamp });
  }
  source.changed();
  serviceLayer?.changed?.();
  map.render();
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
  /** 레이어별 WMS에서 숨길 feature key (도형편집기 등) */
  hiddenFeaturesByLayer?: Map<string, HiddenWmsFeatureKey[]>,
) {
  const filterRef = useRef(layerFilterRows);
  filterRef.current = layerFilterRows;
  const hiddenRef = useRef(hiddenFeaturesByLayer);
  hiddenRef.current = hiddenFeaturesByLayer;
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
    const hidden = hiddenRef.current;
    const cqlArr = names.map((n) => {
      const base = filterRowsToCql(filters?.get(n) ?? []);
      const spatialCql = wkt ? `INTERSECTS(geom, ${wkt})` : null;
      const excludeCql = buildExcludeFeatureKeysCql(hidden?.get(n) ?? []);
      return mergeCqlParts(base, spatialCql, excludeCql);
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
    params.TRANSPARENT = true;
    params.EXCEPTIONS = 'application/vnd.ogc.se_xml';
    serviceLayer.setVisible(true);
    source.changed();
  }, [map, mapReady, visibleLayerNames, spatialFilterWkt, layerGeometryTypes, hiddenFeaturesByLayer]);
}

export { WORKSPACE };
