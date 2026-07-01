import { WORKSPACE } from '@/app/(pages)/map/_mapComponents/layerFactory/serviceLayerFactory';

function getGeoServerBase(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8080/geoserver`;
  }
  return 'http://localhost:8080/geoserver';
}

export function buildCqlEquals(keyField: string, keyValue: string): string {
  const field = String(keyField ?? '').trim();
  const value = String(keyValue ?? '').trim();
  if (!field || !value) return '';
  if (/^-?\d+(\.\d+)?$/.test(value)) return `${field}=${value}`;
  return `${field}='${value.replace(/'/g, "''")}'`;
}

/** GeoServer WFS GetFeature → GeoJSON (지도 편집용) */
export async function fetchWfsGeoJsonByCql(params: {
  layerName: string;
  cqlFilter: string;
  srsName?: string;
}): Promise<{ type: string; features: unknown[] } | null> {
  const layerName = String(params.layerName ?? '').trim();
  const cqlFilter = String(params.cqlFilter ?? '').trim();
  if (!layerName || !cqlFilter) return null;

  const typeName = `${WORKSPACE}:${layerName}`;
  const qs = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: typeName,
    outputFormat: 'application/json',
    srsName: params.srsName ?? 'EPSG:3857',
    CQL_FILTER: cqlFilter,
  });
  const url = `${getGeoServerBase()}/${WORKSPACE}/wfs?${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as { type?: string; features?: unknown[] };
  if (!Array.isArray(json?.features)) return null;
  return { type: String(json.type ?? 'FeatureCollection'), features: json.features };
}

/** GeoServer WFS GetFeature — 뷰포트 bbox (스냅 대상 로드) */
export async function fetchWfsGeoJsonByBbox(params: {
  layerName: string;
  bbox: [number, number, number, number];
  srsName?: string;
  maxFeatures?: number;
}): Promise<{ type: string; features: unknown[] } | null> {
  const layerName = String(params.layerName ?? '').trim();
  if (!layerName) return null;

  const [minX, minY, maxX, maxY] = params.bbox;
  if (![minX, minY, maxX, maxY].every((n) => Number.isFinite(n))) return null;

  const srsName = params.srsName ?? 'EPSG:3857';
  const typeName = `${WORKSPACE}:${layerName}`;
  const qs = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: typeName,
    outputFormat: 'application/json',
    srsName,
    bbox: `${minX},${minY},${maxX},${maxY},${srsName}`,
    count: String(params.maxFeatures ?? 3000),
  });
  const url = `${getGeoServerBase()}/${WORKSPACE}/wfs?${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as { type?: string; features?: unknown[] };
  if (!Array.isArray(json?.features)) return null;
  return { type: String(json.type ?? 'FeatureCollection'), features: json.features };
}
