import { useEffect, useRef } from 'react';
import ImageLayer from 'ol/layer/Image';
import ImageWMS from 'ol/source/ImageWMS';
import ImageWrapper from 'ol/Image';
import type { Map as OLMap } from 'ol';
import {
  sortLayerNamesForWmsStack,
  markLayerGeomStack,
  type LayerDbGeometryKind,
} from '@/lib/mapLayerGeometryOrder';
import { resolveOccupationDeptWmsStyleName } from '@/lib/occupationDeptWmsStyle';
import { getGeoServerBase } from '@/lib/geoserverUrl';

const WORKSPACE = 'ggnr';

/** 뷰포트 bbox 대비 GetMap 요청 여유 (1 = 화면과 동일, 1.5 = 가장자리 라벨·선 잘림 완화) */
const WMS_VIEWPORT_IMAGE_RATIO = 1.5;

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

/**
 * GeoServer PostGIS는 기본으로 PK를 attribute로 노출하지 않음.
 * `{layer}_key` / ogc_fid 등은 attribute CQL이 실패하므로 FID(`NOT IN ('layer.1')`)로 숨김.
 */
function isFidBasedHideKeyField(layerName: string, keyField: string): boolean {
  const layer = layerName.trim().toLowerCase();
  const field = keyField.trim().toLowerCase();
  if (!layer || !field) return false;
  return (
    field === `${layer}_key` ||
    field === 'ogc_fid' ||
    field === 'fid' ||
    field === 'gid'
  );
}

