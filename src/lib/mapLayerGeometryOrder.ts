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
 * 지도 식별(클릭) 결과 정렬 — 점 → 선 → 면 (작을수록 목록 상단·우선).
 * `geometry_columns.type` 또는 PostGIS OGC 타입 코드(숫자)에 대응.
 */
export function identifyHitPriorityRank(geometryColumnsType: string | number | undefined | null): number {
  if (geometryColumnsType == null) return 1;
  if (typeof geometryColumnsType === 'number') {
    if (geometryColumnsType === 1 || geometryColumnsType === 4) return 0;
    if (geometryColumnsType === 2 || geometryColumnsType === 5) return 1;
    if (geometryColumnsType === 3 || geometryColumnsType === 6) return 2;
    return 1;
  }
  const t = String(geometryColumnsType).toUpperCase().replace(/^ST_/, '');
  if (/POINT|MULTIPOINT/.test(t)) return 0;
  if (/LINESTRING|MULTILINESTRING|CIRCULARSTRING|COMPOUNDCURVE|CURVE/.test(t)) return 1;
  if (/POLYGON|MULTIPOLYGON|TRIANGLE|TIN/.test(t)) return 2;
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
 * 동일 기하 타입 안에서도 항상 맨 아래(먼저 그리기)에 깔 레이어.
 * 예: 점용시설물은 점용 본표 WMS보다 아래에.
 */
const WMS_STACK_ALWAYS_BOTTOM = new Set(['usage_data_sisul_as']);

function wmsStackForceBottomRank(name: string, extraBottom?: Set<string>): number {
  const n = String(name ?? '').trim().toLowerCase();
  if (WMS_STACK_ALWAYS_BOTTOM.has(n)) return 0;
  if (extraBottom?.has(n)) return 0;
  return 1;
}

/**
 * GeoServer WMS LAYERS: 앞쪽이 먼저 그려져 바닥에 깔림.
 * 강제 하단 → Polygon → Line → Point 순으로 정렬한다.
 *
 * @param forceBottomNames 부서업무 본표보다 아래에 깔 보조 레이어
 *   (예: 하천점용 패널에서 켠 점사용료)
 */
export function sortLayerNamesForWmsStack(
  names: string[],
  types: Record<string, LayerDbGeometryKind>,
  forceBottomNames?: Iterable<string>,
): string[] {
  if (names.length <= 1) return names;
  const extraBottom = new Set(
    [...(forceBottomNames ?? [])].map((n) => String(n ?? '').trim().toLowerCase()).filter(Boolean)
  );
  return [...names].sort((a, b) => {
    const fa = wmsStackForceBottomRank(a, extraBottom);
    const fb = wmsStackForceBottomRank(b, extraBottom);
    if (fa !== fb) return fa - fb;
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
