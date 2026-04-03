import type { FeatureLike } from 'ol/Feature';

/** WMS·벡터 공통: 면 → 선 → 점 (아래에서 위로 쌓임) */
export type LayerDbGeometryKind = 'POINT' | 'LINE' | 'POLYGON';

/** DB geometry_columns 기반 타입 → WMS 레이어 목록 정렬용 (작을수록 아래에 그려짐) */
export function wmsLayerSortRank(t: LayerDbGeometryKind | undefined): number {
  if (t === 'POLYGON') return 0;
  if (t === 'LINE') return 1;
  if (t === 'POINT') return 2;
  return 1;
}

/**
 * geometry_columns에 없는 레이어(분할 자식 등)는 defineLayer tables.json의 define_table_shp_type으로 보강.
 * DB에 이미 있으면 그대로 둔다.
 */
export function mergeDefineLayerShpTypesIntoGeometryMap(
  base: Record<string, LayerDbGeometryKind>,
  defineTables: unknown[],
): Record<string, LayerDbGeometryKind> {
  const out: Record<string, LayerDbGeometryKind> = { ...base };
  if (!Array.isArray(defineTables)) return out;
  for (const row of defineTables) {
    const r = row as Record<string, unknown>;
    const schema = String(r.define_table_schema ?? 'layer').toLowerCase();
    if (schema !== 'layer' && schema !== 'public_layer') continue;
    const name = String(r.define_table_name ?? '').trim();
    if (!name || name in out) continue;
    const shp = String(r.define_table_shp_type ?? '').trim().toUpperCase();
    if (shp === 'POINT') out[name] = 'POINT';
    else if (shp === 'LINE') out[name] = 'LINE';
    else if (shp === 'POLYGON') out[name] = 'POLYGON';
  }
  return out;
}

/**
 * GeoServer WMS LAYERS: 앞쪽이 먼저 그려져 바닥에 깔림.
 * Polygon → Line → Point 순으로 정렬한다.
 */
export function sortLayerNamesForWmsStack(
  names: string[],
  types: Record<string, LayerDbGeometryKind>,
): string[] {
  if (names.length <= 1) return names;
  return [...names].sort((a, b) => {
    const ra = wmsLayerSortRank(types[a]);
    const rb = wmsLayerSortRank(types[b]);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

function openLayersGeometryRank(geomType: string | undefined): number {
  if (!geomType) return 1;
  if (geomType === 'Polygon' || geomType === 'MultiPolygon' || geomType === 'LinearRing') return 0;
  if (geomType === 'LineString' || geomType === 'MultiLineString') return 1;
  if (geomType === 'Point' || geomType === 'MultiPoint') return 2;
  if (geomType === 'GeometryCollection') return 1;
  return 1;
}

function featureGeometryType(f: FeatureLike): string | undefined {
  const withGeom = f as { getGeometry?: () => { getType(): string } | null };
  if (typeof withGeom.getGeometry === 'function') {
    const t = withGeom.getGeometry()?.getType();
    if (t) return t;
  }
  const withType = f as { getType?: () => string };
  if (typeof withType.getType === 'function') return withType.getType();
  return undefined;
}

/**
 * OpenLayers VectorLayer `renderOrder`: 반환값이 음수면 a가 b보다 먼저 그려짐(아래).
 */
export function compareFeaturesByGeometryStackOrder(a: FeatureLike, b: FeatureLike): number {
  const ra = openLayersGeometryRank(featureGeometryType(a));
  const rb = openLayersGeometryRank(featureGeometryType(b));
  return ra - rb;
}
