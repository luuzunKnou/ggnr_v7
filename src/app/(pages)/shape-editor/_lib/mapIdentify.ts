import { call } from '@/lib/api';
import Feature from 'ol/Feature';
import GeoJSON from 'ol/format/GeoJSON';
import type { IdentifyLayerResult } from '../../map/_mapComponents/hooks/useFeatureIdentify';
import { emptyAttributeValues, writeFeatureAttributes } from './featureAttributes';
import {
  extractFeatureKeyForWms,
  formatWmsFeatureId,
  parseWmsFeatureId,
  type WmsFeatureKey,
} from './wmsFeatureKey';

export { extractFeatureKeyForWms, formatWmsFeatureId, parseWmsFeatureId, type WmsFeatureKey };
export { isWmsCqlSafeKeyField } from './wmsFeatureKey';

/** useFeatureIdentify 와 동일: d = 300000 × 0.54^z (미터) */
export function zoomToIdentifyBuffer(zoom: number): number {
  return 300_000 * Math.pow(0.54, zoom);
}

export async function identifyFeaturesAtCoordinate(
  x: number,
  y: number,
  zoom: number,
  tables: string[],
  schema: string
): Promise<IdentifyLayerResult[]> {
  if (tables.length === 0) return [];
  const bufferMeters = zoomToIdentifyBuffer(zoom);
  const res = await call('', 'POST', {
    service: 'standardService',
    action: 'identifyFeatures',
    params: { x, y, buffer: bufferMeters, tables, schema },
  });
  const data = res?.data ?? res;
  return Array.isArray(data?.results) ? (data.results as IdentifyLayerResult[]) : [];
}

export function rowToAttributeValues(
  row: Record<string, unknown>,
  fields: { field: string }[]
): Record<string, string> {
  const result = emptyAttributeValues(fields);
  for (const f of fields) {
    const key = Object.keys(row).find((k) => k.toLowerCase() === f.field.toLowerCase());
    if (!key) continue;
    const v = row[key];
    if (v != null && typeof v === 'object') continue;
    result[f.field] = String(v ?? '');
  }
  return result;
}

export function identifyFeatureKey(
  row: Record<string, unknown>,
  preferredKeyField?: string | null,
  extraCandidates?: string[],
  tableName?: string | null
): string {
  const key = extractFeatureKeyForWms(row, preferredKeyField, extraCandidates, tableName);
  if (key) return formatWmsFeatureId(key);
  return `wms:tmp:${Date.now()}`;
}

function parseGeometryValue(val: unknown): Record<string, unknown> | null {
  if (val == null) return null;
  let geom: unknown = val;
  if (typeof val === 'string') {
    try {
      geom = JSON.parse(val) as unknown;
    } catch {
      return null;
    }
  }
  if (geom && typeof geom === 'object' && 'type' in geom && 'coordinates' in geom) {
    return geom as Record<string, unknown>;
  }
  return null;
}

export function findGeometryInIdentifyRow(row: Record<string, unknown>): Record<string, unknown> | null {
  for (const val of Object.values(row)) {
    const geom = parseGeometryValue(val);
    if (geom) return geom;
  }
  return null;
}

/** identify 행 → 편집 VectorSource용 Feature (EPSG:3857) */
export function featureFromIdentifyRow(
  row: Record<string, unknown>,
  attributeValues: Record<string, string>
): Feature | null {
  const geometry = findGeometryInIdentifyRow(row);
  if (!geometry) return null;
  const format = new GeoJSON();
  const features = format.readFeatures(
    {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry, properties: {} }],
    },
    { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }
  );
  const feature = features[0];
  if (!feature) return null;
  writeFeatureAttributes(feature, attributeValues);
  return feature;
}
