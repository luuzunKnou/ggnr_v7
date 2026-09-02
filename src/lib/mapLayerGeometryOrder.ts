import type { FeatureLike } from 'ol/Feature';
import type { Map as OLMap } from 'ol';
import type BaseLayer from 'ol/layer/Base';

/** WMS·벡터 공통: 면 → 선 → 점 → 심볼 (아래에서 위로 쌓임) */
export type LayerDbGeometryKind = 'POINT' | 'LINE' | 'POLYGON';

/** 그리기 순서용. 점은 단순 점, 심볼은 아이콘 점형(맨 위). */
export type LayerStackKind = LayerDbGeometryKind | 'SYMBOL';

/**
 * 지도 쌓기 순서 — 이 배열만 바꾸면 높이·WMS 정렬·벡터 그리기 순서가 같이 바뀐다.
 * 앞쪽이 아래, 뒤쪽이 위.
 */
export const GEOM_STACK_ORDER: readonly LayerStackKind[] = ['POLYGON', 'LINE', 'POINT', 'SYMBOL'];

/** 기하 쌓기 시작 높이. 이보다 큰 값(100 이상)은 강조·그리기 등 UI 레이어로 보고 건드리지 않는다. */
export const GEOM_STACK_ZINDEX_BASE = 10;
export const GEOM_STACK_ZINDEX_STEP = 10;
export const GEOM_STACK_UI_ZINDEX_MIN = 100;

export const LAYER_GEOM_STACK_KIND_KEY = 'geomStackKind';
export const LAYER_GEOM_STACK_SKIP_KEY = 'geomStackSkip';
const MAP_GEOM_STACK_TYPES_KEY = 'geomStackTypes';

function isLayerStackKind(v: unknown): v is LayerStackKind {
  return typeof v === 'string' && (GEOM_STACK_ORDER as readonly string[]).includes(v);
}

function lookupGeomKind(
  name: string,
  types: Record<string, LayerDbGeometryKind>,
): LayerDbGeometryKind | undefined {
  if (types[name]) return types[name];
  const lower = String(name ?? '').trim().toLowerCase();
  if (!lower) return undefined;
  if (types[lower]) return types[lower];
  for (const [key, kind] of Object.entries(types)) {
    if (key.toLowerCase() === lower) return kind;
  }
  return undefined;
}

/** 상수·하수 등 `_ps` 점형심볼, 또는 이름에 symbol 포함 */
export function isPointSymbolLayerName(name: string): boolean {
  const n = String(name ?? '').trim().toLowerCase();
  if (!n) return false;
  return n.endsWith('_ps') || /(^|[_-])symbol([_-]|$)/.test(n);
}

/**
 * DB 기하 + 점형심볼 승격 → 쌓기 종류.
 * `_ps`는 정의 타입이 면이어도 점형심볼로 본다(맨홀·밸브 등이 면으로 등록된 경우).
 */
export function wmsLayerStackKind(
  name: string,
  types: Record<string, LayerDbGeometryKind>,
): LayerStackKind | undefined {
  if (isPointSymbolLayerName(name)) return 'SYMBOL';
  return lookupGeomKind(name, types);
}

/** 작을수록 아래에 그려짐. 순서는 `GEOM_STACK_ORDER`. 모르면 선과 같게. */
export function wmsLayerSortRank(t: LayerStackKind | undefined): number {
  const fallback = GEOM_STACK_ORDER.indexOf('LINE');
  if (!t) return fallback;
  const i = GEOM_STACK_ORDER.indexOf(t);
  return i >= 0 ? i : fallback;
}

export function geomStackZIndex(kind: LayerStackKind | undefined): number {
  return GEOM_STACK_ZINDEX_BASE + wmsLayerSortRank(kind) * GEOM_STACK_ZINDEX_STEP;
}

/** `GEOM_STACK_ORDER`에서 파생. 직접 숫자를 쓰지 말고 이 값 또는 `geomStackZIndex`를 쓴다. */
export const GEOM_STACK_ZINDEX: Record<LayerStackKind, number> = {
  POLYGON: geomStackZIndex('POLYGON'),
  LINE: geomStackZIndex('LINE'),
  POINT: geomStackZIndex('POINT'),
  SYMBOL: geomStackZIndex('SYMBOL'),
};

/**
 * 새 레이어에 쌓기 종류만 지정하면 높이가 따라간다.
 * WMS는 `layerTableName`만 있으면 테이블 기하로 자동 분류된다.
 */
export function markLayerGeomStack(layer: BaseLayer, kind: LayerStackKind): void {
  layer.set(LAYER_GEOM_STACK_KIND_KEY, kind);
  layer.setZIndex(geomStackZIndex(kind));
}

export function resolveLayerStackKind(
  layer: BaseLayer,
  types: Record<string, LayerDbGeometryKind>,
): LayerStackKind | undefined {
  if (layer.get(LAYER_GEOM_STACK_SKIP_KEY) === true) return undefined;
  const marked = layer.get(LAYER_GEOM_STACK_KIND_KEY);
  if (isLayerStackKind(marked)) return marked;
  if (layer.get('serviceLayer')) return 'POLYGON';
  const table = layer.get('layerTableName');
  if (table) return wmsLayerStackKind(String(table), types) ?? 'LINE';
  return undefined;
}

export function applyGeomStackZIndexToLayer(
  layer: BaseLayer,
  types: Record<string, LayerDbGeometryKind>,
): void {
  if (layer.get(LAYER_GEOM_STACK_SKIP_KEY) === true) return;
  const z = layer.getZIndex();
  if (z != null && z >= GEOM_STACK_UI_ZINDEX_MIN) return;
  const kind = resolveLayerStackKind(layer, types);
  if (!kind) return;
  layer.setZIndex(geomStackZIndex(kind));
}