export function buildExcludeFeatureKeysCql(
  items: HiddenWmsFeatureKey[],
  layerName?: string
): string | null {
  if (items.length === 0) return null;
  const layer = layerName?.trim() ?? '';
  const fidValues: string[] = [];
  const byField = new Map<string, string[]>();
  for (const { keyField, keyValue } of items) {
    const field = String(keyField).trim();
    const val = String(keyValue).trim();
    if (!field || !val) continue;
    if (layer && isFidBasedHideKeyField(layer, field)) {
      fidValues.push(val);
      continue;
    }
    const list = byField.get(field) ?? [];
    list.push(val);
    byField.set(field, list);
  }

  const clauses: string[] = [];
  if (fidValues.length > 0 && layer) {
    const unique = [...new Set(fidValues)];
    const list = unique.map((v) => `'${escapeCqlString(`${layer}.${v}`)}'`).join(',');
    clauses.push(`NOT IN (${list})`);
  }
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

/** fetch 실패 시 empty src 대신 사용 — OL decode 가 Image load error 로 reject 되는 것 방지 */
const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** 이 길이 초과 시에만 POST (CQL 등으로 414 방지). 그 외는 GET — GeoServer가 POST body의 REQUEST를 못 읽는 환경 회피 */
const WMS_GET_URL_MAX_LEN = 1800;

function warnServiceWmsFallback(reason: string, detail?: unknown): void {
  if (detail !== undefined) {
    console.warn('[serviceLayer WMS]', reason, detail);
  } else {
    console.warn('[serviceLayer WMS]', reason);
  }
}

async function isLikelyRasterImageBlob(blob: Blob): Promise<boolean> {
  if (blob.size < 4) return false;
  const head = await blob.slice(0, 4).arrayBuffer();
  const bytes = new Uint8Array(head);
  // PNG / JPEG / GIF
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return true;
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return true;
  return false;
}

async function assertWmsImageBlob(blob: Blob, contentType: string): Promise<Blob> {
  const type = (blob.type || contentType).toLowerCase();
  if (type.includes('xml') || type.includes('text/')) {
    throw new Error(`WMS exception content-type: ${type || 'unknown'}`);
  }
  if (type && !type.startsWith('image/') && type !== 'application/octet-stream') {
    throw new Error(`unexpected WMS content-type: ${type}`);
  }
  // content-type이 비었거나 octet-stream이면 매직 바이트로 XML 오응답 차단
  if (!type || type === 'application/octet-stream') {
    if (!(await isLikelyRasterImageBlob(blob))) {
      throw new Error('WMS response is not a decodable image');
    }
  }
  return blob;
}

function assignWmsBlobToImage(
  img: HTMLImageElement,
  blob: Blob,
  onDecodeFail: () => void
): void {
  const blobUrl = URL.createObjectURL(blob);
  img.onload = () => URL.revokeObjectURL(blobUrl);
  img.onerror = () => {
    URL.revokeObjectURL(blobUrl);
    onDecodeFail();
  };
  img.src = blobUrl;
}

/**
 * WMS GetMap 로드 (serviceLayer 전용).
 * - 짧은 URL: GET fetch — `img.src` 직결 시 XML 예외가 EncodingError로 터지는 것 방지
 * - 긴 URL: POST. AdvancedDispatchFilter 대응으로 SERVICE/REQUEST는 쿼리에 유지
 * - 실패 시 투명 픽셀 + console.warn (디버깅용)
 */
function imageLoadFunctionPost(image: ImageWrapper, src: string): void {
  const img = image.getImage() as HTMLImageElement;
  const fail = (reason: string, detail?: unknown) => {
    warnServiceWmsFallback(reason, detail);
    img.src = TRANSPARENT_PIXEL;
  };

  if (!src) {
    fail('empty WMS src');
    return;
  }

  try {
    let request: Promise<Response>;

    if (src.length <= WMS_GET_URL_MAX_LEN) {
      request = fetch(src, { method: 'GET' });
    } else {
      const url = new URL(src);
      const body = url.search.startsWith('?') ? url.search.slice(1) : url.search;
      if (!body) {
        request = fetch(src, { method: 'GET' });
      } else {
        const params = new URLSearchParams(body);
        const service = params.get('SERVICE') ?? params.get('service') ?? 'WMS';
        const requestName = params.get('REQUEST') ?? params.get('request') ?? 'GetMap';
        const baseUrl =
          `${url.origin}${url.pathname}` +
          `?SERVICE=${encodeURIComponent(service)}&REQUEST=${encodeURIComponent(requestName)}`;
        request = fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
      }
    }

    request
      .then(async (r) => {
        const ct = (r.headers.get('content-type') ?? '').toLowerCase();
        if (!r.ok || ct.includes('xml') || ct.includes('text/')) {
          throw new Error(r.statusText || `HTTP ${r.status}`);
        }
        return assertWmsImageBlob(await r.blob(), ct);
      })
      .then((blob) => {
        assignWmsBlobToImage(img, blob, () => fail('image decode failed'));
      })
      .catch((err) => fail('WMS load failed', err));
  } catch (err) {
    fail('WMS load exception', err);
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
        // inimage 예외는 PNG로 에러 문구가 그려져 실패 감지 불가 → xml로 받아 투명 픽셀로 대체
        EXCEPTIONS: 'application/vnd.ogc.se_xml',
      },
      serverType: 'geoserver',
      ratio: WMS_VIEWPORT_IMAGE_RATIO,
      imageLoadFunction: imageLoadFunctionPost,
    }),
  });

  layer.set('serviceLayer', true);
  markLayerGeomStack(layer, 'POLYGON');
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
 * visibleLayerNames / layerFilterRows / spatialFilterWkt / serviceWmsCqlByLayer /
 * occupationDeptPanelOpen 변경 시 serviceLayer WMS 파라미터를 자동 동기화하는 훅.
 * spatialFilterWkt(5181 WKT)가 있으면 각 레이어 CQL에 INTERSECTS(geom, wkt)를 추가해 도형 내 데이터만 표시.
 * serviceWmsCqlByLayer는 레이어별 추가 속성 CQL(기본계획도 선택 하천 등).
 * occupationDeptPanelOpen이면 점용 부서업무 레이어에 울진 팔레트 스타일을 적용.
 * layerGeometryTypes가 있으면 WMS LAYERS 순서를 면→선→점→심볼(아래→위)으로 맞춘다.
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
  /** 레이어별 추가 CQL (define_table_name → CQL). null이면 없음 */
  serviceWmsCqlByLayer?: Record<string, string> | null,
  /** 공통 점용 부서업무 패널 열림 — 울진과 동일 팔레트 스타일 사용 */
  occupationDeptPanelOpen?: boolean,
  /**
   * WMS에서 본표보다 아래에 깔 레이어 id
   * (부서업무 본표는 위, 패널에서 켠 점사용료 등은 아래)
   */
  wmsForceBottomLayerNames?: Iterable<string>,
) {
  const filterRef = useRef(layerFilterRows);
  filterRef.current = layerFilterRows;
  const hiddenRef = useRef(hiddenFeaturesByLayer);
  hiddenRef.current = hiddenFeaturesByLayer;
  const extraCqlRef = useRef(serviceWmsCqlByLayer);
  extraCqlRef.current = serviceWmsCqlByLayer;
  const lastSyncKeyRef = useRef<string | null>(null);
  const deptOpen = occupationDeptPanelOpen === true;
  const forceBottomKey = Array.from(wmsForceBottomLayerNames ?? [])
    .map((n) => String(n).trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',');

  useEffect(() => {
    if (!mapReady || !map) return;

    const serviceLayer = map.getLayers().getArray().find((l) => l.get('serviceLayer')) as
      | {
          getVisible(): boolean;
          getSource(): {
            getParams(): Record<string, string | undefined>;
            updateParams?(p: Record<string, string | undefined>): void;
            changed(): void;
          } | null;
          setVisible(v: boolean): void;
        }
      | undefined;
    if (!serviceLayer) return;
    const source = serviceLayer.getSource();
    if (!source) return;
    const params = source.getParams();

    const update =
      typeof source.updateParams === 'function'
        ? (next: Record<string, string | undefined>) => source.updateParams!(next)
        : (next: Record<string, string | undefined>) => {
            Object.assign(params, next);
            source.changed();
          };

    if (visibleLayerNames.size === 0) {
      const syncKey = 'empty';
      if (lastSyncKeyRef.current === syncKey && !serviceLayer.getVisible()) return;
      lastSyncKeyRef.current = syncKey;
      update({ LAYERS: '', STYLES: '', CQL_FILTER: undefined });
      delete params.CQL_FILTER;
      serviceLayer.setVisible(false);
      return;
    }

    const rawNames = Array.from(visibleLayerNames);
    // 기하 타입 없어도 강제 하단(시설물·보조 레이어) 정렬은 항상 적용
    const names = sortLayerNamesForWmsStack(
      rawNames,
      layerGeometryTypes ?? {},
      wmsForceBottomLayerNames
    );
    const layersParam = names.map((n) => `${WORKSPACE}:${n}`).join(',');
    // 부서업무 점용: 울진 usage_data_as* 스타일 재사용 / 데이터조회: 테이블명(기본 SLD)
    const stylesParam = names
      .map((n) => resolveOccupationDeptWmsStyleName(n, deptOpen) ?? n)
      .join(',');
    const filters = filterRef.current;
    const wkt = typeof spatialFilterWkt === 'string' && spatialFilterWkt.trim() ? spatialFilterWkt.trim() : null;
    const hidden = hiddenRef.current;
    const extraByLayer = extraCqlRef.current;
    const cqlArr = names.map((n) => {
      const base = filterRowsToCql(filters?.get(n) ?? []);
      const spatialCql = wkt ? `INTERSECTS(geom, ${wkt})` : null;
      const excludeCql = buildExcludeFeatureKeysCql(hidden?.get(n) ?? [], n);
      const extraRaw =
        extraByLayer?.[n] ??
        extraByLayer?.[n.toLowerCase()] ??
        null;
      const extraCql =
        typeof extraRaw === 'string' && extraRaw.trim() && extraRaw.trim() !== 'INCLUDE'
          ? extraRaw.trim()
          : null;
      return mergeCqlParts(base, spatialCql, excludeCql, extraCql);
    });
    const allInclude = cqlArr.every((c) => c === 'INCLUDE');
    const cqlParam = allInclude ? '' : cqlArr.join(';');
    const syncKey = `${layersParam}|${stylesParam}|${cqlParam}|fb:${forceBottomKey}`;

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

    if (allInclude) {
      update({
        LAYERS: layersParam,
        STYLES: stylesParam,
        CQL_FILTER: undefined,
        TRANSPARENT: 'true',
        EXCEPTIONS: 'application/vnd.ogc.se_xml',
      });
      delete params.CQL_FILTER;
    } else {
      update({
        LAYERS: layersParam,
        STYLES: stylesParam,
        CQL_FILTER: cqlParam,
        TRANSPARENT: 'true',
        EXCEPTIONS: 'application/vnd.ogc.se_xml',
      });
    }
    serviceLayer.setVisible(true);
    source.changed();
  }, [
    map,
    mapReady,
    visibleLayerNames,
    spatialFilterWkt,
    layerGeometryTypes,
    hiddenFeaturesByLayer,
    serviceWmsCqlByLayer,
    deptOpen,
    forceBottomKey,
    wmsForceBottomLayerNames,
  ]);
}

export { WORKSPACE };