function geometryTypesOnMap(map: OLMap): Record<string, LayerDbGeometryKind> {
  const stored = map.get(MAP_GEOM_STACK_TYPES_KEY);
  if (stored && typeof stored === 'object') return stored as Record<string, LayerDbGeometryKind>;
  return {};
}

/** 타입 갱신 후 지도의 모든 대상 레이어 높이를 다시 맞춘다. */
export function setMapGeometryStackTypes(
  map: OLMap,
  types: Record<string, LayerDbGeometryKind>,
): void {
  map.set(MAP_GEOM_STACK_TYPES_KEY, types);
  applyMapGeometryStackOrder(map, types);
}

/**
 * 지금 있는 레이어에 규칙을 적용하고, 앞으로 추가되는 레이어도 같은 높이를 받게 한다.
 */
export function bindMapGeometryStackOrder(
  map: OLMap,
  types: Record<string, LayerDbGeometryKind>,
): () => void {
  setMapGeometryStackTypes(map, types);
  const coll = map.getLayers();
  const onAdd = (evt: { element?: BaseLayer }) => {
    const layer = evt.element;
    if (!layer) return;
    applyGeomStackZIndexToLayer(layer, geometryTypesOnMap(map));
  };
  coll.on('add', onAdd as never);
  return () => coll.un('add', onAdd as never);
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
 * 예: 점용시설물·점용 필지는 점용 본표 WMS보다 아래에.
 */
const WMS_STACK_ALWAYS_BOTTOM = new Set([
  'usage_data_sisul_as',
  'usage_data_as_solo',
  'water_occupationledger_jijuk',
  'road_occupationledger_jijuk',
  'public_occupationledger_jijuk',
]);

function wmsStackForceBottomRank(name: string, extraBottom?: Set<string>): number {
  const n = String(name ?? '').trim().toLowerCase();
  if (WMS_STACK_ALWAYS_BOTTOM.has(n)) return 0;
  if (extraBottom?.has(n)) return 0;
  return 1;
}

/**
 * GeoServer WMS LAYERS: 앞쪽이 먼저 그려져 바닥에 깔림.
 * 강제 하단 → 면 → 선 → 점 → 심볼 순으로 정렬한다.
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
    const ra = wmsLayerSortRank(wmsLayerStackKind(a, types));
    const rb = wmsLayerSortRank(wmsLayerStackKind(b, types));
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

function isGeometryStackableWmsLayer(layer: BaseLayer): boolean {
  if (!layer.get('layerTableName')) return false;
  if (layer.get('serviceLayer')) return false;
  if (layer.get('safetyMapGeoLayer')) return false;
  const z = layer.getZIndex();
  if (z != null && z >= 100) return false;
  return true;
}

/**
 * 지도의 대상 레이어 높이를 맞춘 뒤, 우측 컨트롤 WMS만 면 < 선 < 점 < 심볼 순으로 재배치한다.
 */
export function applyMapGeometryStackOrder(
  map: OLMap,
  types: Record<string, LayerDbGeometryKind>,
): void {
  map.set(MAP_GEOM_STACK_TYPES_KEY, types);
  const coll = map.getLayers();
  const arr = coll.getArray();
  for (const layer of arr) applyGeomStackZIndexToLayer(layer, types);

  const sortable = arr.filter((layer) => isGeometryStackableWmsLayer(layer));
  if (sortable.length <= 1) return;

  const origIndex = new Map(sortable.map((layer, i) => [layer, i]));
  const sorted = [...sortable].sort((a, b) => {
    const na = String(a.get('layerTableName') ?? '');
    const nb = String(b.get('layerTableName') ?? '');
    const d =
      wmsLayerSortRank(wmsLayerStackKind(na, types)) -
      wmsLayerSortRank(wmsLayerStackKind(nb, types));
    if (d !== 0) return d;
    return (origIndex.get(a) ?? 0) - (origIndex.get(b) ?? 0);
  });

  const unchanged = sortable.every((layer, i) => layer === sorted[i]);
  if (unchanged) return;

  const insertAt = arr.indexOf(sortable[0]!);
  for (const layer of sortable) coll.remove(layer);
  const clamped = Math.max(0, Math.min(insertAt, coll.getLength()));
  sorted.forEach((layer, i) => coll.insertAt(clamped + i, layer));
}

/** @deprecated `applyMapGeometryStackOrder`와 동일. 기존 호출부 호환. */
export function applyWmsOverlayGeometryStackOrder(
  map: OLMap,
  types: Record<string, LayerDbGeometryKind>,
): void {
  applyMapGeometryStackOrder(map, types);
}

function featureStackKind(f: FeatureLike): LayerStackKind | undefined {
  if (isSymbolFeature(f)) return 'SYMBOL';
  const geomType = featureGeometryType(f);
  if (
    geomType === 'Polygon' ||
    geomType === 'MultiPolygon' ||
    geomType === 'LinearRing' ||
    geomType === 'Circle'
  ) {
    return 'POLYGON';
  }
  if (geomType === 'LineString' || geomType === 'MultiLineString') return 'LINE';
  if (geomType === 'Point' || geomType === 'MultiPoint') return 'POINT';
  return undefined;
}

function isSymbolFeature(f: FeatureLike): boolean {
  const rec = f as { get?: (key: string) => unknown };
  if (typeof rec.get !== 'function') return false;
  if (rec.get('printOverlay')) return true;
  if (rec.get('isSymbol')) return true;
  if (rec.get('markerType') === 'geometryCenter') return true;
  return false;
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
  return wmsLayerSortRank(featureStackKind(a)) - wmsLayerSortRank(featureStackKind(b));
}
